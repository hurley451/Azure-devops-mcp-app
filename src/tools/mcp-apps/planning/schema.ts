// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { z } from "zod";
import { DraftWorkItem } from "./types.js";

/**
 * Zod schemas used to validate UI-originated payloads server-side. Per the
 * security requirements, the server never trusts item type, parent id, local
 * id, ADO id, area/iteration path, assigned user, state, or tags coming from
 * the UI — every field is shape-checked here before any logic runs.
 */

export const draftWorkItemTypeSchema = z.enum(["Epic", "Feature", "Product Backlog Item", "User Story", "Task", "Bug"]);

export const draftWorkItemStatusSchema = z.enum(["draft", "approved", "rejected", "needs_rewrite", "created", "failed"]);

export const planningModeSchema = z.enum(["epic-feature-pbi-task", "feature-pbi-task", "pbi-task"]);

export const exportFormatSchema = z.enum(["json", "yaml", "markdown"]);

export const draftWorkItemSchema: z.ZodType<DraftWorkItem> = z.lazy(() =>
  z.object({
    localId: z.string(),
    adoId: z.number().int().positive().optional(),
    url: z.string().optional(),
    type: draftWorkItemTypeSchema,
    title: z.string(),
    description: z.string().optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
    parentLocalId: z.string().optional(),
    children: z.array(draftWorkItemSchema).optional(),
    state: z.string().optional(),
    areaPath: z.string().optional(),
    iterationPath: z.string().optional(),
    assignedTo: z.string().optional(),
    tags: z.array(z.string()).optional(),
    priority: z.number().optional(),
    businessValue: z.number().optional(),
    effort: z.number().optional(),
    status: draftWorkItemStatusSchema.default("draft"),
  })
) as z.ZodType<DraftWorkItem>;

export const planningDraftSchema = z.object({
  draftId: z.string(),
  project: z.string(),
  team: z.string().optional(),
  sourceNarrative: z.string().optional(),
  mode: planningModeSchema.optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  items: z.array(draftWorkItemSchema),
});

export const createApprovedOptionsSchema = z
  .object({
    dryRun: z.boolean().optional(),
    areaPath: z.string().optional(),
    iterationPath: z.string().optional(),
    assignedTo: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .optional();

export const loadBacklogOptionsSchema = z
  .object({
    team: z.string().optional(),
    areaPath: z.string().optional(),
    wiql: z.string().optional(),
    top: z.coerce.number().int().positive().max(1000).optional(),
    ids: z.array(z.coerce.number().int().positive()).max(1000).optional(),
  })
  .optional();
