// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebApi } from "azure-devops-node-api";
import { SyncedWorkItem, SyncResult } from "./types.js";

const SYNC_FIELDS = ["System.Id", "System.WorkItemType", "System.Title", "System.State", "System.Parent", "System.AreaPath", "System.IterationPath", "System.Tags", "System.ChangedDate"];

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

/**
 * Refresh already-created work items from Azure DevOps by id. Reports current
 * field/state values, parent relationships, and any requested ids that no
 * longer exist (deleted or inaccessible).
 */
export async function syncWorkItems(connection: WebApi, project: string, workItemIds: number[]): Promise<SyncResult> {
  const ids = Array.from(new Set(workItemIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) {
    return { items: [], missing: [], warnings: [] };
  }

  const workItemApi = await connection.getWorkItemTrackingApi();
  const batch = await workItemApi.getWorkItemsBatch({ ids, fields: SYNC_FIELDS }, project);
  const returned = Array.isArray(batch) ? batch : [];

  const items: SyncedWorkItem[] = returned.map((wi) => {
    const fields = (wi.fields ?? {}) as Record<string, unknown>;
    const parent = fields["System.Parent"];
    return {
      adoId: wi.id ?? 0,
      type: asString(fields["System.WorkItemType"]),
      title: asString(fields["System.Title"]),
      state: asString(fields["System.State"]),
      parentAdoId: typeof parent === "number" ? parent : undefined,
      areaPath: asString(fields["System.AreaPath"]),
      iterationPath: asString(fields["System.IterationPath"]),
      tags: asString(fields["System.Tags"]),
      changedDate: asString(fields["System.ChangedDate"]),
      url: `${connection.serverUrl}/${encodeURIComponent(project)}/_workitems/edit/${wi.id}`,
    };
  });

  const foundIds = new Set(items.map((i) => i.adoId));
  const missing = ids.filter((id) => !foundIds.has(id));
  const warnings = missing.map((id) => ({ code: "MISSING_WORK_ITEM", message: `Work item ${id} was not found in Azure DevOps (deleted, moved, or inaccessible).`, severity: "warning" as const }));

  return { items, missing, warnings };
}
