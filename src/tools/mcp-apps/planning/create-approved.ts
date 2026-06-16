// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebApi } from "azure-devops-node-api";
import { encodeFormattedValue } from "../../../utils.js";
import {
  CreateApprovedOptions,
  CreateApprovedResult,
  CreatedWorkItem,
  DraftWorkItem,
  FailedDraftItem,
  PlanningDraft,
  PlanningWarning,
  SkippedDraftItem,
  TYPE_ORDER,
  TYPES_WITH_ACCEPTANCE_CRITERIA,
} from "./types.js";
import { validateDraft } from "./validation.js";

interface PatchOp {
  op: string;
  path: string;
  value: unknown;
}

/** Reason text for an item that will not be created in this run. */
function skipReason(status: DraftWorkItem["status"]): string {
  switch (status) {
    case "rejected":
      return "Item is marked rejected.";
    case "needs_rewrite":
      return "Item is marked needs_rewrite.";
    case "created":
      return "Item was already created.";
    case "failed":
      return "Item previously failed to create.";
    default:
      return "Item is not approved.";
  }
}

/**
 * Order approved items so that every parent is created before its children.
 * Ties are broken by {@link TYPE_ORDER} for deterministic output. Parent links
 * that point outside the approved set impose no ordering constraint here.
 */
function orderForCreation(items: DraftWorkItem[]): DraftWorkItem[] {
  const inSet = new Set(items.map((i) => i.localId));
  const byId = new Map(items.map((i) => [i.localId, i] as const));
  const sorted = [...items].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));

  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const out: DraftWorkItem[] = [];

  const visit = (item: DraftWorkItem): void => {
    if (visited.has(item.localId) || inProgress.has(item.localId)) return;
    inProgress.add(item.localId);
    const parentId = item.parentLocalId;
    if (parentId && inSet.has(parentId)) {
      const parent = byId.get(parentId);
      if (parent) visit(parent);
    }
    inProgress.delete(item.localId);
    if (!visited.has(item.localId)) {
      visited.add(item.localId);
      out.push(item);
    }
  };

  for (const item of sorted) visit(item);
  return out;
}

function joinAcceptanceCriteria(criteria: string[]): string {
  return criteria.map((c) => `- ${c}`).join("\n");
}

/** Build the JSON-patch document for one work item, plus any per-item warnings. */
function buildPatchDocument(item: DraftWorkItem, options: CreateApprovedOptions, serverUrl: string, project: string, parentAdoId?: number): PatchOp[] {
  const ops: PatchOp[] = [{ op: "add", path: "/fields/System.Title", value: item.title }];

  // Description (+ acceptance criteria for types without an AC field).
  const acHasField = TYPES_WITH_ACCEPTANCE_CRITERIA.includes(item.type);
  let description = item.description ?? "";
  if (!acHasField && item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    const acText = joinAcceptanceCriteria(item.acceptanceCriteria);
    description = description ? `${description}\n\n**Acceptance Criteria**\n${acText}` : `**Acceptance Criteria**\n${acText}`;
  }
  if (description.trim().length > 0) {
    ops.push({ op: "add", path: "/fields/System.Description", value: encodeFormattedValue(description, "Markdown") });
    ops.push({ op: "add", path: "/multilineFieldsFormat/System.Description", value: "Markdown" });
  }

  if (acHasField && item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    const acText = joinAcceptanceCriteria(item.acceptanceCriteria);
    ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", value: encodeFormattedValue(acText, "Markdown") });
    ops.push({ op: "add", path: "/multilineFieldsFormat/Microsoft.VSTS.Common.AcceptanceCriteria", value: "Markdown" });
  }

  const areaPath = item.areaPath ?? options.areaPath;
  if (areaPath && areaPath.trim().length > 0) ops.push({ op: "add", path: "/fields/System.AreaPath", value: areaPath });

  const iterationPath = item.iterationPath ?? options.iterationPath;
  if (iterationPath && iterationPath.trim().length > 0) ops.push({ op: "add", path: "/fields/System.IterationPath", value: iterationPath });

  const assignedTo = item.assignedTo ?? options.assignedTo;
  if (assignedTo && assignedTo.trim().length > 0) ops.push({ op: "add", path: "/fields/System.AssignedTo", value: assignedTo });

  const tags = [...(item.tags ?? []), ...(options.tags ?? [])].map((t) => t.trim()).filter((t) => t.length > 0);
  if (tags.length > 0) ops.push({ op: "add", path: "/fields/System.Tags", value: Array.from(new Set(tags)).join("; ") });

  if (typeof item.priority === "number") ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: item.priority });
  if (typeof item.businessValue === "number") ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.BusinessValue", value: item.businessValue });
  if (typeof item.effort === "number") ops.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.Effort", value: item.effort });

  if (typeof parentAdoId === "number") {
    ops.push({
      op: "add",
      path: "/relations/-",
      value: {
        rel: "System.LinkTypes.Hierarchy-Reverse",
        url: `${serverUrl}/${encodeURIComponent(project)}/_apis/wit/workItems/${parentAdoId}`,
      },
    });
  }

  return ops;
}

