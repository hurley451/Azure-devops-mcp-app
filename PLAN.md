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

### R1 — Verify a REAL (non-dry-run) ADO create [priority: high]

Acceptance #12/#13/#14 are unit-tested only; never executed against ADO.

- **Pre:** get user's org + a **throwaway/test** project; user runs/authorizes (azcli). Do NOT mint tokens yourself.
- Show the dry-run plan, get explicit confirmation, then `create_approved` with `dryRun:false`.
- **Check (executable):** created items return numeric `adoId` + `_workitems/edit/{id}` URL; in ADO the children carry a `System.LinkTypes.Hierarchy-Reverse` link to their parent; `sync` on those ids returns current state. Then **delete the test items** (or use a disposable project).
- Out-of-band manual step; record the result back here.

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

### R4 — Durability of the Desktop deployment [priority: medium]

The `dist` Desktop launches is inside this worktree; it breaks if the worktree is cleaned.

- **Check:** point the Desktop `ado-planning` server (and `ADO_PLANNING_UI_PATH`) at a **stable**
  checkout's `dist`/source, rebuild there, respawn, re-run `open`.

### R5 — Optional enhancements [priority: low]

- [ ] `externalUrl` dev-server UI mode for hot reload (vs inline rawHtml).
- [ ] Evaluate migrating to `@mcp-ui/server` / `@modelcontextprotocol/ext-apps` once host support stabilizes.
- [ ] Host-render polish: the inline frame is functional but cramped; placement is host-controlled
      (Claude Desktop renders inline, no right-pane API).

## Working agreements (from this project's history — honor them)

- Commit each verified step locally; **do not push** (repo-autopilot doctrine; this is a fork, no remote push intended).
- Never handle/echo ADO tokens in a shell; azcli only; server mints internally.
- Real ADO writes and any Claude Desktop config edits / process kills require **explicit user authorization**.
- Edit `ui/workspace.html` (never `ui.ts`); regenerate with `npm run build:ui`. Avoid literal control bytes in source.
- Keep both quality axes green before marking anything done.
