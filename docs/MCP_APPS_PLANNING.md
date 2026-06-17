# ADO Planning Workspace (Experimental MCP App)

An experimental MCP App added to this fork of `azure-devops-mcp`. It provides an
interactive, human-in-the-loop workspace for turning a project narrative / work
breakdown structure into a controlled Azure DevOps work item hierarchy:

```
Epic
  → Feature
      → Product Backlog Item / User Story
          → Task
```

It is a **planning and review surface**, not a replacement for Azure DevOps
Boards. Azure DevOps remains the source of truth. The app helps with the parts
ADO does poorly: AI-assisted decomposition, hierarchy normalization, bulk review
before creation, acceptance-criteria drafting, and controlled, parent-first
creation with parent/child linking.

> **Status:** experimental. The UI renders in MCP Apps-compatible hosts (e.g.
> Claude Desktop). Host rendering of MCP Apps is new and not uniformly reliable
> yet — every tool also returns a usable text result so the workflow works even
> when the inline UI does not render.

## Setup

This domain is **not** enabled when domains are set to `all`. Enable it
explicitly with the least-privilege set for planning:

```bash
npm install
npm run build
node dist/index.js YOUR_ORG -d core work work-items mcp-apps
```

### Claude Desktop config

```json
{
  "mcpServers": {
    "ado-planning": {
      "command": "node",
      "args": ["/absolute/path/to/azure-devops-mcp/dist/index.js", "YOUR_ORG", "-d", "core", "work", "work-items", "mcp-apps"]
    }
  }
}
```

### Claude Code config

```bash
claude mcp add ado-planning -- node /absolute/path/to/azure-devops-mcp/dist/index.js YOUR_ORG -d core work work-items mcp-apps
```

For local development prefer the locally built server (`dist/index.js`) over the
published npm package.

### Required domains

`core work work-items mcp-apps`. Planning does **not** require `repositories`,
`pipelines`, or `wiki`. Always include `core` so project/team context can be read.

### Smoke test

`mcp_apps_ping` returns `pong — mcp-apps domain is active`, confirming the domain
is loaded.

## Tools

| Tool                                   | Purpose                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `mcp_ado_app_planning_open`            | Return the interactive Planning Workspace UI resource (advertised via `_meta.ui.resourceUri`). |
| `mcp_ado_app_planning_get_context`     | Fetch teams, backlogs, area/iteration paths, team defaults, and process type-name hints.       |
| `mcp_ado_app_planning_generate_draft`  | Return a model-mediated generation contract (see below).                                       |
| `mcp_ado_app_planning_validate_draft`  | Validate a draft hierarchy; return a normalized copy plus errors/warnings. No writes.          |
| `mcp_ado_app_planning_create_approved` | Create the **approved** items in ADO, parents first, linking children. Supports `dryRun`.      |
| `mcp_ado_app_planning_load_backlog`    | Load a project's **existing** ADO work items into a draft (WIQL/area/ids) for viewing/editing. |
| `mcp_ado_app_planning_update_items`    | Save edits to **existing** items back to ADO (only changed fields). `dryRun` = validate-only.  |
| `mcp_ado_app_planning_sync`            | Refresh created work items from ADO by id; report current state and missing ids.               |
| `mcp_ado_app_planning_export`          | Export the draft as JSON, YAML, or Markdown.                                                   |

The workspace supports the full **create → view → modify** round-trip: **Load Backlog**
pulls existing items in; the redesigned backlog manager (filters by text/type/state) and
detail editor let you edit them; **Save to ADO** writes changes back via `update_items`
(honoring the Dry Run toggle). The working draft is persisted in the browser (localStorage)
so it survives reopen. **Focus** (single-pane) and **Full screen** expand the inline frame.

Each card also has a **Run skill…** dropdown: picking a skill asks the host to run
`Run: <skill> on <work item> …` against that item (the item content is spotlight-wrapped as
untrusted data), with a clipboard fallback if the host doesn't accept a UI→chat prompt. The
skill list is configurable via the `ADO_PLANNING_SKILLS` environment variable (comma-separated;
e.g. `ADO_PLANNING_SKILLS="/security-review,/code-review,feature-dev"`); a curated default is
used when unset.

### How generation works (model-mediated, "Option A")

This MCP server does **not** call an LLM itself. `generate_draft` returns precise
instructions plus a JSON schema and the (spotlighted, untrusted) narrative.
Claude produces the `PlanningDraft` JSON, calls `validate_draft`, fixes any
errors, presents the hierarchy for approval, then calls `create_approved`. This
keeps the server an integration layer rather than an AI-orchestration platform.

## Data model

The draft is a `PlanningDraft` containing `DraftWorkItem`s. Items may be supplied
nested (`children`) or flat (`parentLocalId`); the server normalizes both to a
canonical flat list and synthesises stable `localId`s where missing. See
[`src/tools/mcp-apps/planning/types.ts`](../src/tools/mcp-apps/planning/types.ts).

Status lifecycle: `draft` → `approved` / `rejected` / `needs_rewrite`, then
`created` / `failed` after a creation run. **Only `approved` items are created.**

