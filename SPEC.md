# SPEC — ADO Planning Workspace MCP App

Source: the user's original specification ("Add ADO Planning MCP App/UI to forked azure-devops-mcp").
Full feature/design docs live in [docs/MCP_APPS_PLANNING.md](docs/MCP_APPS_PLANNING.md). This SPEC
records the contract + acceptance criteria with current status. See [CONTEXT.md](CONTEXT.md) for
state and [PLAN.md](PLAN.md) for remaining work.

## Objective

Extend the fork with an experimental MCP App for AI-assisted Azure DevOps backlog planning:
ingest narrative/WBS → propose an Epic→Feature→PBI/User Story→Task hierarchy → human review
(approve/reject/edit) → create approved items in ADO with parent/child links, returning ADO ids
and deep links. ADO remains the source of truth. First implementation is a planning/review
workspace, not a Boards replacement.

## Design principles

- Human-in-the-loop: no ADO write without explicit user action; dry-run first.
- Least privilege: `core work work-items mcp-apps` only.
- The server does **not** call an LLM (design "Option A"): `generate_draft` returns a structured
  contract + spotlighted narrative for Claude to fill, then validate, then create.
- Reuse existing ADO helpers; do not duplicate REST logic.
- No new runtime dependencies; UI is self-contained inline HTML.

## Required tools (all implemented)

`mcp_ado_app_planning_open` (UI resource) · `_get_context` · `_generate_draft` · `_validate_draft`
· `_create_approved` (dryRun + real, parents-first, linked) · `_sync` · `_export` (json/yaml/md).
Plus `mcp_apps_ping` retained.

## Data model & rules

`PlanningDraft { draftId, project, team?, mode?, items: DraftWorkItem[] }`; items nested or flat.
Status: draft → approved/rejected/needs_rewrite → created/failed. **Only `approved` items are
created.** Hierarchy: Epic→Feature; Feature→PBI/User Story/Bug; PBI/User Story→Task/Bug; Bug→Task.
Modes: `epic-feature-pbi-task` | `feature-pbi-task` | `pbi-task`. Title ≤ 255 chars.

## Acceptance criteria — status

| #   | Criterion                                                | Status                                 |
| --- | -------------------------------------------------------- | -------------------------------------- |
| 1   | `npm run build` succeeds                                 | ✅                                     |
| 2   | `npm test` succeeds                                      | ✅ 1010 pass                           |
| 3   | Existing ADO tools still work                            | ✅ baseline 966 untouched              |
| 4   | `mcp_apps_ping` still returns success                    | ✅ (test)                              |
| 5   | `planning_open` returns a renderable MCP App/UI resource | ✅ (e2e + live)                        |
| 6   | UI renders in an MCP Apps host                           | ✅ **verified live in Claude Desktop** |
| 7   | User can paste narrative                                 | ✅                                     |
| 8   | User can load/validate a generated hierarchy             | ✅                                     |
| 9   | Shows Epic→Feature→PBI/Story→Task                        | ✅                                     |
| 10  | Edit + approve/reject draft items                        | ✅                                     |
| 11  | Dry-run shows planned writes without writing             | ✅ (unit + live)                       |
| 12  | Approved creation in parent-first order                  | ⚠️ unit-tested only; **not live**      |
| 13  | Created children linked to parents                       | ⚠️ unit-tested only; **not live**      |
| 14  | Created items show ADO ids + links                       | ⚠️ unit-tested only; **not live**      |
| 15  | Validation errors prevent unsafe writes                  | ✅ (unit)                              |
| 16  | Documentation explains setup + limitations               | ✅ docs + README                       |

## Non-goals (v1)

Full Boards clone, drag-drop sprint planning, bidirectional live sync, native ADO iframe embed,
PR/pipeline execution, multi-user, custom process designer, persistent backend. Drafts live in
memory / exportable JSON.
