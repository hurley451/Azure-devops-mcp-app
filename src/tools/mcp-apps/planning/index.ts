// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebApi } from "azure-devops-node-api";
import { z } from "zod";

import { elicitProject } from "../../../shared/elicitations.js";
import { spotlightContent } from "../../../shared/content-safety.js";
import { createApprovedOptionsSchema, exportFormatSchema, planningDraftSchema, planningModeSchema } from "./schema.js";
import { validateDraft } from "./validation.js";
import { createApprovedItems } from "./create-approved.js";
import { syncWorkItems } from "./sync.js";
import { exportDraft } from "./export.js";
import { getPlanningContext } from "./context.js";
import { buildGenerationContract } from "./generate.js";
import { getPlanningUiResource } from "./ui-resource.js";
import { CreateApprovedOptions, ExportFormat, PlanningDraft, PlanningMode, ProcessTemplateHint } from "./types.js";

const PLANNING_TOOLS = {
  open: "mcp_ado_app_planning_open",
  get_context: "mcp_ado_app_planning_get_context",
  generate_draft: "mcp_ado_app_planning_generate_draft",
  validate_draft: "mcp_ado_app_planning_validate_draft",
  create_approved: "mcp_ado_app_planning_create_approved",
  sync: "mcp_ado_app_planning_sync",
  export: "mcp_ado_app_planning_export",
};

const errorResult = (prefix: string, error: unknown) => ({
  content: [{ type: "text" as const, text: `${prefix}: ${error instanceof Error ? error.message : "Unknown error occurred"}` }],
  isError: true,
});

const jsonResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/** Return external (Azure DevOps-sourced) JSON spotlighted for the model, plus a raw copy the UI can parse. */
const externalJsonResult = (value: unknown, source: string) => {
  const json = JSON.stringify(value, null, 2);
  return {
    content: [
      { type: "text" as const, text: spotlightContent(json, source) },
      { type: "text" as const, text: json },
    ],
  };
};

