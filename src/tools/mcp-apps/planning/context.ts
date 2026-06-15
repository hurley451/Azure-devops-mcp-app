// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebApi } from "azure-devops-node-api";
import { TreeNodeStructureType, WorkItemClassificationNode } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces.js";

export interface TeamSummary {
  id?: string;
  name?: string;
}

export interface BacklogSummary {
  id?: string;
  name?: string;
  rank?: number;
  workItemTypes?: string[];
}

export interface ProcessHints {
  epicTypeName: string;
  featureTypeName: string;
  pbiTypeName: string;
  taskTypeName: string;
}

export interface PlanningContext {
  project: string;
  team?: string;
  teams: TeamSummary[];
  backlogs: BacklogSummary[];
  areaPaths: string[];
  iterationPaths: string[];
  defaultAreaPath?: string;
  defaultIterationPath?: string;
  processHints: ProcessHints;
  warnings: string[];
}

const DEFAULT_PROCESS_HINTS: ProcessHints = {
  epicTypeName: "Epic",
  featureTypeName: "Feature",
  pbiTypeName: "Product Backlog Item",
  taskTypeName: "Task",
};

/** Walk a classification-node tree, collecting full backslash-delimited paths. */
function collectPaths(node: WorkItemClassificationNode, prefix: string, out: string[]): void {
  const name = node.name ?? "";
  const path = prefix ? `${prefix}\\${name}` : name;
  if (path) out.push(path);
  for (const child of node.children ?? []) {
    collectPaths(child, path, out);
  }
}

/**
 * Gather the project/team context the planning UI needs: teams, backlogs, area
 * and iteration paths, team defaults, and process-specific type-name hints.
 *
 * Every Azure DevOps call is best-effort: a failure (e.g. missing permission)
 * is recorded as a warning rather than aborting, so the UI still gets partial
 * context.
 */
export async function getPlanningContext(connection: WebApi, project: string, team?: string): Promise<PlanningContext> {
  const warnings: string[] = [];
  const result: PlanningContext = {
    project,
    team,
    teams: [],
    backlogs: [],
    areaPaths: [],
    iterationPaths: [],
    processHints: { ...DEFAULT_PROCESS_HINTS },
    warnings,
  };

  try {
    const coreApi = await connection.getCoreApi();
    const teams = await coreApi.getTeams(project, undefined, undefined, undefined, false);
    result.teams = (teams ?? []).map((t) => ({ id: t.id, name: t.name }));
  } catch (error) {
    warnings.push(`Could not list teams: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  try {
    const witApi = await connection.getWorkItemTrackingApi();
    const nodes = await witApi.getClassificationNodes(project, [], 10);
    for (const node of nodes ?? []) {
      const target = node.structureType === TreeNodeStructureType.Area ? result.areaPaths : node.structureType === TreeNodeStructureType.Iteration ? result.iterationPaths : undefined;
      if (target) collectPaths(node, "", target);
    }
  } catch (error) {
    warnings.push(`Could not list area/iteration paths: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  if (team) {
    try {
      const workApi = await connection.getWorkApi();
      const teamContext = { project, team };
      const backlogs = await workApi.getBacklogs(teamContext);
      result.backlogs = (backlogs ?? []).map((b) => ({
        id: b.id,
        name: b.name,
        rank: b.rank,
        workItemTypes: (b.workItemTypes ?? []).map((w) => w.name ?? "").filter((n) => n.length > 0),
      }));

      // Infer the requirement-level type name from the backlogs (Agile uses User Story).
      const allTypes = result.backlogs.flatMap((b) => b.workItemTypes ?? []);
      if (allTypes.includes("User Story")) result.processHints.pbiTypeName = "User Story";
      else if (allTypes.includes("Product Backlog Item")) result.processHints.pbiTypeName = "Product Backlog Item";
    } catch (error) {
      warnings.push(`Could not list backlogs: ${error instanceof Error ? error.message : "unknown error"}`);
    }

    try {
      const workApi = await connection.getWorkApi();
      const teamContext = { project, team };
      const teamSettings = await workApi.getTeamSettings(teamContext);
      const teamFieldValues = await workApi.getTeamFieldValues(teamContext);
      result.defaultAreaPath = teamFieldValues?.defaultValue;
      result.defaultIterationPath = teamSettings?.defaultIteration?.path ?? teamSettings?.backlogIteration?.path;
    } catch (error) {
      warnings.push(`Could not read team settings: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  return result;
}
