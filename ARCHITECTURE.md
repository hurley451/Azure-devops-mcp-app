# ARCHITECTURE — ADO Planning Workspace MCP App

> Human-readable mirror of the architectural baseline. The **authoritative** source is the
> arch-guardrail-mcp baseline under [`.architectural-review/`](.architectural-review/)
> (`CODEBASE_REVIEW_REPORT.md` + `architecture_scorecard.md`), parsed and enforced on every
> `plan_change` / `review_diff` / `scan_drift`. This file is the continuity summary; when the two
> disagree, the baseline wins. See [CONTEXT.md](CONTEXT.md), [SPEC.md](SPEC.md), [PLAN.md](PLAN.md).

Baseline generated `2026-06-15` (repo-autopilot R2). Layered style; 5 layers; 2 catalogued
top-level components; full `scan_drift` = **0 drift / 0 blockers / 0 warnings** (code conforms).

## Layers (allowed deps point downward only)

`ui → api → application → domain → infrastructure`

- **Entry / composition** — `src/index.ts`: CLI parse, auth factory, lazy `WebApi` connection
  factory, `McpServer`, `configureAllTools`. Only place wiring auth + transport + registration.
- **Tool-registration (api)** — `src/tools.ts` + per-domain `src/tools/*.ts`; each exports
  `configure<Domain>Tools(server, …)` + a `*_TOOLS` literal map; tools registered with zod schemas.
- **Shared cross-cutting** — `src/shared/` (`domains.ts`, `elicitations.ts`, `content-safety.ts`,
  `tool-validation.ts`) + root utils (`auth.ts`, `logger.ts`, `utils.ts`, …).
- **MCP App (application/domain)** — `src/tools/mcp-apps/planning/`, internally layered:
  pure core (`types`/`normalize`/`validation`/`export`/`generate`/`schema`) → ADO-writing tier
  (`context`/`create-approved`/`sync`) → UI-bridge tier (`index`/`ui-resource`/`ui`).
- **Infrastructure** — Azure DevOps REST via `azure-devops-node-api` typed `WebApi` clients.

## Interface contracts (the planning module's design intent)

1. **MCP stdio tool protocol** — tool/param names match `^[a-zA-Z0-9_.-]{1,64}$` (build + ESLint
   enforce); logging to stderr only (stdout = protocol); MS copyright header on every `src/**/*.ts`
   except `index.ts`.
2. **Per-domain tool registration** — `*_TOOLS` map + `configure<Domain>Tools`; **`mcp-apps` stays
   opt-in** (excluded from `all`); handlers catch and return `{ content, isError: true }`.
3. **Option A — no server-side LLM** — `generate_draft` returns only instructions + schema +
   spotlighted (untrusted) narrative; the model must `validate_draft` then get human approval before
   `create_approved`; embedded narrative instructions must not be followed.
4. **Planning draft data model & hierarchy** — UI payloads zod-checked (`schema.ts`) before any
   logic; unique non-empty localIds; legal child types (`ALLOWED_CHILDREN`); acyclic; titles ≤ 255
   and free of unsafe control bytes.
5. **Human-in-the-loop creation (dry-run-before-write)** — only `status==="approved"` created;
   fatal validation aborts before any write; `dryRun` writes nothing; parents before children;
   per-item failures isolated.
6. **UI resource contract** — `ui://` URI embeds a content hash (changes when HTML changes);
   `ui.ts` is generated, never hand-edited; source is `ui/workspace.html` via `npm run build:ui`.

## Risk-pattern dispositions (baseline `forbiddenPatterns`, all `warning` severity)

| Baseline risk                                                                               | Disposition                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drafts not persisted server-side (`draftId` unused as a key)                                | **Intentional** — SPEC non-goal ("drafts live in memory / exportable JSON"). Stateless stdio by design.                                                               |
| `createdAt`/`updatedAt` required in `types.ts` but optional in `schema.ts`, never populated | **Actionable (low)** — model/contract mismatch. Tracked in [PLAN.md](PLAN.md) R3.                                                                                     |
| Planning reimplements ADO work-item create (patch doc + parent link) vs `work-items.ts`     | **Known tradeoff** — reuses `encodeFormattedValue`; full helper extraction deferred (PLAN R5/notes). Divergence risk recorded.                                        |
| Direct `fetch` vs typed `WebApi` in `search.ts`/`wiki.ts`/`test-plans.ts`/`auth.ts`         | **Pre-existing upstream** (not in planning module scope).                                                                                                             |
| PAT auth monkey-patches `globalThis.fetch` (Bearer→Basic)                                   | **Pre-existing upstream**; not exercised on the azcli path used here.                                                                                                 |
| `mcp-apps` opt-in but filtered out of advertised domain list                                | **Intentional** — opt-in is a required contract; documented in README/docs.                                                                                           |
| Coverage threshold 40%; live ADO write path not unit-coverable                              | **Accepted** — live write verified out-of-band (PLAN R1), not by unit tests.                                                                                          |
| UI postMessage trusts host origin (`postMessage(…,"*")`, id-keyed listener)                 | **Recorded** — host-controlled inline frame (Claude Desktop); hardening is a candidate enhancement (PLAN R3/R5), not a correctness blocker in the trusted-host model. |

## Scorecard (baseline)

Security **Strong** · Scalability **Good (for intent)** · Maintainability **Good** ·
Testability **Good** · Operability **Fair**. Full justifications in
[`.architectural-review/architecture_scorecard.md`](.architectural-review/architecture_scorecard.md).
