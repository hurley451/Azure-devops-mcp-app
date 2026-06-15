// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DraftWorkItem, ExportFormat, ExportResult, PlanningDraft } from "./types.js";
import { buildTree, normalizeDraft } from "./normalize.js";

/** Minimal, dependency-free YAML emitter for the JSON-ish draft shape. */
function toYaml(value: unknown, indent = 0): string {
  const pad = "  ".repeat(indent);

  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return yamlScalar(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value
      .map((entry) => {
        if (entry !== null && typeof entry === "object") {
          const block = toYaml(entry, indent + 1).replace(new RegExp(`^${"  ".repeat(indent + 1)}`), "");
          return `${pad}- ${block}`;
        }
        return `${pad}- ${toYaml(entry, 0)}`;
      })
      .join("\n");
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
  if (keys.length === 0) return "{}";
  return keys
    .map((key, idx) => {
      const v = obj[key];
      const prefix = idx === 0 ? "" : pad;
      if (v !== null && typeof v === "object") {
        const nested = toYaml(v, indent + 1);
        if (Array.isArray(v)) {
          return `${prefix}${key}:\n${nested}`;
        }
        return `${prefix}${key}:\n${nested}`;
      }
      return `${prefix}${key}: ${toYaml(v, 0)}`;
    })
    .join(`\n`);
}

function yamlScalar(s: string): string {
  // Quote only when a plain scalar would be misread: empty, surrounded by
  // whitespace, key/comment-like, control whitespace, a leading YAML indicator,
  // a reserved word, or something that parses as a number/bool.
  const needsQuote =
    s === "" || /^\s|\s$/.test(s) || /: |:$| #/.test(s) || /[\n\t]/.test(s) || /^[-?:,[\]{}#&*!|>%@`'"]/.test(s) || /^(true|false|null|~|yes|no|on|off)$/i.test(s) || /^[+-]?(\d|\.\d)/.test(s);
  if (needsQuote) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t")}"`;
  }
  return s;
}

function renderMarkdownNode(node: DraftWorkItem, depth: number): string[] {
  const indent = "  ".repeat(depth);
  const ado = node.adoId ? ` [#${node.adoId}](${node.url ?? ""})` : "";
  const lines = [`${indent}- **[${node.type}]** ${node.title} _(${node.status})_${ado}`];
  if (node.description && node.description.trim().length > 0) {
    lines.push(`${indent}  - ${node.description.trim().replace(/\n+/g, " ")}`);
  }
  if (node.acceptanceCriteria && node.acceptanceCriteria.length > 0) {
    lines.push(`${indent}  - Acceptance Criteria:`);
    for (const ac of node.acceptanceCriteria) {
      lines.push(`${indent}    - ${ac}`);
    }
  }
  for (const child of node.children ?? []) {
    lines.push(...renderMarkdownNode(child, depth + 1));
  }
  return lines;
}

function renderMarkdown(draft: PlanningDraft, roots: DraftWorkItem[]): string {
  const header = [`# Planning Draft: ${draft.project}`, "", `- Draft: \`${draft.draftId}\``, draft.team ? `- Team: ${draft.team}` : undefined, `- Items: ${countItems(roots)}`, ""].filter(
    (l) => l !== undefined
  ) as string[];
  const body = roots.flatMap((r) => renderMarkdownNode(r, 0));
  return [...header, ...body, ""].join("\n");
}

function countItems(nodes: DraftWorkItem[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countItems(n.children ?? []), 0);
}

/** Export a planning draft as JSON, YAML, or Markdown (nested by hierarchy). */
export function exportDraft(draft: PlanningDraft, format: ExportFormat): ExportResult {
  const normalized = normalizeDraft(draft);
  const roots = buildTree(normalized.items);
  const treeDraft = { ...normalized, items: roots };

  switch (format) {
    case "json":
      return { contentType: "application/json", content: JSON.stringify(treeDraft, null, 2) };
    case "yaml":
      return { contentType: "application/yaml", content: toYaml(stripUndefined(treeDraft)) + "\n" };
    case "markdown":
      return { contentType: "text/markdown", content: renderMarkdown(normalized, roots) };
    default:
      throw new Error(`Unsupported export format: ${String(format)}`);
  }
}

/** Recursively drop undefined-valued keys so YAML/JSON stay clean. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
