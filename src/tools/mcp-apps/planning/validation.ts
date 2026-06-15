// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
  ALLOWED_CHILDREN,
  DraftWorkItem,
  DraftWorkItemType,
  MAX_TITLE_LENGTH,
  MODE_ROOT_TYPES,
  PlanningDraft,
  PlanningMode,
  PlanningValidationError,
  PlanningWarning,
  SUPPORTED_TYPES,
  ValidationResult,
} from "./types.js";
import { normalizeDraft } from "./normalize.js";

function isSupportedType(type: unknown): type is DraftWorkItemType {
  return typeof type === "string" && (SUPPORTED_TYPES as readonly string[]).includes(type);
}

/**
 * Detects content that is unsafe to write to an Azure DevOps field: NUL bytes
 * and C0 control characters other than tab/newline/carriage-return. This does
 * not attempt HTML/Markdown sanitisation (creation encodes Markdown fields via
 * the shared encodeFormattedValue); it only blocks raw control bytes that ADO
 * rejects or that could corrupt the request.
 */
function hasUnsafeContent(value: string | undefined): boolean {
  if (!value) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Allow tab (9), line feed (10), carriage return (13); block other C0 controls and DEL (127).
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
      return true;
    }
  }
  return false;
}

/** Find every localId that participates in a parent cycle. */
function findCycleMembers(items: DraftWorkItem[]): Set<string> {
  const parentOf = new Map<string, string | undefined>();
  for (const item of items) {
    parentOf.set(item.localId, item.parentLocalId);
  }

  const cyclic = new Set<string>();
  for (const item of items) {
    const seen = new Set<string>();
    let cursor: string | undefined = item.localId;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        // Everything we walked through is part of (or feeds) a cycle.
        seen.forEach((id) => cyclic.add(id));
        break;
      }
      seen.add(cursor);
      cursor = parentOf.get(cursor);
      if (cursor !== undefined && !parentOf.has(cursor)) break; // orphan ref, handled elsewhere
    }
  }
  return cyclic;
}

/**
 * Validate a draft hierarchy before any creation. Returns a normalized copy of
 * the draft together with errors (block creation) and warnings (informational).
 *
 * @param draft the draft to validate
 * @param mode  optional planning mode; when supplied, root items whose type is
 *              not legal for the mode produce a warning
 */
export function validateDraft(draft: PlanningDraft, mode?: PlanningMode): ValidationResult {
  const effectiveMode = mode ?? draft.mode;
  const normalizedDraft = normalizeDraft(draft);
  const items = normalizedDraft.items;
  const errors: PlanningValidationError[] = [];
  const warnings: PlanningWarning[] = [];

  const idCounts = new Map<string, number>();
  for (const item of items) {
    idCounts.set(item.localId, (idCounts.get(item.localId) ?? 0) + 1);
  }
  const idSet = new Set(items.map((i) => i.localId));

  // Duplicate localIds — reported once per offending id.
  for (const [id, count] of idCounts) {
    if (count > 1) {
      errors.push({ code: "DUPLICATE_LOCAL_ID", message: `localId '${id}' is used by ${count} items; localIds must be unique.`, localId: id, severity: "error" });
    }
  }

  for (const item of items) {
    const id = item.localId;

    if (!id || id.trim().length === 0) {
      errors.push({ code: "MISSING_LOCAL_ID", message: "Every item must have a stable, non-empty localId.", severity: "error" });
    }

    if (!isSupportedType(item.type)) {
      errors.push({
        code: "UNSUPPORTED_TYPE",
        message: `Item '${id}' has unsupported type '${String(item.type)}'. Supported: ${SUPPORTED_TYPES.join(", ")}.`,
        localId: id,
        field: "type",
        severity: "error",
      });
    }

    if (!item.title || item.title.trim().length === 0) {
      errors.push({ code: "MISSING_TITLE", message: `Item '${id}' has an empty title.`, localId: id, field: "title", severity: "error" });
    } else if (item.title.length > MAX_TITLE_LENGTH) {
      errors.push({
        code: "TITLE_TOO_LONG",
        message: `Item '${id}' title is ${item.title.length} characters; Azure DevOps allows at most ${MAX_TITLE_LENGTH}.`,
        localId: id,
        field: "title",
        severity: "error",
      });
    }

    if (hasUnsafeContent(item.title) || hasUnsafeContent(item.description) || (item.acceptanceCriteria ?? []).some(hasUnsafeContent)) {
      errors.push({ code: "UNSAFE_CONTENT", message: `Item '${id}' contains control characters that are unsafe to write to Azure DevOps.`, localId: id, severity: "error" });
    }

    // Parent reference / legal-child checks.
    if (item.parentLocalId) {
      const parent = items.find((p) => p.localId === item.parentLocalId);
      if (!idSet.has(item.parentLocalId) || !parent) {
        errors.push({
          code: "ORPHAN_PARENT",
          message: `Item '${id}' references parent '${item.parentLocalId}', which does not exist in the draft.`,
          localId: id,
          field: "parentLocalId",
          severity: "error",
        });
      } else if (isSupportedType(parent.type) && isSupportedType(item.type)) {
        const legal = ALLOWED_CHILDREN[parent.type];
        if (!legal.includes(item.type)) {
          errors.push({
            code: "ILLEGAL_CHILD_TYPE",
            message: `'${item.type}' is not a legal child of '${parent.type}' (item '${id}' under '${parent.localId}'). Legal children of '${parent.type}': ${legal.length ? legal.join(", ") : "none"}.`,
            localId: id,
            field: "type",
            severity: "error",
          });
        }
      }
    } else if (effectiveMode) {
      // Root item — check it is a legal top-level type for the mode.
      const rootTypes = MODE_ROOT_TYPES[effectiveMode];
      if (isSupportedType(item.type) && !rootTypes.includes(item.type)) {
        warnings.push({
          code: "UNEXPECTED_ROOT_TYPE",
          message: `Root item '${id}' is a '${item.type}', but mode '${effectiveMode}' expects top-level items of type: ${rootTypes.join(", ")}.`,
          localId: id,
          severity: "warning",
        });
      }
    }

    // Informational: requirement-level items usually want acceptance criteria.
    if ((item.type === "Product Backlog Item" || item.type === "User Story") && (!item.acceptanceCriteria || item.acceptanceCriteria.length === 0)) {
      warnings.push({ code: "MISSING_ACCEPTANCE_CRITERIA", message: `Item '${id}' ('${item.title}') has no acceptance criteria.`, localId: id, severity: "info" });
    }

    // Acceptance criteria on a type that does not carry them in ADO.
    if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0 && (item.type === "Epic" || item.type === "Feature" || item.type === "Task")) {
      warnings.push({
        code: "ACCEPTANCE_CRITERIA_IGNORED",
        message: `Acceptance criteria on '${id}' ('${item.type}') will be appended to the description; '${item.type}' has no Acceptance Criteria field.`,
        localId: id,
        severity: "info",
      });
    }
  }

  // Cycle detection.
  const cyclic = findCycleMembers(items);
  for (const id of cyclic) {
    errors.push({ code: "CYCLE", message: `Item '${id}' is part of a parent/child cycle.`, localId: id, field: "parentLocalId", severity: "error" });
  }

  return { valid: errors.length === 0, errors, warnings, normalizedDraft };
}
