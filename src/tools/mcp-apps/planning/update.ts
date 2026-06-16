// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebApi } from "azure-devops-node-api";
import { fieldOp, joinAcceptanceCriteria, markdownFieldOps, PatchOp, tagsValue } from "./field-ops.js";
import { FailedUpdateItem, SkippedUpdateItem, UpdateItemsOptions, UpdateItemsResult, UpdatedWorkItem, UpdateWorkItemInput } from "./types.js";

/**
 * Write edits to EXISTING Azure DevOps work items — the write side of the
 * round-trip ({@link ./backlog.ts} is the read side). This extends the same
 * human-in-the-loop invariants as {@link ./create-approved.ts} from creation to
 * updates: `dryRun` performs no write (via Azure DevOps' native `validateOnly`),
 * and per-item failures are isolated rather than aborting the batch.
 */

/** Build a JSON-patch of only the fields present on the input, plus their labels. */
function buildUpdatePatch(item: UpdateWorkItemInput): { ops: PatchOp[]; fields: string[] } {
  const ops: PatchOp[] = [];
  const fields: string[] = [];

  if (item.title !== undefined) {
    ops.push(fieldOp("System.Title", item.title));
    fields.push("Title");
  }
  if (item.description !== undefined) {
    ops.push(...markdownFieldOps("System.Description", item.description));
    fields.push("Description");
  }
  if (item.acceptanceCriteria !== undefined) {
    ops.push(...markdownFieldOps("Microsoft.VSTS.Common.AcceptanceCriteria", joinAcceptanceCriteria(item.acceptanceCriteria)));
    fields.push("AcceptanceCriteria");
  }
  if (item.state !== undefined) {
    ops.push(fieldOp("System.State", item.state));
    fields.push("State");
  }
  if (item.areaPath !== undefined) {
    ops.push(fieldOp("System.AreaPath", item.areaPath));
    fields.push("AreaPath");
  }
  if (item.iterationPath !== undefined) {
    ops.push(fieldOp("System.IterationPath", item.iterationPath));
    fields.push("IterationPath");
  }
  if (item.assignedTo !== undefined) {
    ops.push(fieldOp("System.AssignedTo", item.assignedTo));
    fields.push("AssignedTo");
  }
  if (item.tags !== undefined) {
    ops.push(fieldOp("System.Tags", tagsValue(item.tags)));
    fields.push("Tags");
  }

  return { ops, fields };
}

/**
 * Apply edits to existing work items by id. `dryRun` validates without persisting.
 * Items without a valid `adoId`, or with no changed fields, are skipped with a
 * reason; per-item errors are isolated into `failed` and never abort the batch.
 */
export async function updateWorkItems(connection: WebApi, project: string, items: UpdateWorkItemInput[], options: UpdateItemsOptions = {}): Promise<UpdateItemsResult> {
  const dryRun = options.dryRun === true;
  const updated: UpdatedWorkItem[] = [];
  const skipped: SkippedUpdateItem[] = [];
  const failed: FailedUpdateItem[] = [];

  // Plan every item first (no ADO contact): skip items lacking a valid id or with
  // no changed fields. Only acquire the API and write if something actually changes.
  const toWrite: { adoId: number; ops: PatchOp[]; fields: string[] }[] = [];
  for (const item of items) {
    if (!(typeof item.adoId === "number" && item.adoId > 0)) {
      skipped.push({ adoId: item.adoId, reason: "Missing or invalid adoId; only existing work items can be updated." });
      continue;
    }
    const { ops, fields } = buildUpdatePatch(item);
    if (ops.length === 0) {
      skipped.push({ adoId: item.adoId, reason: "No changed fields supplied." });
      continue;
    }
    toWrite.push({ adoId: item.adoId, ops, fields });
  }

  if (toWrite.length === 0) {
    return { dryRun, updated, skipped, failed };
  }

  const workItemApi = await connection.getWorkItemTrackingApi();

  for (const { adoId, ops, fields } of toWrite) {
    try {
      // updateWorkItem(customHeaders, document, id, project, validateOnly) — validateOnly=dryRun
      // makes Azure DevOps validate the patch without persisting it.
      const result = await workItemApi.updateWorkItem(null, ops, adoId, project, dryRun);
      if (!result || typeof result.id !== "number") {
        failed.push({ adoId, error: "Azure DevOps did not confirm the update." });
        continue;
      }
      updated.push({ adoId: result.id, url: `${connection.serverUrl}/${encodeURIComponent(project)}/_workitems/edit/${result.id}`, fields });
    } catch (error) {
      failed.push({ adoId, error: error instanceof Error ? error.message : "Unknown error occurred" });
    }
  }

  return { dryRun, updated, skipped, failed };
}
