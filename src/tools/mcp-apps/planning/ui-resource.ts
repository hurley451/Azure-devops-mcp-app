// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "crypto";
import { PLANNING_UI_HTML } from "./ui.js";

/**
 * MIME type that signals an MCP Apps UI resource. Hosts that support the MCP
 * Apps extension render this inline in an iframe; others fall back to the text
 * content returned alongside it.
 */
export const PLANNING_UI_MIME = "text/html;profile=mcp-app";

/**
 * Short content hash so the UI resource URI changes whenever the HTML changes.
 * Hosts may cache UI resources by URI, so a stable-but-cache-busted URI avoids
 * serving stale UI after a rebuild.
 */
export const PLANNING_UI_BUILD_HASH = createHash("sha256").update(PLANNING_UI_HTML).digest("hex").slice(0, 12);

export const PLANNING_UI_URI = `ui://ado-planning/${PLANNING_UI_BUILD_HASH}/index.html`;

export interface PlanningUiResource {
  uri: string;
  mimeType: string;
  html: string;
  buildHash: string;
}

export function getPlanningUiResource(): PlanningUiResource {
  return { uri: PLANNING_UI_URI, mimeType: PLANNING_UI_MIME, html: PLANNING_UI_HTML, buildHash: PLANNING_UI_BUILD_HASH };
}
