// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { exportDraft } from "../../../src/tools/mcp-apps/planning/export";
import { PlanningDraft } from "../../../src/tools/mcp-apps/planning/types";

const sample: PlanningDraft = {
  draftId: "d1",
  project: "Proj",
  team: "Team",
  mode: "epic-feature-pbi-task",
  createdAt: "",
  updatedAt: "",
  items: [
    {
      localId: "epic-001",
      type: "Epic",
      title: "Foundation",
      status: "draft",
      children: [
        {
          localId: "pbi-001",
          type: "Product Backlog Item",
          title: "Create item",
          acceptanceCriteria: ["Given X", "Then Y"],
          parentLocalId: "epic-001",
          status: "approved",
        } as PlanningDraft["items"][number],
      ],
    },
  ],
};

describe("exportDraft", () => {
  it("exports valid, re-parseable JSON nested by hierarchy", () => {
    const out = exportDraft(sample, "json");
    expect(out.contentType).toBe("application/json");
    const parsed = JSON.parse(out.content);
    expect(parsed.items[0].localId).toBe("epic-001");
    expect(parsed.items[0].children[0].localId).toBe("pbi-001");
  });

  it("exports Markdown with type, title, status and acceptance criteria", () => {
    const out = exportDraft(sample, "markdown");
    expect(out.contentType).toBe("text/markdown");
    expect(out.content).toContain("**[Epic]** Foundation");
    expect(out.content).toContain("**[Product Backlog Item]** Create item");
    expect(out.content).toContain("Acceptance Criteria:");
    expect(out.content).toContain("Given X");
  });

  it("exports YAML containing the draft fields", () => {
    const out = exportDraft(sample, "yaml");
    expect(out.contentType).toBe("application/yaml");
    expect(out.content).toContain("project: Proj");
    expect(out.content).toContain("localId: epic-001");
  });

  it("throws on an unknown format", () => {
    expect(() => exportDraft(sample, "xml" as "json")).toThrow();
  });
});
