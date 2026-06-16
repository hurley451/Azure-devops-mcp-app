// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebApi } from "azure-devops-node-api";
import { DraftWorkItem, isSupportedType, PlanningDraft, PlanningWarning } from "./types.js";

/**
 * Load a project's EXISTING Azure DevOps work items into a {@link PlanningDraft}
 * for viewing and editing. This is the read side of the round-trip: unlike
 * {@link ./sync.ts} (which refreshes items already present in a draft by id) or
 * {@link ./context.ts} (project metadata), this pulls the live backlog itself.
 *
 * Items are returned with `status: "created"` and their `adoId`/`url` populated,
 * so the UI renders them as existing items the user can then edit and save back.
 */

const BACKLOG_FIELDS = [
  "System.Id",
  "System.WorkItemType",
  "System.Title",
  "System.State",
  "System.Parent",
  "System.AreaPath",
  "System.IterationPath",
  "System.Tags",
  "System.AssignedTo",
  "System.Description",
  "Microsoft.VSTS.Common.AcceptanceCriteria",
];

/** Default cap so a "load everything" never pulls an unbounded backlog. */
const DEFAULT_TOP = 200;

export interface LoadBacklogOptions {
  team?: string;
  /** Restrict to an area path (and everything UNDER it). */
  areaPath?: string;
  /** A full WIQL query overriding the default; if set, areaPath is ignored. */
  wiql?: string;
  /** Maximum number of items to return (default 200). */
  top?: number;
  /** Explicit ids to load; if set, no WIQL query is run. */
  ids?: number[];
}

export interface SkippedBacklogItem {
  adoId: number;
  type: string;
  title: string;
  reason: string;
}

export interface LoadBacklogResult {
  draft: PlanningDraft;
  warnings: PlanningWarning[];
  skipped: SkippedBacklogItem[];
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

/** Strip HTML to readable plain text (ADO rich-text fields come back as HTML). */
function htmlToText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value)
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > 0 ? text : undefined;
}

/** Azure DevOps identity fields come back as an object; prefer uniqueName. */
function identityToString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const id = value as { uniqueName?: string; displayName?: string };
    return id.uniqueName ?? id.displayName ?? undefined;
  }
  return String(value);
}

function splitTags(value: unknown): string[] | undefined {
  const raw = asString(value);
  if (!raw) return undefined;
  const tags = raw
    .split(";")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return tags.length > 0 ? tags : undefined;
}

function escapeWiqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildDefaultWiql(areaPath?: string): string {
  const areaClause = areaPath && areaPath.trim().length > 0 ? ` AND [System.AreaPath] UNDER '${escapeWiqlLiteral(areaPath.trim())}'` : "";
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project${areaClause} ORDER BY [System.Id]`;
}

export async function loadBacklog(connection: WebApi, project: string, options: LoadBacklogOptions = {}): Promise<LoadBacklogResult> {
  const warnings: PlanningWarning[] = [];
  const skipped: SkippedBacklogItem[] = [];
  const top = options.top && options.top > 0 ? Math.floor(options.top) : DEFAULT_TOP;
  const workItemApi = await connection.getWorkItemTrackingApi();

  // Resolve the set of ids to load: explicit ids, or a WIQL query.
  let ids: number[];
  if (options.ids && options.ids.length > 0) {
    ids = Array.from(new Set(options.ids.filter((id) => Number.isInteger(id) && id > 0))).slice(0, top);
  } else {
    const query = options.wiql && options.wiql.trim().length > 0 ? options.wiql : buildDefaultWiql(options.areaPath);
    const teamContext = options.team ? { project, team: options.team } : { project };
    const result = await workItemApi.queryByWiql({ query }, teamContext, undefined, top);
    const refs = (result?.workItems ?? []).map((r) => r.id).filter((id): id is number => typeof id === "number");
    ids = Array.from(new Set(refs)).slice(0, top);
  }

  if (ids.length === 0) {
    return { draft: { draftId: `backlog-${project}`, project, team: options.team, items: [] }, warnings, skipped };
  }

  const batch = await workItemApi.getWorkItemsBatch({ ids, fields: BACKLOG_FIELDS }, project);
  const returned = Array.isArray(batch) ? batch : [];
  const idSet = new Set(returned.map((wi) => wi.id).filter((id): id is number => typeof id === "number"));

  const items: DraftWorkItem[] = [];
  for (const wi of returned) {
    const adoId = wi.id;
    if (!adoId) continue; // null/zero id is a malformed API response; skip to avoid "wi-0" localId collisions
    const fields = (wi.fields ?? {}) as Record<string, unknown>;
    const typeName = asString(fields["System.WorkItemType"]) ?? "";
    const title = asString(fields["System.Title"]) ?? "(untitled)";

    if (!isSupportedType(typeName)) {
      skipped.push({ adoId, type: typeName, title, reason: `Work item type '${typeName}' is not one the planner models; loaded as a reference only.` });
      continue;
    }

    const parent = fields["System.Parent"];
    const parentAdoId = typeof parent === "number" ? parent : undefined;
    const tags = splitTags(fields["System.Tags"]);

    if (asString(fields["Microsoft.VSTS.Common.AcceptanceCriteria"])) {
      warnings.push({
        code: "AC_NOT_IMPORTED",
        message: `Acceptance criteria on #${adoId} were not imported (rich-text fidelity); edit them in the workspace or ADO.`,
        localId: `wi-${adoId}`,
        severity: "info",
      });
    }

    items.push({
      localId: `wi-${adoId}`,
      adoId,
      url: `${connection.serverUrl}/${encodeURIComponent(project)}/_workitems/edit/${adoId}`,
      type: typeName,
      title,
      description: htmlToText(fields["System.Description"]),
      parentLocalId: parentAdoId !== undefined && idSet.has(parentAdoId) ? `wi-${parentAdoId}` : undefined,
      state: asString(fields["System.State"]),
      areaPath: asString(fields["System.AreaPath"]),
      iterationPath: asString(fields["System.IterationPath"]),
      assignedTo: identityToString(fields["System.AssignedTo"]),
      tags,
      status: "created",
    });
  }

  const draft: PlanningDraft = { draftId: `backlog-${project}`, project, team: options.team, items };
  return { draft, warnings, skipped };
}
