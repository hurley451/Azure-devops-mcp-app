// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { buildGenerationContract } from "../../../src/tools/mcp-apps/planning/generate";

describe("buildGenerationContract", () => {
  const base = { draftId: "d-123", project: "InventoryWizard", team: "Core", mode: "epic-feature-pbi-task" as const, maxDepth: 4, processTemplateHint: "Scrum" as const };

  it("echoes the inputs and embeds the project, mode, and depth in the instructions", () => {
    const c = buildGenerationContract(base);
    expect(c.draftId).toBe("d-123");
    expect(c.mode).toBe("epic-feature-pbi-task");
    expect(c.maxDepth).toBe(4);
    expect(c.processTemplateHint).toBe("Scrum");
    expect(c.instructions).toContain("InventoryWizard");
    expect(c.instructions).toContain("epic-feature-pbi-task");
    expect(c.instructions).toContain("4 levels");
  });

  it("includes the hierarchy rules and a schema example", () => {
    const c = buildGenerationContract(base);
    expect(c.instructions).toContain("Epic → Feature");
    expect(c.instructions).toContain("Product Backlog Item → Task");
    expect(c.schemaExample).toContain('"type": "Epic"');
    expect(c.schemaExample).toContain("acceptanceCriteria");
  });

  it("states the expected top-level type for the mode", () => {
    const feat = buildGenerationContract({ ...base, mode: "feature-pbi-task" });
    expect(feat.instructions).toContain("Feature");
    const pbi = buildGenerationContract({ ...base, mode: "pbi-task" });
    expect(pbi.instructions).toContain("Product Backlog Item or User Story");
  });
});
