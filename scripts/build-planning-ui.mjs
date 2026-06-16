#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Generates src/tools/mcp-apps/planning/ui.ts from the standalone
// ui/workspace.html source. JSON.stringify produces a safe JS string literal,
// so workspace.html may contain backticks, ${...}, and any characters freely.

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const htmlPath = join(root, "src/tools/mcp-apps/planning/ui/workspace.html");
const outPath = join(root, "src/tools/mcp-apps/planning/ui.ts");

const html = readFileSync(htmlPath, "utf8");

const out = [
  "// Copyright (c) Microsoft Corporation.",
  "// Licensed under the MIT License.",
  "",
  "// GENERATED FILE — do not edit by hand.",
  "// Source: src/tools/mcp-apps/planning/ui/workspace.html",
  "// Regenerate with: npm run build:ui",
  "",
  "/** Self-contained HTML for the ADO Planning Workspace MCP App (default/build-time copy). */",
  `export const PLANNING_UI_HTML = ${JSON.stringify(html)};`,
  "",
].join("\n");

writeFileSync(outPath, out);
console.log(`build:ui — wrote ui.ts from workspace.html (${html.length} bytes)`);