### Hierarchy rules

| Parent                            | Legal children                        |
| --------------------------------- | ------------------------------------- |
| Epic                              | Feature                               |
| Feature                           | Product Backlog Item, User Story, Bug |
| Product Backlog Item / User Story | Task, Bug                             |
| Bug                               | Task                                  |
| Task                              | (leaf)                                |

Planning modes (`epic-feature-pbi-task`, `feature-pbi-task`, `pbi-task`) control
which types are expected at the top level; an unexpected root type is a warning,
not an error.

## Validation

`validate_draft` enforces: stable unique `localId`; supported type; non-empty
title within ADO's 255-char limit; legal child-of-parent type; no cycles; no
orphaned parent references; and no raw control characters in titles/descriptions/
acceptance criteria. Errors block creation; warnings (e.g. missing acceptance
criteria, unexpected root type) do not.

## Creation, dry-run, and linking

- **Approval required.** Only items with `status: "approved"` are created;
  everything else is reported under `skipped` with a reason.
- **Dry run.** With `options.dryRun: true`, nothing is written to Azure DevOps —
  the response lists the items that _would_ be created and the planned counts.
  The UI defaults the "Dry Run" toggle to on and shows a confirmation prompt
  before a real create.
- **Parent-first ordering.** Items are topologically ordered so every parent is
  created before its children; children are linked via the
  `System.LinkTypes.Hierarchy-Reverse` relation. A `localId → adoId` map is
  maintained during the run.
- **Isolation.** A single item's failure is recorded under `failed` and does not
  abort the rest of the run. Fatal validation errors abort before any write.
- **Results.** Each created item returns its `adoId` and a deep link
  (`.../_workitems/edit/{id}`). Counts are summarized as epics/features/pbis/tasks
  (Product Backlog Item, User Story, and Bug count as "pbis").

## Security model

- **Human approval.** No write happens without explicit user action; the UI
  requires confirmation before a real (non-dry-run) create.
- **Least privilege.** Planning needs only `core work work-items mcp-apps`.
- **Server-side validation.** All UI-originated payloads are shape-checked with
  Zod and re-validated server-side; item type, parent id, local id, ADO id,
  area/iteration path, assigned user, state, and tags are never trusted blindly.
- **No token exposure.** Tokens, PATs, and authorization headers are never sent
  to the UI. The UI talks to the server only through MCP tool calls.
- **Untrusted content.** Narrative text and Azure DevOps-sourced content (sync,
  context) are wrapped with spotlighting so the model treats them as data, not
  instructions.

## UI resource

`planning_open` returns a self-contained HTML UI (all CSS/JS inline, so it
satisfies a default-deny CSP with no external network access). The resource uses
the MCP Apps MIME type `text/html;profile=mcp-app` and a cache-busted URI of the
form `ui://ado-planning/{buildHash}/index.html`, so a changed UI is never served
stale from a host cache. The UI communicates with the server over the MCP Apps
`postMessage` bridge (JSON-RPC `tools/call` to `window.parent`).

### Editing the UI

The HTML source of truth is [`ui/workspace.html`](../src/tools/mcp-apps/planning/ui/workspace.html).
`npm run build:ui` (run automatically by `npm run build`) regenerates the
compiled-in copy `ui.ts` from it via `JSON.stringify`, so workspace.html may use
any characters freely. Both files are in `.prettierignore`.

`planning_open` reads the HTML and recomputes the cache-bust hash **on every
call**, so the URI changes whenever the content changes.

**Live iteration without a rebuild or restart:** set `ADO_PLANNING_UI_PATH` to an
absolute path to an HTML file. When set, `open` re-reads that file each call, so
editing it updates the UI on the next `open` — no rebuild, no server respawn. In
a Claude Desktop config, point it at the source file:

```json
{
  "mcpServers": {
    "ado-planning": {
      "command": "/bin/zsh",
      "args": ["-lc", "exec node /abs/path/dist/index.js YOUR_ORG -d core work work-items mcp-apps -a azcli"],
      "env": { "ADO_PLANNING_UI_PATH": "/abs/path/src/tools/mcp-apps/planning/ui/workspace.html" }
    }
  }
}
```

## Known host limitations

- MCP Apps host rendering is new; some hosts negotiate the UI capability but
  still show a text fallback instead of the iframe. Use the returned tools
  directly if the inline UI does not render.
- Inline width in some hosts is narrow (~736px); the layout is responsive but
  best viewed wide / fullscreen.
- The iframe is sandboxed with a default-deny CSP: no external network, no host
  cookies/storage. Downloads (Export) may be blocked by some hosts — the content
  is then logged in the status panel instead.
- Standalone (non-host) preview supports **Load Sample** and **Import JSON** only;
  context/validate/create/sync require a host to relay tool calls.

## Non-goals (v1)

No full Boards clone, no drag-and-drop sprint planning, no bidirectional live
sync, no native ADO iframe embedding, no PR/pipeline execution, no persistent
backend. Drafts live in memory and can be exported/imported as JSON.
