// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { WebApi } from "azure-devops-node-api";
import { createApprovedItems } from "../../../src/tools/mcp-apps/planning/create-approved";
import { PlanningDraft } from "../../../src/tools/mcp-apps/planning/types";

interface PatchOp {
  op: string;
  path: string;
  value: unknown;
}

function draft(items: PlanningDraft["items"]): PlanningDraft {
  return { draftId: "d1", project: "Proj", mode: "epic-feature-pbi-task", createdAt: "", updatedAt: "", items };
}

const fullHierarchy = (statuses: Partial<Record<string, PlanningDraft["items"][number]["status"]>> = {}): PlanningDraft =>
  draft([
    {
      localId: "epic-001",
      type: "Epic",
      title: "Epic",
      status: statuses["epic-001"] ?? "approved",
      children: [
        {
          localId: "feature-001",
          type: "Feature",
          title: "Feature",
          status: statuses["feature-001"] ?? "approved",
          children: [
            {
              localId: "pbi-001",
              type: "Product Backlog Item",
              title: "PBI",
              status: statuses["pbi-001"] ?? "approved",
              children: [{ localId: "task-001", type: "Task", title: "Task", status: statuses["task-001"] ?? "approved" }],
            },
          ],
        },
      ],
    },
  ]);

describe("createApprovedItems", () => {
  let createWorkItem: jest.Mock;
  let getWorkItemTrackingApi: jest.Mock;
  let connection: WebApi;
  let createdTypesInOrder: string[];

  beforeEach(() => {
    createdTypesInOrder = [];
    let counter = 100;
    createWorkItem = jest.fn(async (_doc: unknown, document: PatchOp[], _project: string, type: string) => {
      createdTypesInOrder.push(type);
      return { id: ++counter, _document: document };
    }) as unknown as jest.Mock;
    getWorkItemTrackingApi = jest.fn().mockResolvedValue({ createWorkItem });
    connection = { serverUrl: "https://dev.azure.com/org", getWorkItemTrackingApi } as unknown as WebApi;
  });

  it("does not touch Azure DevOps on a dry run", async () => {
    const result = await createApprovedItems(connection, "Proj", fullHierarchy(), { dryRun: true });
    expect(getWorkItemTrackingApi).not.toHaveBeenCalled();
    expect(createWorkItem).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.created).toHaveLength(4);
    expect(result.created.every((c) => c.creationStatus === "dryRun")).toBe(true);
    expect(result.summary).toEqual({ epics: 1, features: 1, pbis: 1, tasks: 1 });
  });

  it("creates parents before children", async () => {
    await createApprovedItems(connection, "Proj", fullHierarchy(), {});
    expect(createdTypesInOrder).toEqual(["Epic", "Feature", "Product Backlog Item", "Task"]);
  });

  it("maps localId -> adoId and links children to parents", async () => {
    const result = await createApprovedItems(connection, "Proj", fullHierarchy(), {});
    expect(result.failed).toHaveLength(0);
    expect(result.created).toHaveLength(4);

    const epic = result.created.find((c) => c.localId === "epic-001");
    const feature = result.created.find((c) => c.localId === "feature-001");
    expect(epic).toBeDefined();
    expect(feature?.parentAdoId).toBe(epic?.adoId);

    // The Feature's create call must carry a Hierarchy-Reverse relation to the Epic's id.
    const featureCall = createWorkItem.mock.calls.find((c) => c[3] === "Feature");
    expect(featureCall).toBeDefined();
    const featureDoc = (featureCall ? featureCall[1] : []) as PatchOp[];
    const rel = featureDoc.find((op) => op.path === "/relations/-");
    const relValue = rel?.value as { rel: string; url: string } | undefined;
    expect(relValue?.rel).toBe("System.LinkTypes.Hierarchy-Reverse");
    expect(relValue?.url).toContain("/" + epic?.adoId);

    expect(epic?.url).toBe("https://dev.azure.com/org/Proj/_workitems/edit/" + epic?.adoId);
  });

  it("excludes rejected items from creation and reports them as skipped", async () => {
    const result = await createApprovedItems(connection, "Proj", fullHierarchy({ "feature-001": "rejected" }), {});
    expect(createdTypesInOrder).not.toContain("Feature");
    expect(result.skipped.some((s) => s.localId === "feature-001")).toBe(true);
    // The PBI is still created, but without a parent link, and a warning explains why.
    expect(result.created.some((c) => c.localId === "pbi-001" && c.parentAdoId === undefined)).toBe(true);
    expect(result.warnings.some((w) => w.code === "PARENT_NOT_APPROVED" && w.localId === "pbi-001")).toBe(true);
  });

  it("isolates a failed item without corrupting unrelated items", async () => {
    createWorkItem.mockImplementation(async (_doc: unknown, document: PatchOp[], _project: string, type: string) => {
      if (type === "Feature") throw new Error("boom");
      createdTypesInOrder.push(type);
      return { id: Math.floor(Math.random() * 1000) + 1, _document: document };
    });
    const result = await createApprovedItems(connection, "Proj", fullHierarchy(), {});
    expect(result.failed.some((f) => f.localId === "feature-001" && f.error === "boom")).toBe(true);
    // Epic still created; Task still created (its parent PBI is unaffected by the Feature failure).
    expect(result.created.some((c) => c.localId === "epic-001")).toBe(true);
    expect(result.created.some((c) => c.localId === "task-001")).toBe(true);
  });

  it("reports an actionable error naming the type when ADO returns no id (e.g. wrong process type)", async () => {
    // Simulate ADO accepting the call but returning no id for "Product Backlog Item"
    // (the real-world Agile-project failure: that type does not exist there).
    createWorkItem.mockImplementation(async (_doc: unknown, document: PatchOp[], _project: string, type: string) => {
      if (type === "Product Backlog Item") return {};
      createdTypesInOrder.push(type);
      return { id: Math.floor(Math.random() * 1000) + 1, _document: document };
    });
    const result = await createApprovedItems(connection, "Proj", fullHierarchy(), {});
    const pbiFail = result.failed.find((f) => f.localId === "pbi-001");
    expect(pbiFail).toBeDefined();
    expect(pbiFail?.error).toContain("Product Backlog Item");
    expect(pbiFail?.error).toContain("process");
    // Epic + Feature still created; the orphaned Task is created without a parent link.
    expect(result.created.some((c) => c.localId === "epic-001")).toBe(true);
    expect(result.created.some((c) => c.localId === "task-001" && c.parentAdoId === undefined)).toBe(true);
  });

  it("aborts before any write when the draft is fatally invalid", async () => {
    const invalid = draft([{ localId: "epic-001", type: "Epic", title: "", status: "approved" }]);
    const result = await createApprovedItems(connection, "Proj", invalid, {});
    expect(createWorkItem).not.toHaveBeenCalled();
    expect(result.created).toHaveLength(0);
    expect(result.errors && result.errors.some((e) => e.code === "MISSING_TITLE")).toBe(true);
  });

  it("applies default area/iteration paths from options", async () => {
    await createApprovedItems(connection, "Proj", fullHierarchy(), { areaPath: "Proj\\Team", iterationPath: "Proj\\Sprint 1" });
    const epicCall = createWorkItem.mock.calls.find((c) => c[3] === "Epic");
    expect(epicCall).toBeDefined();
    const doc = (epicCall ? epicCall[1] : []) as PatchOp[];
    expect(doc.find((op) => op.path === "/fields/System.AreaPath")?.value).toBe("Proj\\Team");
    expect(doc.find((op) => op.path === "/fields/System.IterationPath")?.value).toBe("Proj\\Sprint 1");
  });
});
