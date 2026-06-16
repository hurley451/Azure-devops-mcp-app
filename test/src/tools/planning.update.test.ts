// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { WebApi } from "azure-devops-node-api";
import { updateWorkItems } from "../../../src/tools/mcp-apps/planning/update";
import { UpdateWorkItemInput } from "../../../src/tools/mcp-apps/planning/types";

interface PatchOp {
  op: string;
  path: string;
  value: unknown;
}

describe("updateWorkItems", () => {
  let updateWorkItem: jest.Mock;
  let connection: WebApi;

  beforeEach(() => {
    updateWorkItem = jest.fn(async (_h: unknown, _doc: PatchOp[], id: number) => ({ id })) as unknown as jest.Mock;
    connection = {
      serverUrl: "https://dev.azure.com/org",
      getWorkItemTrackingApi: jest.fn().mockResolvedValue({ updateWorkItem }),
    } as unknown as WebApi;
  });

  function lastDoc(): PatchOp[] {
    const call = updateWorkItem.mock.calls[updateWorkItem.mock.calls.length - 1];
    return call[1] as PatchOp[];
  }

  it("patches only the supplied fields and reports which changed", async () => {
    const result = await updateWorkItems(connection, "Proj", [{ adoId: 250, title: "New title", state: "Active", tags: ["a", " b ", "a"] }]);
    expect(result.dryRun).toBe(false);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({ adoId: 250, fields: ["Title", "State", "Tags"] });
    expect(result.updated[0].url).toBe("https://dev.azure.com/org/Proj/_workitems/edit/250");

    const doc = lastDoc();
    expect(doc.find((o) => o.path === "/fields/System.Title")?.value).toBe("New title");
    expect(doc.find((o) => o.path === "/fields/System.State")?.value).toBe("Active");
    // Tags trimmed, de-duped, joined.
    expect(doc.find((o) => o.path === "/fields/System.Tags")?.value).toBe("a; b");
    // No ops for fields not supplied.
    expect(doc.some((o) => o.path === "/fields/System.Description")).toBe(false);
  });

  it("encodes description and acceptance criteria with a Markdown format hint", async () => {
    await updateWorkItems(connection, "Proj", [{ adoId: 251, description: "hi", acceptanceCriteria: ["given", "then"] }]);
    const doc = lastDoc();
    expect(doc.some((o) => o.path === "/fields/System.Description")).toBe(true);
    expect(doc.find((o) => o.path === "/multilineFieldsFormat/System.Description")?.value).toBe("Markdown");
    expect(doc.some((o) => o.path === "/fields/Microsoft.VSTS.Common.AcceptanceCriteria")).toBe(true);
    expect(doc.find((o) => o.path === "/multilineFieldsFormat/Microsoft.VSTS.Common.AcceptanceCriteria")?.value).toBe("Markdown");
  });

  it("passes validateOnly=true for a dry run (no persisted write)", async () => {
    const result = await updateWorkItems(connection, "Proj", [{ adoId: 250, title: "X" }], { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.updated).toHaveLength(1);
    // 5th arg of updateWorkItem(customHeaders, document, id, project, validateOnly)
    expect(updateWorkItem.mock.calls[0][4]).toBe(true);
  });

  it("isolates a failing item without aborting the rest", async () => {
    updateWorkItem.mockImplementation(async (_h: unknown, _doc: PatchOp[], id: number) => {
      if (id === 251) throw new Error("boom");
      return { id };
    });
    const result = await updateWorkItems(connection, "Proj", [
      { adoId: 250, title: "A" },
      { adoId: 251, title: "B" },
      { adoId: 252, title: "C" },
    ]);
    expect(result.failed.some((f) => f.adoId === 251 && f.error === "boom")).toBe(true);
    expect(result.updated.map((u) => u.adoId).sort()).toEqual([250, 252]);
  });

  it("skips items with no adoId or no changed fields, and writes nothing for them", async () => {
    const items = [{ title: "no id" } as unknown as UpdateWorkItemInput, { adoId: 250 }];
    const result = await updateWorkItems(connection, "Proj", items);
    expect(updateWorkItem).not.toHaveBeenCalled();
    expect(result.updated).toHaveLength(0);
    expect(result.skipped.some((s) => s.reason.includes("adoId"))).toBe(true);
    expect(result.skipped.some((s) => s.adoId === 250 && s.reason.includes("No changed fields"))).toBe(true);
  });
});
