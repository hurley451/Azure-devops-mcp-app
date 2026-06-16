// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { WebApi } from "azure-devops-node-api";
import { syncWorkItems } from "../../../src/tools/mcp-apps/planning/sync";

function connectionWith(getWorkItemsBatch: jest.Mock): WebApi {
  return { serverUrl: "https://dev.azure.com/org", getWorkItemTrackingApi: jest.fn().mockResolvedValue({ getWorkItemsBatch }) } as unknown as WebApi;
}

describe("syncWorkItems", () => {
  it("short-circuits on empty ids without touching ADO", async () => {
    const getWorkItemsBatch = jest.fn();
    const connection = connectionWith(getWorkItemsBatch as unknown as jest.Mock);
    const res = await syncWorkItems(connection, "Proj", []);
    expect(res).toEqual({ items: [], missing: [], warnings: [] });
    expect(connection.getWorkItemTrackingApi).not.toHaveBeenCalled();
  });

  it("maps returned fields and reports missing ids", async () => {
    const getWorkItemsBatch = jest.fn(async () => [
      {
        id: 1,
        fields: {
          "System.WorkItemType": "Task",
          "System.Title": "Do it",
          "System.State": "New",
          "System.Parent": 5,
          "System.AreaPath": "Proj\\A",
          "System.IterationPath": "Proj\\S1",
          "System.Tags": "x; y",
          "System.ChangedDate": "2026-01-01T00:00:00Z",
        },
      },
    ]);
    const connection = connectionWith(getWorkItemsBatch as unknown as jest.Mock);
    const res = await syncWorkItems(connection, "Proj", [1, 2, 2]);

    expect(getWorkItemsBatch).toHaveBeenCalledWith({ ids: [1, 2], fields: expect.arrayContaining(["System.Id", "System.Parent", "System.State"]) }, "Proj");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ adoId: 1, type: "Task", title: "Do it", state: "New", parentAdoId: 5, areaPath: "Proj\\A" });
    expect(res.items[0].url).toBe("https://dev.azure.com/org/Proj/_workitems/edit/1");
    expect(res.missing).toEqual([2]);
    expect(res.warnings.some((w) => w.code === "MISSING_WORK_ITEM" && w.message.includes("2"))).toBe(true);
  });

  it("treats a missing System.Parent as no parent", async () => {
    const getWorkItemsBatch = jest.fn(async () => [{ id: 7, fields: { "System.WorkItemType": "Epic", "System.Title": "E" } }]);
    const connection = connectionWith(getWorkItemsBatch as unknown as jest.Mock);
    const res = await syncWorkItems(connection, "Proj", [7]);
    expect(res.items[0].parentAdoId).toBeUndefined();
    expect(res.missing).toEqual([]);
  });
});
