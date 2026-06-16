// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { WebApi } from "azure-devops-node-api";
import { loadBacklog } from "../../../src/tools/mcp-apps/planning/backlog";

interface WitItem {
  id: number;
  fields: Record<string, unknown>;
}

const ITEMS: WitItem[] = [
  {
    id: 250,
    fields: {
      "System.WorkItemType": "Feature",
      "System.Title": "Meta-Data Scan",
      "System.State": "New",
      "System.AreaPath": "MungePoint\\Platform Foundation\\CDI",
      "System.IterationPath": "MungePoint\\Sprint 1",
      "System.Tags": "mcp; r1 ",
      "System.AssignedTo": { uniqueName: "a@b.com", displayName: "A B" },
      "System.Description": "<p>Hello <b>world</b></p>",
    },
  },
  {
    id: 251,
    fields: {
      "System.WorkItemType": "Feature",
      "System.Title": "Custom Fields",
      "System.State": "Active",
      "System.Parent": 250,
    },
  },
  {
    id: 252,
    fields: {
      "System.WorkItemType": "Bug",
      "System.Title": "401 error",
      "System.State": "New",
      "System.Parent": 999,
      "Microsoft.VSTS.Common.AcceptanceCriteria": "<div>given/when/then</div>",
    },
  },
  {
    id: 253,
    fields: { "System.WorkItemType": "Issue", "System.Title": "Unsupported type" },
  },
];

function connection(queryByWiql: jest.Mock, getWorkItemsBatch: jest.Mock): WebApi {
  return {
    serverUrl: "https://dev.azure.com/org",
    getWorkItemTrackingApi: jest.fn().mockResolvedValue({ queryByWiql, getWorkItemsBatch }),
  } as unknown as WebApi;
}

describe("loadBacklog", () => {
  it("queries by WIQL then maps existing items into a draft", async () => {
    const queryByWiql = jest.fn(async () => ({ workItems: ITEMS.map((i) => ({ id: i.id })) })) as unknown as jest.Mock;
    const getWorkItemsBatch = jest.fn(async () => ITEMS) as unknown as jest.Mock;
    const result = await loadBacklog(connection(queryByWiql, getWorkItemsBatch), "Proj");

    expect(queryByWiql).toHaveBeenCalled();
    expect(result.draft.project).toBe("Proj");
    // 253 (Issue) is skipped as an unsupported type.
    expect(result.draft.items.map((i) => i.localId)).toEqual(["wi-250", "wi-251", "wi-252"]);
    expect(result.skipped.some((s) => s.adoId === 253 && s.type === "Issue")).toBe(true);

    const f = result.draft.items[0];
    expect(f).toMatchObject({ adoId: 250, type: "Feature", title: "Meta-Data Scan", state: "New", status: "created" });
    expect(f.url).toBe("https://dev.azure.com/org/Proj/_workitems/edit/250");
    expect(f.description).toBe("Hello world"); // HTML stripped to text
    expect(f.assignedTo).toBe("a@b.com"); // identity -> uniqueName
    expect(f.tags).toEqual(["mcp", "r1"]); // split + trimmed
  });

  it("links a child to its parent only when the parent is in the loaded set", async () => {
    const queryByWiql = jest.fn(async () => ({ workItems: ITEMS.map((i) => ({ id: i.id })) })) as unknown as jest.Mock;
    const getWorkItemsBatch = jest.fn(async () => ITEMS) as unknown as jest.Mock;
    const result = await loadBacklog(connection(queryByWiql, getWorkItemsBatch), "Proj");

    const child = result.draft.items.find((i) => i.localId === "wi-251");
    const orphan = result.draft.items.find((i) => i.localId === "wi-252");
    expect(child?.parentLocalId).toBe("wi-250"); // parent 250 is in the set
    expect(orphan?.parentLocalId).toBeUndefined(); // parent 999 is not loaded
    // Acceptance criteria on 252 are flagged as not imported.
    expect(result.warnings.some((w) => w.code === "AC_NOT_IMPORTED" && w.localId === "wi-252")).toBe(true);
  });

  it("loads explicit ids without running a WIQL query", async () => {
    const queryByWiql = jest.fn() as unknown as jest.Mock;
    const getWorkItemsBatch = jest.fn(async () => [ITEMS[0]]) as unknown as jest.Mock;
    const result = await loadBacklog(connection(queryByWiql, getWorkItemsBatch), "Proj", { ids: [250] });

    expect(queryByWiql).not.toHaveBeenCalled();
    expect(getWorkItemsBatch).toHaveBeenCalledWith(expect.objectContaining({ ids: [250] }), "Proj");
    expect(result.draft.items).toHaveLength(1);
    expect(result.draft.items[0].localId).toBe("wi-250");
  });

  it("caps the number of ids fetched (both the WIQL and explicit-ids paths)", async () => {
    // WIQL path: 4 refs, top=2 -> only 2 ids batched.
    const queryByWiql = jest.fn(async () => ({ workItems: ITEMS.map((i) => ({ id: i.id })) })) as unknown as jest.Mock;
    const wiqlBatch = jest.fn(async () => [ITEMS[0], ITEMS[1]]) as unknown as jest.Mock;
    await loadBacklog(connection(queryByWiql, wiqlBatch), "Proj", { top: 2 });
    expect((wiqlBatch.mock.calls[0][0] as { ids: number[] }).ids).toEqual([250, 251]);

    // Explicit-ids path: 4 ids, top=2 -> only 2 batched.
    const idsBatch = jest.fn(async () => [ITEMS[0], ITEMS[1]]) as unknown as jest.Mock;
    await loadBacklog(connection(jest.fn() as unknown as jest.Mock, idsBatch), "Proj", { ids: [250, 251, 252, 253], top: 2 });
    expect((idsBatch.mock.calls[0][0] as { ids: number[] }).ids).toEqual([250, 251]);
  });

  it("returns an empty draft when the query yields no ids", async () => {
    const queryByWiql = jest.fn(async () => ({ workItems: [] })) as unknown as jest.Mock;
    const getWorkItemsBatch = jest.fn() as unknown as jest.Mock;
    const result = await loadBacklog(connection(queryByWiql, getWorkItemsBatch), "Proj");

    expect(result.draft.items).toEqual([]);
    expect(getWorkItemsBatch).not.toHaveBeenCalled();
  });
});
