// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { PLANNING_UI_HTML } from "./ui.js";

/**
 * MIME type that signals an MCP Apps UI resource. Hosts that support the MCP
 * Apps extension render this inline in an iframe; others fall back to the text
 * content returned alongside it.
 */
export const PLANNING_UI_MIME = "text/html;profile=mcp-app";

/**
 * Resolve the UI HTML. By default this is the compiled-in copy (generated from
 * ui/workspace.html at build time). For live iteration without a rebuild or
 * server restart, set ADO_PLANNING_UI_PATH to an absolute path to an HTML file;
 * it is re-read on every call so editing that file updates the UI immediately.
 */
function loadHtml(): string {
  const override = process.env.ADO_PLANNING_UI_PATH;
  if (override) {
    try {
      return readFileSync(override, "utf8");
    } catch {
      // Fall back to the compiled-in copy if the override path is unreadable.
    }
  }
  return PLANNING_UI_HTML;
}

export interface PlanningUiResource {
  uri: string;
  mimeType: string;
  html: string;
  buildHash: string;
}

/**
 * Build the UI resource descriptor. The URI embeds a content hash so it changes
 * whenever the HTML changes (hosts may cache UI resources by URI). Computed per
 * call so an ADO_PLANNING_UI_PATH override is reflected without a restart.
 */
export function getPlanningUiResource(): PlanningUiResource {
  const html = loadHtml();
  const buildHash = createHash("sha256").update(html).digest("hex").slice(0, 12);
  return { uri: `ui://ado-planning/${buildHash}/index.html`, mimeType: PLANNING_UI_MIME, html, buildHash };
}