function configurePlanningTools(server: McpServer, tokenProvider: () => Promise<string>, connectionProvider: () => Promise<WebApi>, userAgentProvider: () => string) {
  void tokenProvider;
  void userAgentProvider;

  const ui = getPlanningUiResource();

  // Register the UI as a readable resource so hosts that preload MCP App
  // resources by URI can fetch it independently of the tool result.
  server.registerResource("ado-planning-workspace", ui.uri, { mimeType: ui.mimeType, description: "ADO Planning Workspace interactive UI." }, async (uri) => ({
    contents: [{ uri: uri.toString(), mimeType: ui.mimeType, text: ui.html }],
  }));

  // -------------------------------------------------------------------------
  // planning_open — return the UI resource (advertised via _meta.ui.resourceUri).
  // -------------------------------------------------------------------------
  server.registerTool(
    PLANNING_TOOLS.open,
    {
      description:
        "Open the ADO Planning Workspace: an interactive UI for turning a narrative/WBS into a reviewable Azure DevOps Epic→Feature→PBI/User Story→Task hierarchy before creating work items.",
      inputSchema: {
        project: z.string().optional().describe("The Azure DevOps project to plan for. Reuse from prior context if known."),
        team: z.string().optional().describe("Optional team to scope backlogs, area, and iteration defaults."),
      },
      _meta: { ui: { resourceUri: ui.uri } },
    },
    async ({ project, team }) => {
      try {
        const bootstrap = { project: project ?? null, team: team ?? null };
        // Inject the selected project/team into this call's HTML so the UI prefills the fields.
        const bootstrapScript = `<script>window.__ADO_PLANNING_BOOTSTRAP__ = ${JSON.stringify(bootstrap).replace(/</g, "\\u003c")};</script>`;
        const html = ui.html.replace("<!--BOOTSTRAP-->", bootstrapScript);
        return {
          content: [
            {
              type: "resource" as const,
              resource: { uri: ui.uri, mimeType: ui.mimeType, text: html, _meta: { ui: { "prefersBorder": true, "preferred-frame-size": { width: 1100, height: 760 } } } },
            },
            {
              type: "text" as const,
              text:
                `Opened the ADO Planning Workspace (build ${ui.buildHash}). If your host does not render the inline UI, you can still drive planning via the tools: ` +
                `${PLANNING_TOOLS.get_context}, ${PLANNING_TOOLS.generate_draft}, ${PLANNING_TOOLS.validate_draft}, ${PLANNING_TOOLS.create_approved}, ${PLANNING_TOOLS.sync}, ${PLANNING_TOOLS.export}. ` +
                `Bootstrap context: ${JSON.stringify(bootstrap)}`,
            },
          ],
        };
      } catch (error) {
        return errorResult("Error opening planning workspace", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // planning_get_context — project/team/backlog context for the UI.
  // -------------------------------------------------------------------------
  server.tool(
    PLANNING_TOOLS.get_context,
    "Fetch Azure DevOps context for planning: teams, backlogs, area/iteration paths, team defaults, and process type-name hints. If a project is not specified, you will be prompted to select one.",
    {
      project: z.string().optional().describe("The name or ID of the Azure DevOps project. If not provided, a project selection prompt will be shown."),
      team: z.string().optional().describe("Optional team to scope backlogs and default area/iteration."),
    },
    async ({ project, team }) => {
      try {
        const connection = await connectionProvider();
        let resolvedProject = project;
        if (!resolvedProject) {
          const result = await elicitProject(server, connection, "Select the Azure DevOps project to plan for.");
          if ("response" in result) return result.response;
          resolvedProject = result.resolved;
        }
        const context = await getPlanningContext(connection, resolvedProject, team);
        return externalJsonResult(context, "azure devops project context");
      } catch (error) {
        return errorResult("Error fetching planning context", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // planning_generate_draft — model-mediated generation contract (Option A).
  // -------------------------------------------------------------------------
  server.tool(
    PLANNING_TOOLS.generate_draft,
    "Begin converting a narrative/WBS into a backlog draft. This server does not call an LLM: it returns precise instructions and a schema for YOU (Claude) to produce the PlanningDraft JSON, which you then pass to the validate tool. The narrative is returned as untrusted, spotlighted data.",
    {
      project: z.string().describe("The Azure DevOps project the draft targets."),
      team: z.string().optional().describe("Optional team."),
      narrative: z.string().describe("The project narrative, requirements, or work breakdown structure to decompose."),
      mode: planningModeSchema.optional().describe("Hierarchy depth mode. Defaults to 'epic-feature-pbi-task'."),
      processTemplateHint: z.enum(["Agile", "Scrum", "CMMI", "Basic", "Unknown"]).optional().describe("Target process; influences the requirement type name. Defaults to 'Unknown'."),
      maxDepth: z.coerce.number().min(1).max(4).optional().describe("Maximum hierarchy depth. Defaults to 4."),
    },
    async ({ project, team, narrative, mode, processTemplateHint, maxDepth }) => {
      try {
        const draftId = randomUUID();
        const contract = buildGenerationContract({
          draftId,
          project,
          team,
          mode: (mode as PlanningMode) ?? "epic-feature-pbi-task",
          maxDepth: maxDepth ?? 4,
          processTemplateHint: (processTemplateHint as ProcessTemplateHint) ?? "Unknown",
        });
        return {
          content: [
            { type: "text" as const, text: `${contract.instructions}\n\n--- SCHEMA ---\n${contract.schemaExample}\n\n--- NARRATIVE ---\n${spotlightContent(narrative, "narrative")}` },
            { type: "text" as const, text: JSON.stringify({ draftId, mode: contract.mode, maxDepth: contract.maxDepth, processTemplateHint: contract.processTemplateHint, warnings: [], items: [] }) },
          ],
        };
      } catch (error) {
        return errorResult("Error preparing generation contract", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // planning_validate_draft — validate before creation.
  // -------------------------------------------------------------------------
  server.tool(
    PLANNING_TOOLS.validate_draft,
    "Validate a proposed backlog draft (types, hierarchy legality, cycles, orphans, titles, safety) and return a normalized copy with errors and warnings. No Azure DevOps writes occur.",
    {
      project: z.string().describe("The Azure DevOps project the draft targets."),
      draft: planningDraftSchema.describe("The PlanningDraft to validate."),
    },
    async ({ project, draft }) => {
      try {
        const parsed = draft as PlanningDraft;
        if (project && !parsed.project) parsed.project = project;
        const result = validateDraft(parsed, parsed.mode);
        return jsonResult(result);
      } catch (error) {
        return errorResult("Error validating draft", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // planning_create_approved — create approved items in ADO (parents first).
  // -------------------------------------------------------------------------
  server.tool(
    PLANNING_TOOLS.create_approved,
    "Create the APPROVED items of a draft in Azure DevOps, parents first, linking children to parents and returning ADO ids and deep links. Supports dryRun (no writes). Only items with status 'approved' are created; others are skipped. Fatal validation errors abort before any write.",
    {
      project: z.string().describe("The Azure DevOps project to create work items in."),
      draft: planningDraftSchema.describe("The PlanningDraft whose approved items should be created."),
      options: createApprovedOptionsSchema.describe("Creation options: dryRun, default areaPath/iterationPath/assignedTo/tags."),
    },
    async ({ project, draft, options }) => {
      try {
        const parsed = draft as PlanningDraft;
        if (project && !parsed.project) parsed.project = project;
        const connection = await connectionProvider();
        const result = await createApprovedItems(connection, project, parsed, (options as CreateApprovedOptions) ?? {});
        return jsonResult(result);
      } catch (error) {
        return errorResult("Error creating approved items", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // planning_sync — refresh created items from ADO.
  // -------------------------------------------------------------------------
  server.tool(
    PLANNING_TOOLS.sync,
    "Refresh already-created work items from Azure DevOps by id. Reports current field/state values and which ids are missing (deleted or inaccessible).",
    {
      project: z.string().describe("The Azure DevOps project the work items belong to."),
      workItemIds: z.array(z.coerce.number().min(1)).describe("The Azure DevOps work item ids to refresh."),
    },
    async ({ project, workItemIds }) => {
      try {
        const connection = await connectionProvider();
        const result = await syncWorkItems(connection, project, workItemIds);
        return externalJsonResult(result, "azure devops work items");
      } catch (error) {
        return errorResult("Error syncing work items", error);
      }
    }
  );

  // -------------------------------------------------------------------------
  // planning_export — export the draft as JSON/YAML/Markdown.
  // -------------------------------------------------------------------------
  server.tool(
    PLANNING_TOOLS.export,
    "Export a planning draft as JSON, YAML, or Markdown (nested by hierarchy). No Azure DevOps access.",
    {
      draft: planningDraftSchema.describe("The PlanningDraft to export."),
      format: exportFormatSchema.describe("Output format: 'json', 'yaml', or 'markdown'."),
    },
    async ({ draft, format }) => {
      try {
        const result = exportDraft(draft as PlanningDraft, format as ExportFormat);
        return jsonResult(result);
      } catch (error) {
        return errorResult("Error exporting draft", error);
      }
    }
  );
}

export { configurePlanningTools, PLANNING_TOOLS };
