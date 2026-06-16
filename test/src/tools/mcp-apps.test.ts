// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebApi } from "azure-devops-node-api";
import { configureMcpAppsTools, MCP_APPS_TOOLS } from "../../../src/tools/mcp-apps";
import { PLANNING_TOOLS } from "../../../src/tools/mcp-apps/planning/index";
import { PlanningDraft } from "../../../src/tools/mcp-apps/planning/types";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string; resource?: { uri: string; mimeType: string; text: string } }[]; isError?: boolean }>;

function validDraft(): PlanningDraft {
  return {
    draftId: "d1",
    project: "Proj",
    mode: "epic-feature-pbi-task",
    createdAt: "",
    updatedAt: "",
    items: [{ localId: "epic-001", type: "Epic", title: "E", status: "approved", children: [{ localId: "feature-001", type: "Feature", title: "F", parentLocalId: "epic-001", status: "approved" }] }],
  };
}

describe("configureMcpAppsTools", () => {
  let server: McpServer & { tool: jest.Mock; registerTool: jest.Mock; registerResource: jest.Mock };
  let connectionProvider: () => Promise<WebApi>;
  let createWorkItem: jest.Mock;

  const toolHandler = (name: string): Handler => {
    const call = server.tool.mock.calls.find((c) => c[0] === name);
    if (!call) throw new Error(name + " not registered via server.tool");
    return call[3] as Handler;
  };

  const registerToolCall = (name: string): unknown[] => {
    const call = server.registerTool.mock.calls.find((c) => c[0] === name);
    if (!call) throw new Error(name + " not registered via registerTool");
    return call;
  };

  beforeEach(() => {
    server = { tool: jest.fn(), registerTool: jest.fn(), registerResource: jest.fn(), server: { elicitInput: jest.fn() } } as unknown as McpServer & {
      tool: jest.Mock;
      registerTool: jest.Mock;
      registerResource: jest.Mock;
    };
    createWorkItem = jest.fn(async () => ({ id: 1 })) as unknown as jest.Mock;
    const connection = { serverUrl: "https://dev.azure.com/org", getWorkItemTrackingApi: jest.fn().mockResolvedValue({ createWorkItem }) } as unknown as WebApi;
    connectionProvider = jest.fn().mockResolvedValue(connection) as unknown as () => Promise<WebApi>;
    configureMcpAppsTools(server, connectionProvider);
  });

  it("keeps the mcp_apps_ping smoke-test tool", async () => {
    const ping = toolHandler(MCP_APPS_TOOLS.ping);
    const result = await ping({});
    expect(result.content[0].text).toContain("pong");
  });

  it("registers all six callable planning tools plus the UI resource", () => {
    const names = server.tool.mock.calls.map((c) => c[0]);
    expect(names).toEqual(
      expect.arrayContaining([PLANNING_TOOLS.get_context, PLANNING_TOOLS.generate_draft, PLANNING_TOOLS.validate_draft, PLANNING_TOOLS.create_approved, PLANNING_TOOLS.sync, PLANNING_TOOLS.export])
    );
    expect(server.registerResource).toHaveBeenCalledTimes(1);
    expect(server.registerResource.mock.calls[0][1]).toMatch(/^ui:\/\/ado-planning\//);
  });

  it("advertises the UI resource on the open tool via _meta.ui.resourceUri", () => {
    const openCall = registerToolCall(PLANNING_TOOLS.open);
    const config = openCall[1] as { _meta?: { ui?: { resourceUri?: string } } };
    const resourceUri = config._meta?.ui?.resourceUri;
    expect(resourceUri).toMatch(/^ui:\/\/ado-planning\//);
    // The advertised URI must match the registered resource URI.
    expect(server.registerResource.mock.calls[0][1]).toBe(resourceUri);
  });

  it("open returns a renderable UI resource and a text fallback", async () => {
    const openCall = registerToolCall(PLANNING_TOOLS.open);
    const handler = openCall[2] as Handler;
    const result = await handler({ project: "Proj" });
    const resource = result.content.find((c) => c.type === "resource");
    expect(resource?.resource?.uri).toMatch(/^ui:\/\/ado-planning\//);
    expect(resource?.resource?.mimeType).toBe("text/html;profile=mcp-app");
    expect(resource?.resource?.text).toContain("ADO Planning Workspace");
    const fallback = result.content.find((c) => c.type === "text");
    expect(fallback?.text).toContain(PLANNING_TOOLS.validate_draft);
  });

  it("validate_draft handler validates a draft without writing to ADO", async () => {
    const handler = toolHandler(PLANNING_TOOLS.validate_draft);
    const result = await handler({ project: "Proj", draft: validDraft() });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.valid).toBe(true);
    expect(createWorkItem).not.toHaveBeenCalled();
  });

  it("create_approved handler honours dryRun (no ADO writes)", async () => {
    const handler = toolHandler(PLANNING_TOOLS.create_approved);
    const result = await handler({ project: "Proj", draft: validDraft(), options: { dryRun: true } });
    const json = result.content.map((c) => c.text).find((t) => t && t.indexOf("dryRun") >= 0);
    expect(json).toBeDefined();
    const parsed = JSON.parse(json as string);
    expect(parsed.dryRun).toBe(true);
    expect(createWorkItem).not.toHaveBeenCalled();
  });

  it("export handler returns formatted content", async () => {
    const handler = toolHandler(PLANNING_TOOLS.export);
    const result = await handler({ draft: validDraft(), format: "markdown" });
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.contentType).toBe("text/markdown");
    expect(parsed.content).toContain("**[Epic]**");
  });
});
