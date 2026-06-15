// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { validateDraft } from "../../../src/tools/mcp-apps/planning/validation";
import { normalizeDraft, flatten, buildTree } from "../../../src/tools/mcp-apps/planning/normalize";
import { PlanningDraft } from "../../../src/tools/mcp-apps/planning/types";

function draft(items: PlanningDraft["items"], mode?: PlanningDraft["mode"]): PlanningDraft {
  return { draftId: "d1", project: "Proj", mode, createdAt: "", updatedAt: "", items };
}

describe("planning normalize", () => {
  it("flattens nested children into a parentLocalId list", () => {
    const nested = draft([
      {
        localId: "epic-001",
        type: "Epic",
        title: "E",
        status: "draft",
        children: [{ localId: "feature-001", type: "Feature", title: "F", status: "draft", children: [{ localId: "pbi-001", type: "Product Backlog Item", title: "P", status: "draft" }] }],
      },
    ]);
    const flat = flatten(nested.items);
    expect(flat.map((i) => i.localId)).toEqual(["epic-001", "feature-001", "pbi-001"]);
    expect(flat.find((i) => i.localId === "feature-001")?.parentLocalId).toBe("epic-001");
    expect(flat.find((i) => i.localId === "pbi-001")?.parentLocalId).toBe("feature-001");
    expect(flat.every((i) => i.children === undefined)).toBe(true);
  });

  it("rebuilds a tree from a flat list", () => {
    const flat = draft([
      { localId: "epic-001", type: "Epic", title: "E", status: "draft" },
      { localId: "feature-001", type: "Feature", title: "F", parentLocalId: "epic-001", status: "draft" },
    ]).items;
    const roots = buildTree(flat);
    expect(roots).toHaveLength(1);
    expect(roots[0].children?.[0].localId).toBe("feature-001");
  });

  it("synthesises stable unique localIds for items that lack them", () => {
    const normalized = normalizeDraft(
      draft([
        { localId: "", type: "Epic", title: "E", status: "draft" },
        { localId: "", type: "Feature", title: "F", status: "draft" },
        { localId: "", type: "Feature", title: "F2", status: "draft" },
      ] as PlanningDraft["items"])
    );
    const ids = normalized.items.map((i) => i.localId);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual(["epic-001", "feature-001", "feature-002"]);
  });

  it("defaults status to draft and trims titles", () => {
    const normalized = normalizeDraft(draft([{ localId: "x", type: "Task", title: "  T  " } as PlanningDraft["items"][number]]));
    expect(normalized.items[0].status).toBe("draft");
    expect(normalized.items[0].title).toBe("T");
  });
});

describe("validateDraft", () => {
  it("accepts a valid Epic -> Feature -> PBI -> Task hierarchy", () => {
    const result = validateDraft(
      draft(
        [
          {
            localId: "epic-001",
            type: "Epic",
            title: "Product Foundation",
            status: "draft",
            children: [
              {
                localId: "feature-001",
                type: "Feature",
                title: "Item Management",
                status: "draft",
                children: [
                  {
                    localId: "pbi-001",
                    type: "Product Backlog Item",
                    title: "Create item",
                    acceptanceCriteria: ["Given...", "When...", "Then..."],
                    status: "draft",
                    children: [{ localId: "task-001", type: "Task", title: "Build form", status: "draft" }],
                  },
                ],
              },
            ],
          },
        ],
        "epic-feature-pbi-task"
      )
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("flags a PBI placed directly under an Epic (skipping Feature) as an illegal child", () => {
    const result = validateDraft(
      draft(
        [
          { localId: "epic-001", type: "Epic", title: "E", status: "draft" },
          { localId: "pbi-001", type: "Product Backlog Item", title: "P", parentLocalId: "epic-001", status: "draft" },
        ],
        "epic-feature-pbi-task"
      )
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ILLEGAL_CHILD_TYPE" && e.localId === "pbi-001")).toBe(true);
  });

  it("fails on a parent/child cycle", () => {
    const result = validateDraft(
      draft([
        { localId: "a", type: "Feature", title: "A", parentLocalId: "b", status: "draft" },
        { localId: "b", type: "Feature", title: "B", parentLocalId: "a", status: "draft" },
      ])
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CYCLE")).toBe(true);
  });

  it("fails when an item has an empty title", () => {
    const result = validateDraft(draft([{ localId: "epic-001", type: "Epic", title: "", status: "draft" }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MISSING_TITLE" && e.localId === "epic-001")).toBe(true);
  });

  it("fails on a parent reference that does not exist", () => {
    const result = validateDraft(draft([{ localId: "feature-001", type: "Feature", title: "F", parentLocalId: "ghost", status: "draft" }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "ORPHAN_PARENT")).toBe(true);
  });

  it("fails on an unsupported type", () => {
    const result = validateDraft(draft([{ localId: "x", type: "Initiative" as PlanningDraft["items"][number]["type"], title: "X", status: "draft" }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNSUPPORTED_TYPE")).toBe(true);
  });

  it("rejects control characters as unsafe content", () => {
    const result = validateDraft(draft([{ localId: "x", type: "Task", title: "bad" + String.fromCharCode(0) + "title", status: "draft" }]));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "UNSAFE_CONTENT")).toBe(true);
  });

  it("warns (not errors) when a root type is unexpected for the mode", () => {
    const result = validateDraft(draft([{ localId: "feature-001", type: "Feature", title: "F", status: "draft" }], "epic-feature-pbi-task"));
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.code === "UNEXPECTED_ROOT_TYPE")).toBe(true);
  });

  it("warns when a PBI has no acceptance criteria", () => {
    const result = validateDraft(draft([{ localId: "pbi-001", type: "Product Backlog Item", title: "P", status: "draft" }]));
    expect(result.warnings.some((w) => w.code === "MISSING_ACCEPTANCE_CRITERIA")).toBe(true);
  });
});