function summarize(created: CreatedWorkItem[]): CreateApprovedResult["summary"] {
  const summary = { epics: 0, features: 0, pbis: 0, tasks: 0 };
  for (const item of created) {
    switch (item.type) {
      case "Epic":
        summary.epics++;
        break;
      case "Feature":
        summary.features++;
        break;
      case "Task":
        summary.tasks++;
        break;
      // Product Backlog Item, User Story, Bug are counted as requirement-level "pbis".
      default:
        summary.pbis++;
        break;
    }
  }
  return summary;
}

/**
 * Create the approved items of a draft in Azure DevOps, parents first, linking
 * children to their parents. Honours `dryRun` (no writes). Isolated per-item
 * failures are recorded in `failed` and never abort the rest of the run. Fatal
 * validation errors abort the whole run before any write.
 *
 * @param connection an Azure DevOps WebApi connection (only used when not dryRun)
 */
export async function createApprovedItems(connection: WebApi, project: string, draft: PlanningDraft, options: CreateApprovedOptions = {}): Promise<CreateApprovedResult> {
  const dryRun = options.dryRun === true;
  const validation = validateDraft(draft, draft.mode);
  const warnings: PlanningWarning[] = [...validation.warnings];

  if (!validation.valid) {
    return { dryRun, created: [], skipped: [], failed: [], summary: summarize([]), warnings, errors: validation.errors };
  }

  const items = validation.normalizedDraft.items;
  const approved = items.filter((i) => i.status === "approved");
  const approvedIds = new Set(approved.map((i) => i.localId));

  const skipped: SkippedDraftItem[] = items.filter((i) => i.status !== "approved").map((i) => ({ localId: i.localId, type: i.type, title: i.title, reason: skipReason(i.status) }));

  const created: CreatedWorkItem[] = [];
  const failed: FailedDraftItem[] = [];
  const adoMap = new Map<string, number>();
  const order = orderForCreation(approved);

  const noteParentLinkGap = (item: DraftWorkItem): number | undefined => {
    if (!item.parentLocalId) return undefined;
    if (adoMap.has(item.parentLocalId)) return adoMap.get(item.parentLocalId);
    if (!approvedIds.has(item.parentLocalId)) {
      warnings.push({
        code: "PARENT_NOT_APPROVED",
        message: `'${item.localId}' will be created without a parent link: parent '${item.parentLocalId}' is not in the approved set.`,
        localId: item.localId,
        severity: "warning",
      });
    } else {
      warnings.push({
        code: "PARENT_LINK_SKIPPED",
        message: `'${item.localId}' will be created without a parent link: parent '${item.parentLocalId}' was not created.`,
        localId: item.localId,
        severity: "warning",
      });
    }
    return undefined;
  };

  if (dryRun) {
    for (const item of order) {
      noteParentLinkGap(item);
      created.push({ localId: item.localId, type: item.type, title: item.title, parentLocalId: item.parentLocalId, creationStatus: "dryRun" });
    }
    return { dryRun, created, skipped, failed, summary: summarize(created), warnings };
  }

  const serverUrl = connection.serverUrl;
  const workItemApi = await connection.getWorkItemTrackingApi();

  for (const item of order) {
    try {
      const parentAdoId = noteParentLinkGap(item);
      const document = buildPatchDocument(item, options, serverUrl, project, parentAdoId);
      const newWorkItem = await workItemApi.createWorkItem(null, document, project, item.type);
      if (!newWorkItem || typeof newWorkItem.id !== "number") {
        failed.push({ localId: item.localId, type: item.type, title: item.title, error: "Azure DevOps did not return a created work item id." });
        continue;
      }
      adoMap.set(item.localId, newWorkItem.id);
      created.push({
        localId: item.localId,
        adoId: newWorkItem.id,
        url: `${serverUrl}/${encodeURIComponent(project)}/_workitems/edit/${newWorkItem.id}`,
        type: item.type,
        title: item.title,
        parentLocalId: item.parentLocalId,
        parentAdoId,
        creationStatus: "created",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error occurred";
      failed.push({ localId: item.localId, type: item.type, title: item.title, error: message });
    }
  }

  return { dryRun, created, skipped, failed, summary: summarize(created), warnings };
}
