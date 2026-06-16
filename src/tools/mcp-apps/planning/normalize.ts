// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DraftWorkItem, DraftWorkItemType, isSupportedType, PlanningDraft, TYPE_ID_PREFIX } from "./types.js";

/**
 * Flatten a (possibly nested) list of draft items into a flat array where each
 * item carries an explicit `parentLocalId` and no `children`. Nesting wins over
 * an explicit `parentLocalId` so a caller can supply either representation.
 */
export function flatten(items: DraftWorkItem[], parentLocalId?: string): DraftWorkItem[] {
  const out: DraftWorkItem[] = [];
  for (const item of items) {
    const { children, ...rest } = item;
    out.push({ ...rest, parentLocalId: parentLocalId ?? item.parentLocalId });
    if (children && children.length > 0) {
      out.push(...flatten(children, item.localId));
    }
  }
  return out;
}

/**
 * Rebuild a nested tree (roots with `children`) from a flat list. Items whose
 * `parentLocalId` does not resolve to a known item are treated as roots so the
 * tree never loses an item. Original input order is preserved within each level.
 */
export function buildTree(flat: DraftWorkItem[]): DraftWorkItem[] {
  const byId = new Map<string, DraftWorkItem>();
  const nodes: DraftWorkItem[] = flat.map((item) => {
    const { children, ...rest } = item;
    void children;
    const node = { ...rest, children: [] as DraftWorkItem[] };
    byId.set(node.localId, node);
    return node;
  });

  const roots: DraftWorkItem[] = [];
  for (const node of nodes) {
    const parent = node.parentLocalId ? byId.get(node.parentLocalId) : undefined;
    if (parent && parent !== node) {
      (parent.children ??= []).push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * Produce a canonical, deterministic form of a draft:
 *  - items flattened to a parentLocalId-based list (no `children`);
 *  - every item given a stable, unique `localId` (synthesised when missing);
 *  - `status` defaulted to "draft";
 *  - titles trimmed; tag/AC entries trimmed and emptied entries dropped.
 *
 * Pure and side-effect free — no timestamps, no randomness — so it is safe to
 * call repeatedly and to assert on in tests.
 */
export function normalizeDraft(draft: PlanningDraft): PlanningDraft {
  const flat = flatten(draft.items ?? []);

  // Reserve every localId that is already present so synthesised ids never collide.
  const used = new Set<string>();
  for (const item of flat) {
    if (item.localId && item.localId.trim().length > 0) {
      used.add(item.localId.trim());
    }
  }

  const counters: Record<string, number> = {};
  const nextId = (type: DraftWorkItemType): string => {
    const prefix = TYPE_ID_PREFIX[type] ?? "item";
    let candidate: string;
    do {
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      candidate = `${prefix}-${String(counters[prefix]).padStart(3, "0")}`;
    } while (used.has(candidate));
    used.add(candidate);
    return candidate;
  };

  const items: DraftWorkItem[] = flat.map((item) => {
    const type = item.type;
    const localId = item.localId && item.localId.trim().length > 0 ? item.localId.trim() : isSupportedType(type) ? nextId(type) : nextId("Task");

    const tags = item.tags?.map((t) => (typeof t === "string" ? t.trim() : "")).filter((t) => t.length > 0);
    const acceptanceCriteria = item.acceptanceCriteria?.map((a) => (typeof a === "string" ? a.trim() : "")).filter((a) => a.length > 0);

    return {
      ...item,
      localId,
      type,
      title: typeof item.title === "string" ? item.title.trim() : item.title,
      parentLocalId: item.parentLocalId && item.parentLocalId.trim().length > 0 ? item.parentLocalId.trim() : undefined,
      status: item.status ?? "draft",
      tags: tags && tags.length > 0 ? tags : undefined,
      acceptanceCriteria: acceptanceCriteria && acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
      children: undefined,
    };
  });

  return { ...draft, items };
}
