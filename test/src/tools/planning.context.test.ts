// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest } from "@jest/globals";
import { WebApi } from "azure-devops-node-api";
import { getPlanningContext } from "../../../src/tools/mcp-apps/planning/context";

// structureType: Area = 0, Iteration = 1 (TreeNodeStructureType).
const classificationNodes = [
  { name: "Proj", structureType: 0, children: [{ name: "Area1", structureType: 0, children: [] }] },
  { name: "Proj", structureType: 1, children: [{ name: "Sprint 1", structureType: 1, children: [] }] },
];

// Agile project types: requirement type is "User Story" (not "Product Backlog Item").
const agileTypes = [{ name: "Epic" }, { name: "Feature" }, { name: "User Story" }, { name: "Task" }, { name: "Bug" }];

function fullConnection(): WebApi {
  return {
    getCoreApi: jest.fn().mockResolvedValue({ getTeams: jest.fn().mockResolvedValue([{ id: "t1", name: "Team A" }]) }),
    getWorkItemTrackingApi: jest.fn().mockResolvedValue({
      getClassificationNodes: jest.fn().mockResolvedValue(classificationNodes),
      getWorkItemTypes: jest.fn().mockResolvedValue(agileTypes),
    }),
    getWorkApi: jest.fn().mockResolvedValue({
      getBacklogs: jest.fn().mockResolvedValue([{ id: "b1", name: "Stories", rank: 1, workItemTypes: [{ name: "User Story" }] }]),
      getTeamSettings: jest.fn().mockResolvedValue({ defaultIteration: { path: "Proj\\Sprint 1" }, backlogIteration: { path: "Proj" } }),
      getTeamFieldValues: jest.fn().mockResolvedValue({ defaultValue: "Proj\\Area1" }),
    }),
  } as unknown as WebApi;
}

/** A connection whose project exposes the given work item type names. */
function typesConnection(typeNames: string[]): WebApi {
  return {
    getCoreApi: jest.fn().mockResolvedValue({ getTeams: jest.fn().mockResolvedValue([]) }),
    getWorkItemTrackingApi: jest.fn().mockResolvedValue({
      getClassificationNodes: jest.fn().mockResolvedValue(classificationNodes),
      getWorkItemTypes: jest.fn().mockResolvedValue(typeNames.map((name) => ({ name }))),
    }),
    getWorkApi: jest.fn(),
  } as unknown as WebApi;
}

describe("getPlanningContext", () => {
  it("collects teams, area/iteration paths, backlogs and team defaults when a team is given", async () => {
    const ctx = await getPlanningContext(fullConnection(), "Proj", "Team A");
    expect(ctx.teams).toEqual([{ id: "t1", name: "Team A" }]);
    expect(ctx.areaPaths).toEqual(expect.arrayContaining(["Proj", "Proj\\Area1"]));
    expect(ctx.iterationPaths).toEqual(expect.arrayContaining(["Proj\\Sprint 1"]));
    expect(ctx.backlogs[0]).toMatchObject({ name: "Stories", workItemTypes: ["User Story"] });
    expect(ctx.processHints.pbiTypeName).toBe("User Story"); // derived from project work item types
    expect(ctx.defaultAreaPath).toBe("Proj\\Area1");
    expect(ctx.defaultIterationPath).toBe("Proj\\Sprint 1");
    expect(ctx.warnings).toEqual([]);
  });

  it("derives the requirement type from project work item types even without a team", async () => {
    const conn = fullConnection();
    const ctx = await getPlanningContext(conn, "Proj");
    expect(conn.getWorkApi).not.toHaveBeenCalled();
    expect(ctx.backlogs).toEqual([]);
    // Agile project -> "User Story", not the Scrum-defaulted "Product Backlog Item".
    expect(ctx.processHints.pbiTypeName).toBe("User Story");
    expect(ctx.areaPaths.length).toBeGreaterThan(0);
  });

  it("picks the right requirement type per process and keeps defaults for absent types", async () => {
    const scrum = await getPlanningContext(typesConnection(["Epic", "Feature", "Product Backlog Item", "Task"]), "Proj");
    expect(scrum.processHints.pbiTypeName).toBe("Product Backlog Item");

    const cmmi = await getPlanningContext(typesConnection(["Epic", "Feature", "Requirement", "Task"]), "Proj");
    expect(cmmi.processHints.pbiTypeName).toBe("Requirement");

    const basic = await getPlanningContext(typesConnection(["Epic", "Issue", "Task"]), "Proj");
    expect(basic.processHints.pbiTypeName).toBe("Issue");
    expect(basic.processHints.featureTypeName).toBe("Feature"); // absent -> default retained
  });

  it("isolates a failing API call as a warning instead of throwing", async () => {
    const conn = {
      getCoreApi: jest.fn().mockRejectedValue(new Error("no perms")),
      getWorkItemTrackingApi: jest.fn().mockResolvedValue({
        getClassificationNodes: jest.fn().mockResolvedValue(classificationNodes),
        getWorkItemTypes: jest.fn().mockRejectedValue(new Error("no perms")),
      }),
      getWorkApi: jest.fn(),
    } as unknown as WebApi;

    const ctx = await getPlanningContext(conn, "Proj");
    expect(ctx.teams).toEqual([]);
    expect(ctx.warnings.some((w) => w.includes("teams"))).toBe(true);
    // Work-item-types call also failed -> warning recorded, default hint retained.
    expect(ctx.warnings.some((w) => w.includes("work item types"))).toBe(true);
    expect(ctx.processHints.pbiTypeName).toBe("Product Backlog Item");
    // The classification nodes call still succeeded, so paths are present.
    expect(ctx.areaPaths.length).toBeGreaterThan(0);
  });
});
