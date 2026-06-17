# PLAN — ADO Planning Workspace MCP App

**Single source of truth for remaining work.** Read [CONTEXT.md](CONTEXT.md) (esp. "Divergences &
missteps") and [SPEC.md](SPEC.md) first. Branch `claude/vibrant-aryabhata-2e7776` is merged to
`main`; current tip implements everything below marked DONE.

## Standing quality gates (must stay green after every change)

```bash
npm install --cache "$PWD/.npm-cache"   # plain `npm install` hits EACCES in sandbox; then: rm -rf .npm-cache
npm run build          # build:ui (generate ui.ts) -> tsc -> chmod ; expect exit 0
npm test               # expect: 1010 passed / 25 suites  (pretest regenerates ui.ts)
npm run eslint         # expect exit 0
npm run format-check   # expect only .claude/settings.local.json flagged (pre-existing, not ours)
npm run validate-tools # expect: All tool names and parameter names are valid
```

Two independent axes (repo-autopilot doctrine): **code quality** via `super-review`, **architectural
conformance** via `arch-guardrail-mcp`. Both now established: super-review run at P4; arch-guardrail
baseline generated at R2 (`.architectural-review/`, mirrored in [ARCHITECTURE.md](ARCHITECTURE.md)),
full `scan_drift` = **0 drift**.

> **Worktree foot-gun (seen this run):** Bash (git/npm) runs in the worktree
> `.claude/worktrees/mystifying-jemison-693770`; the **main checkout** at the repo root is a
> _separate_ tree on branch `main`. Always edit/commit via the **worktree** absolute path, not the
> bare repo root — they are not the same files (different inodes).

## Completed phases (DONE — verified at commit 200ebc9)

- [x] **P0 Scaffolding & build** — `mcp-apps` domain takes `connectionProvider`; build/test/lint green.
- [x] **P1 Planning core** — types, normalize, validation, create-approved (parents-first, dryRun,
      isolation), sync, export, context, generate, schema. Reuses ADO helpers; no REST dup.
- [x] **P2 UI** — self-contained `workspace.html`; generated `ui.ts` via `build:ui`; hashed `ui://`
      resource; `ADO_PLANNING_UI_PATH` live-reload; inline render verified in Claude Desktop.
- [x] **P3 Tests & docs** — validation/normalize/create-approved/export/sync/context/generate/
      registration tests (1010 total); `docs/MCP_APPS_PLANNING.md` + README note.
- [x] **P4 super-review pass** — fixed CRITICAL YAML-export bug, cycle over-report, AC-field-list
      duplication, drift guard (`pretest`), broadened unsafe-content check, +regression tests.

## Remaining work (OPEN — do these next)

### R1 — Verify a REAL (non-dry-run) ADO create [priority: high] — LIVE-VERIFIED (with finding)

Executed live `2026-06-16` against **anadak / mcp-test-proj** (Agile process, azcli; server
minted the token internally — no shell tokens). User authorized the real write and chose to keep
the created items for inspection.

- **Result:** dry-run plan shown → user confirmed → `create_approved` `dryRun:false`. Created:
  Epic **253**, Feature **254** (linked → 253), Task **255**. **PBI failed** — see below.
- **Acceptance #12** ✅ numeric `adoId` + `_workitems/edit/{id}` URL returned. **#13** ✅ the
  Feature→Epic `System.LinkTypes.Hierarchy-Reverse` link is **live in ADO** (confirmed via `sync`:
  254 reports `parentAdoId:253`). **#14** ✅. The create + parent-link mechanism is proven end-to-end.
- **Finding (now fixed in R6):** the project is **Agile**, but `get_context` (called without a team)
  reported `pbiTypeName:"Product Backlog Item"` (Scrum-only) → the PBI create failed with a generic
  "no id" error, and its child Task 255 was orphaned. No invalid item was written (clean failure).
- **Cleanup (done 2026-06-16):** 253/254/255 set to `System.State = Removed` (off the backlog/board;
  recoverable). No hard-delete tool is exposed by this server; the Removed state is the cleanup path.
- **Remaining to fully close #13 for a 4-level chain:** re-run a corrected draft
  (Epic→Feature→**User Story**→Task) once the R6 fix is deployed (needs R4 to repoint Desktop at the
  rebuilt `dist`), or drive it through the current server using `User Story` explicitly. Optional —
  the link mechanism is already proven.

### R2 — Architectural conformance baseline (arch-guardrail-mcp) [priority: high] — DONE ✅

repo-autopilot's second axis is now established; baseline committed.

- **Done:** `bootstrap_review` (no baseline) → `generate_baseline` (mode `bootstrap`, focus on the
  planning module) → `get_architecture` → `scan_drift` (full). Baseline lives in
  `.architectural-review/` (report + scorecard + personas scaffold), mirrored human-readably in
  [ARCHITECTURE.md](ARCHITECTURE.md). Telemetry log gitignored; baseline excluded from prettier.
- **Evidence:** baseline = 2 components / 5 layers (`ui→api→application→domain→infrastructure`) /
  6 interface contracts (incl. Option-A no-LLM, dry-run-before-write, UI hash) / 8 unique risk
  patterns (all `warning`); scorecard Security **Strong**, Scalability/Maintainability/Testability
  **Good**, Operability **Fair**. `scan_drift` full = **126 files, 0 drift / 0 blockers / 0 warnings**
  — code conforms. Risk dispositions tabled in [ARCHITECTURE.md](ARCHITECTURE.md); one (`createdAt`/
  `updatedAt` model/contract mismatch) folded into R3 below.

### R3 — Close accepted super-review notes [priority: medium] — DONE ✅ (commit 003242c)

- [x] Spotlight ADO content in `create_approved` results: `index.ts` now returns
      `externalJsonResult(result, "azure devops work item creation results")` (untrusted-delimited
      for the model + raw copy for the UI), consistent with `get_context`/`sync`.
- [x] Unify the work-item-type→CSS mapping in `workspace.html` into one `TYPE_STYLE` table read by
      `typeStyle()`; `typeClass()` and `card()`'s borderLeftColor both use it. Behavior-preserving
      (`--story` and `--pbi` are both `#137333`). `ui.ts` regenerated via `build:ui`.
- [x] Documented the static-registered `ui://` URI vs per-call live hash in `index.ts` (identical in
      prod; diverge only under the dev-only `ADO_PLANNING_UI_PATH` override).
- [x] (from R2 arch baseline) Made `PlanningDraft.createdAt`/`updatedAt` optional in `types.ts` to
      match `schema.ts` and the timestamp-free normalization.
- **Check (passed):** `build` + `test` (1010/25) + `eslint` + `format-check` + `validate-tools` green;
  the `create_approved` dryRun test now asserts the result is spotlighted (`UNTRUSTED`) and parses the
  raw copy. **Arch axis:** `plan_change` + `review_diff` approved (plan `cf48c3d4`); `scan_drift`
  (5 changed files) = 0 drift. **Code axis:** independent code-reviewer verdict = clean.

### R4 — Durability of the Desktop deployment [priority: medium] — DONE ✅ (pending user respawn)

The Desktop server previously launched `dist` from the ephemeral worktree
`vibrant-aryabhata-2e7776` (CONTEXT #13) — broke if that worktree was cleaned, and ran pre-R6 code.

- **Done (2026-06-16):** branch merged to local `main` (`a5a7828`); ran `npm install` + `npm run build`
  in the **main checkout** `/Users/mhurley/Development/Azure-devops-mcp-app` so its `dist` carries R6
  (verified `deriveProcessHints` in `dist/.../context.js`). Edited `claude_desktop_config.json`
  (backup `claude_desktop_config.json.bak-r4`) to launch `ado-planning` from the main checkout's
  `dist/index.js` (durable, not a worktree).
- **Live-reload enabled (2026-06-17):** set `env.ADO_PLANNING_UI_PATH` →
  `…/Azure-devops-mcp-app/src/tools/mcp-apps/planning/ui/workspace.html` on the `ado-planning` server
  (backup `claude_desktop_config.json.bak-uipath`). Pure-UI edits to that file (or an FF to main) now
  reflect on the next `open` with **no respawn**. Server-code changes still need rebuild + respawn.
  Cosmetic: under the override the registered `ui://` hash is the build-time one while `open` returns
  the live hash (the dev-only mismatch documented in `index.ts`).
- **Remaining manual step (user):** respawn the `ado-planning` connector (toggle off/on or quit+reopen
  Claude Desktop) so the new path + R6 take effect. Then optionally re-verify R6 live: `get_context`
  on the Agile `mcp-test-proj` (no team) should report `pbiTypeName: "User Story"`, and a corrected
  Epic→Feature→User Story→Task draft should create a full linked chain.

### R5 — Optional enhancements [priority: low]

- [ ] `externalUrl` dev-server UI mode for hot reload (vs inline rawHtml).
- [ ] Evaluate migrating to `@mcp-ui/server` / `@modelcontextprotocol/ext-apps` once host support stabilizes.
- [ ] Host-render polish: the inline frame is functional but cramped; placement is host-controlled
      (Claude Desktop renders inline, no right-pane API).

### R6 — Fix process-template hint for non-Scrum projects [priority: high] — DONE ✅ (commit 8dd6431)

Discovered by R1: `get_context` reported a Scrum requirement type for an Agile project, causing the
real PBI create to fail.

- [x] `context.ts`: `deriveProcessHints()` selects each type name from the project's **actual** work
      item types via `getWorkItemTypes(project)` (team-independent), requirement type preferred in the
      order `User Story → Product Backlog Item → Requirement → Issue`; best-effort (warning on failure,
      defaults retained). Removed the team-only backlog inference; backlogs still populated for the UI.
- [x] `create-approved.ts`: the "no created work item id" error now names the type and explains it
      likely doesn't exist in the project's process.
- **Check (passed):** `build` + `test` (**1012**/25) + `eslint` + `format-check` + `validate-tools`
  green. New tests cover per-process derivation without a team (Agile/Scrum/CMMI/Basic), best-effort
  isolation (warning + retained default), and the actionable no-id error. **Arch:** `plan_change` +
  `review_diff` approved (plan `a7451445`); `scan_drift` (7 files) = 0 drift. **Code:** independent
  reviewer = clean (its one test-hardening note applied).

## R7 — Backlog round-trip + UI redesign [priority: high] — DONE ✅

User-directed v2 (see [SPEC.md](SPEC.md) "v2 scope"): turned the create-only planning surface into a
create → **view → modify** loop with a redesigned, expandable workspace. Every step cleared the dual
gates (arch `plan_change`/`review_diff` + independent code review) and the standing gates. No new
runtime deps. Test count 1010 → **1022**; full `scan_drift` = 0.

- [x] **R7.1 Sizing + maximize** (`7b855f3`). preferred-frame-size 1100×760 → 1440×960; in-app Focus
      toggle (all / backlog-only / editor-only) + best-effort Full screen button.
- [x] **R7.2 `load_backlog` tool** (`f918b7f`). `backlog.ts` maps existing ADO items (WIQL/ids) into a
      `PlanningDraft` (parent-in-set linkage, `status:"created"`, html-stripped desc, identity/tags);
      spotlighted; capped; +5 tests.
- [x] **R7.3 `update_items` tool** (`a11c2c2`). `update.ts` write-back (dryRun=validateOnly, per-item
      isolation, lazy API); extracted shared `field-ops.ts` (used by create + update → baseline risk-3
      partially mitigated); +5 tests.
- [x] **R7.4 Backlog manager redesign** (`68c7153`). Load Backlog button → `load_backlog`; filter bar
      (search/type/status + count); cards with State/assignee/area subtitle.
- [x] **R7.5 Detail editor redesign + Save to ADO** (`68c7153`). Sectioned inspector form, editable ADO
      State, sticky save-row; "Save to ADO" → `update_items` (dry-run aware; empty = deliberate clear).
- [x] **R7.6 Persistence** (`50676c0`). localStorage persist/restore of the working draft (best-effort)
      so the loop survives reopen; Load Backlog = reload-from-ADO.
- [x] **R7.7 Run-skill-on-item** (`276b816`). Each card has a "Run skill…" dropdown that emits an
      mcp-ui `prompt` action to the host (`postMessage {type:"prompt"}` + `sendPrompt` if present) with
      a clipboard fallback, carrying `Run: <skill> …` + the item content spotlight-wrapped (128-bit
      CSPRNG nonce). Skill list configurable via `ADO_PLANNING_SKILLS` env (injected through `open`'s
      bootstrap). **Host caveat:** whether Claude Desktop's MCP Apps host honors a UI→chat `prompt`
      action is unverified; the clipboard fallback works regardless.
- **Docs/deploy:** `docs/MCP_APPS_PLANNING.md` + README updated; main `dist` rebuilt with the new tools
  - UI (respawn the Desktop connector to pick it up). **Acceptance (manual, post-respawn):** open for
    `mungepoint`, Load Backlog shows 250/251/252, edit one + Save writes back, add a child User Story
    under 250 and create it; Focus/Full screen expand the workspace.

## Working agreements (from this project's history — honor them)

- Commit each verified step locally; **do not push** (repo-autopilot doctrine; this is a fork, no remote push intended).
- Never handle/echo ADO tokens in a shell; azcli only; server mints internally.
- Real ADO writes and any Claude Desktop config edits / process kills require **explicit user authorization**.
- Edit `ui/workspace.html` (never `ui.ts`); regenerate with `npm run build:ui`. Avoid literal control bytes in source.
- Keep both quality axes green before marking anything done.
