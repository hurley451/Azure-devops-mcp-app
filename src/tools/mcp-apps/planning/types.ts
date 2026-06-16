// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Shared data model for the ADO Planning Workspace MCP App.
 *
 * Drafts are an in-memory / exportable representation of a proposed Azure DevOps
 * work item hierarchy. Nothing here writes to Azure DevOps — creation happens
 * explicitly in {@link ./create-approved.ts} after human approval.
 */

export type DraftWorkItemType = "Epic" | "Feature" | "Product Backlog Item" | "User Story" | "Task" | "Bug";

export type DraftWorkItemStatus = "draft" | "approved" | "rejected" | "needs_rewrite" | "created" | "failed";

export type PlanningMode = "epic-feature-pbi-task" | "feature-pbi-task" | "pbi-task";

export type ProcessTemplateHint = "Agile" | "Scrum" | "CMMI" | "Basic" | "Unknown";

export type ExportFormat = "json" | "yaml" | "markdown";

export interface PlanningWarning {
  code: string;
  message: string;
  localId?: string;
  severity: "info" | "warning";
}

export interface PlanningValidationError {
  code: string;
  message: string;
  localId?: string;
  field?: string;
  severity: "error";
}

export interface DraftWorkItem {
  localId: string;
  adoId?: number;
  url?: string;
  type: DraftWorkItemType;
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  parentLocalId?: string;
  children?: DraftWorkItem[];
  state?: string;
  areaPath?: string;
  iterationPath?: string;
  assignedTo?: string;
  tags?: string[];
  priority?: number;
  businessValue?: number;
  effort?: number;
  status: DraftWorkItemStatus;
  warnings?: PlanningWarning[];
  errors?: PlanningValidationError[];
}

export interface PlanningDraft {
  draftId: string;
  project: string;
  team?: string;
  sourceNarrative?: string;
  mode?: PlanningMode;
  createdAt: string;
  updatedAt: string;
  items: DraftWorkItem[];
}

export interface ValidationResult {
  valid: boolean;
  errors: PlanningValidationError[];
  warnings: PlanningWarning[];
  normalizedDraft: PlanningDraft;
}

export interface CreatedWorkItem {
  localId: string;
  adoId?: number;
  url?: string;
  type: DraftWorkItemType;
  title: string;
  parentLocalId?: string;
  parentAdoId?: number;
  creationStatus: "created" | "dryRun";
}

export interface SkippedDraftItem {
  localId: string;
  type: DraftWorkItemType;
  title: string;
  reason: string;
}

export interface FailedDraftItem {
  localId: string;
  type: DraftWorkItemType;
  title: string;
  error: string;
}

export interface CreateApprovedSummary {
  epics: number;
  features: number;
  pbis: number;
  tasks: number;
}

export interface CreateApprovedResult {
  dryRun: boolean;
  created: CreatedWorkItem[];
  skipped: SkippedDraftItem[];
  failed: FailedDraftItem[];
  summary: CreateApprovedSummary;
  warnings: PlanningWarning[];
  /** Fatal validation errors that prevented any creation. Present only when the draft was invalid. */
  errors?: PlanningValidationError[];
}

export interface CreateApprovedOptions {
  dryRun?: boolean;
  areaPath?: string;
  iterationPath?: string;
  assignedTo?: string;
  tags?: string[];
}

export interface SyncedWorkItem {
  adoId: number;
  type?: string;
  title?: string;
  state?: string;
  parentAdoId?: number;
  areaPath?: string;
  iterationPath?: string;
  tags?: string;
  changedDate?: string;
  url?: string;
}

export interface SyncResult {
  items: SyncedWorkItem[];
  missing: number[];
  warnings: PlanningWarning[];
}

export interface ExportResult {
  contentType: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Hierarchy rules (process-agnostic).
// ---------------------------------------------------------------------------

/** Every work item type the planner understands. */
export const SUPPORTED_TYPES: readonly DraftWorkItemType[] = ["Epic", "Feature", "Product Backlog Item", "User Story", "Task", "Bug"];

/** Type guard for a supported work item type. */
export function isSupportedType(type: unknown): type is DraftWorkItemType {
  return typeof type === "string" && (SUPPORTED_TYPES as readonly string[]).includes(type);
}

/**
 * Work item types that have a native Azure DevOps "Acceptance Criteria" field.
 * Single source of truth: creation writes AC to this field for these types, and
 * appends it to the description for the others. Keep both code paths reading this.
 */
export const TYPES_WITH_ACCEPTANCE_CRITERIA: readonly DraftWorkItemType[] = ["Product Backlog Item", "User Story", "Bug"];

/** Legal child types for each parent type. An empty array means the type is a leaf. */
export const ALLOWED_CHILDREN: Record<DraftWorkItemType, DraftWorkItemType[]> = {
  "Epic": ["Feature"],
  "Feature": ["Product Backlog Item", "User Story", "Bug"],
  "Product Backlog Item": ["Task", "Bug"],
  "User Story": ["Task", "Bug"],
  "Bug": ["Task"],
  "Task": [],
};

/**
 * Creation order fallback when no parent/child relationship constrains it.
 * Topological order (parents before children) takes precedence; this only
 * breaks ties so that, e.g., sibling Epics and Features come out predictably.
 */
export const TYPE_ORDER: DraftWorkItemType[] = ["Epic", "Feature", "Product Backlog Item", "User Story", "Bug", "Task"];

/** Allowed root (top-level) types for each planning mode. */
export const MODE_ROOT_TYPES: Record<PlanningMode, DraftWorkItemType[]> = {
  "epic-feature-pbi-task": ["Epic"],
  "feature-pbi-task": ["Feature"],
  "pbi-task": ["Product Backlog Item", "User Story"],
};

/** Azure DevOps System.Title field length limit. */
export const MAX_TITLE_LENGTH = 255;

/** Stable prefix used when synthesising a localId for an item that lacks one. */
export const TYPE_ID_PREFIX: Record<DraftWorkItemType, string> = {
  "Epic": "epic",
  "Feature": "feature",
  "Product Backlog Item": "pbi",
  "User Story": "story",
  "Task": "task",
  "Bug": "bug",
};
