// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { encodeFormattedValue } from "../../../utils.js";

/**
 * Shared JSON-patch field builders for Azure DevOps work-item writes. Both the
 * create path ({@link ./create-approved.ts}) and the update path
 * ({@link ./update.ts}) construct patch documents from the same field set;
 * centralising the op shapes here avoids the two diverging in field handling.
 */

export interface PatchOp {
  op: string;
  path: string;
  value: unknown;
}

/** A single `add` op for a System/VSTS field. */
export function fieldOp(field: string, value: unknown): PatchOp {
  return { op: "add", path: `/fields/${field}`, value };
}

/** Field op + the matching multiline-format hint for a Markdown rich-text field. */
export function markdownFieldOps(field: string, markdown: string): PatchOp[] {
  return [fieldOp(field, encodeFormattedValue(markdown, "Markdown")), { op: "add", path: `/multilineFieldsFormat/${field}`, value: "Markdown" }];
}

/** Render acceptance criteria as a Markdown bullet list. */
export function joinAcceptanceCriteria(criteria: string[]): string {
  return criteria.map((c) => `- ${c}`).join("\n");
}

/** Normalise tags to the Azure DevOps wire format (trimmed, de-duped, "; "-joined). */
export function tagsValue(tags: string[]): string {
  return Array.from(new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))).join("; ");
}
