---
version: "1.0"
---
# Codebase Review Report

## High-Level Architecture

The repository is a **layered** Node.js/TypeScript MCP (Model Context Protocol) server that exposes Azure DevOps capabilities to AI agents over stdio. It is a fork of `microsoft/azure-devops-mcp` (`package.json` name `@azure-devops/mcp`, version `2.7.0`) that adds an experimental `mcp-apps` domain hosting an interactive **ADO Planning Workspace** MCP App.

The layers actually present, with the directories that embody them:

- **Entry / composition layer** — `src/index.ts`: parses CLI args (yargs), builds the authenticator and the lazy `WebApi` connection factory, instantiates `McpServer`, and calls `configureAllTools`. This is the only place that wires authentication, transport (`StdioServerTransport`), and tool registration together.
- **Tool-registration (presentation/API) layer** — `src/tools.ts` plus the per-domain modules in `src/tools/*.ts` (`core.ts`, `work.ts`, `work-items.ts`, `repositories.ts`, `pipelines.ts`, `wiki.ts`, `search.ts`, `test-plans.ts`, `advanced-security.ts`, `mcp-apps.ts`). Each module exports a `configure<Domain>Tools(server, ...)` function and a `*_TOOLS` constant object of tool-name string literals. Tools are registered with `server.tool(...)` / `server.registerTool(...)` using zod input schemas.
- **Shared cross-cutting layer** — `src/shared/` (`domains.ts` domain gating, `elicitations.ts` project/team selection, `content-safety.ts` spotlighting of untrusted content, `tool-validation.ts` Claude-API name rules) and root utilities (`src/auth.ts`, `src/logger.ts`, `src/org-tenants.ts`, `src/useragent.ts`, `src/utils.ts`, `src/version.ts`).
- **MCP App (application/domain) layer** — `src/tools/mcp-apps/planning/`: the planning workspace. This sub-tree is itself internally layered (see Data Flow): a pure data-model/normalize/validation/export core, an ADO-writing tier (`context.ts`, `create-approved.ts`, `sync.ts`), a model-mediated generation contract (`generate.ts`), and a UI-bridge tier (`index.ts`, `ui-resource.ts`, `ui.ts`).
- **Infrastructure layer** — the Azure DevOps REST surface is reached almost entirely through the `azure-devops-node-api` `WebApi` typed clients (`getWorkItemTrackingApi`, `getCoreApi`, `getWorkApi`, `getGitApi`, `getBuildApi`, etc.); a minority of tools call the ADO REST API directly via `fetch` (e.g. `src/tools/search.ts`, parts of `src/tools/wiki.ts`, `src/tools/test-plans.ts`, `src/tools/auth.ts`).

The layering is enforced by convention and by ESLint rules (`eslint.config.mjs`: MS copyright header on `src/**/*.ts`, custom tool-name validation on `src/tools/*.ts`) rather than by module-boundary tooling. Notably, the planning module observes a deliberate **internal** separation between pure (no-I/O) logic and ADO-writing logic that the flat `src/tools/*.ts` siblings do not.

## Repository Map

```
src/
  index.ts                 # entry: CLI parse, auth, connection factory, configureAllTools
  tools.ts                 # configureAllTools — per-domain gated registration
  auth.ts                  # authenticator factory (interactive/azcli/env/envvar/pat)
  logger.ts                # winston logger -> stderr
  org-tenants.ts           # org->tenant resolution + on-disk cache
  prompts.ts               # configurePrompts (currently disabled in index.ts)
  useragent.ts             # UserAgentComposer
  utils.ts                 # enum mapping, encodeFormattedValue, stream/error helpers, apiVersion
  version.ts               # generated packageVersion
  shared/
    domains.ts             # Domain enum + DomainsManager (mcp-apps excluded from "all")
    elicitations.ts        # elicitProject / elicitTeam (server.elicitInput forms)
    content-safety.ts      # spotlightContent / createExternalContentResponse
    tool-validation.ts     # validateName / extractToolNames / extractParameterNames
  tools/
    core.ts work.ts work-items.ts repositories.ts pipelines.ts
    wiki.ts search.ts test-plans.ts advanced-security.ts
    auth.ts                # identity/connectionData REST helpers
    mcp-apps.ts            # configureMcpAppsTools: ping + configurePlanningTools
    mcp-apps/
      planning/
        index.ts           # UI-bridge: tool + resource registration (7 planning tools)
        types.ts           # data model + hierarchy rules (single source of truth)
        schema.ts          # zod schemas for UI-originated payloads
        normalize.ts       # pure flatten/buildTree/normalizeDraft
        validation.ts      # pure validateDraft (types/hierarchy/cycles/orphans/safety)
        generate.ts        # buildGenerationContract (Option A — no LLM call)
        create-approved.ts # ADO writer: createApprovedItems (parents-first, dryRun)
        sync.ts            # ADO reader: syncWorkItems (getWorkItemsBatch)
        context.ts         # ADO reader: getPlanningContext (teams/backlogs/paths/hints)
        export.ts          # pure exportDraft (json/yaml/markdown)
        ui-resource.ts     # getPlanningUiResource (hash URI, ADO_PLANNING_UI_PATH override)
        ui.ts              # GENERATED from ui/workspace.html (PLANNING_UI_HTML)
        ui/workspace.html  # hand-edited UI source
scripts/
  build-planning-ui.mjs    # generates ui.ts from workspace.html (build:ui)
  build-validate-tools.js  # validates tool/param names against Claude API rules
eslint-rules/
  tool-name-lint-rule.js   # ESLint rule wrapping shared tool-validation
test/src/tools/            # jest tests incl. planning.{context,create-approved,export,generate,sync,validation}
docs/MCP_APPS_PLANNING.md  # planning app setup / security / dry-run / host limits
```

## Major Components

### **DomainsManager**
`src/shared/domains.ts`. Parses the `--domains` CLI input and decides which tool groups load.

- Normalizes string/array/comma-separated domain input; defaults to `all`.
- Exposes `getEnabledDomains()`, `isDomainEnabled(domain)`.
- **Critically excludes `Domain.MCP_APPS` from `enableAllDomains()`** — the planning app is opt-in only (`-d ... mcp-apps`) and never loaded by `all`.
- Dependencies: `logger`.

### **ToolConfigurationModule** (`configureAllTools`)
`src/tools.ts`. The registration dispatcher.

- For each `Domain`, calls the matching `configure<Domain>Tools` only when the domain is enabled (`configureIfDomainEnabled`).
- Threads `tokenProvider`, `connectionProvider`, `userAgentProvider`, `enabledDomains` to each module.
- Dependencies: every `configure*Tools` function, `Domain`.

### **CoreController** (`configureCoreTools`)
`src/tools/core.ts`. `CORE_TOOLS` = `core_list_project_teams`, `core_list_projects`, `core_get_identity_ids`.

- Establishes the canonical per-domain pattern: `*_TOOLS` constant, `server.tool(name, description, zodShape, async handler)`, try/catch returning `{ content:[{type:"text",...}], isError:true }`.
- Uses `elicitProject` when project omitted.
- Dependencies: `searchIdentities` (`./auth`), `elicitProject` (`../shared/elicitations`), `WebApi` Core API.

### **WorkItemController** (`configureWorkItemTools`)
`src/tools/work-items.ts`. `WORKITEM_TOOLS` (e.g. `wit_create_work_item`, `wit_get_work_items_batch_by_ids`, `wit_update_work_item`, `wit_add_child_work_items`).

- The primary work-item create/read/link surface that the planning app's ADO tier mirrors but does not call directly.
- Reuses `encodeFormattedValue` (Markdown encoding), `createExternalContentResponse`, `elicitProject`/`elicitTeam`.
- Dependencies: `WebApi` WorkItemTracking API, `../utils`, `../shared/*`.

### **McpAppsModule** (`configureMcpAppsTools`)
`src/tools/mcp-apps.ts`. `MCP_APPS_TOOLS.ping = mcp_apps_ping`.

- Registers a domain liveness `ping` tool, then delegates to `configurePlanningTools`.
- Dependencies: `configurePlanningTools` (`./mcp-apps/planning/index`).

### **PlanningUiRouter** (`configurePlanningTools`)
`src/tools/mcp-apps/planning/index.ts`. The planning module's UI-bridge / tool-registration entry point. `PLANNING_TOOLS` = `mcp_ado_app_planning_{open,get_context,generate_draft,validate_draft,create_approved,sync,export}`.

- Registers the UI as a readable resource (`server.registerResource("ado-planning-workspace", ui.uri, ...)`) resolved fresh per read, and a `planning_open` tool that returns the UI resource with `_meta.ui.resourceUri` and an injected `window.__ADO_PLANNING_BOOTSTRAP__` script.
- Wraps each pure/ADO function as a tool; spotlights ADO-sourced and narrative content; never calls an LLM itself.
- Validates UI-originated `draft`/`options` through zod schemas before invoking logic.
- Dependencies: `validateDraft`, `createApprovedItems`, `syncWorkItems`, `exportDraft`, `getPlanningContext`, `buildGenerationContract`, `getPlanningUiResource`, `elicitProject`, `spotlightContent`, planning `schema`/`types`.

### **PlanningContextProvider** (`getPlanningContext`)
`src/tools/mcp-apps/planning/context.ts`. Read-only ADO context gatherer.

- Collects teams (`getCoreApi().getTeams`), area/iteration paths (`getWorkItemTrackingApi().getClassificationNodes` walked by `collectPaths`), backlogs and team defaults (`getWorkApi`), and infers process type-name hints (User Story vs Product Backlog Item).
- Every ADO call is best-effort: failures append to `warnings` rather than aborting.
- Dependencies: `WebApi` (Core/WorkItemTracking/Work APIs).

### **PlanningCreateApprovedHandler** (`createApprovedItems`)
`src/tools/mcp-apps/planning/create-approved.ts`. The **only** component in the planning module that writes to Azure DevOps.

- Validates first (`validateDraft`); fatal errors abort before any write.
- Creates only `status === "approved"` items, parents-first (`orderForCreation` topological sort with `TYPE_ORDER` tie-break), linking children via `System.LinkTypes.Hierarchy-Reverse`.
- Honors `options.dryRun` (no writes; emits `creationStatus:"dryRun"`).
- Per-item failures are isolated into `failed[]` and never abort the run; missing parent links downgrade to warnings.
- Reuses `encodeFormattedValue` from `../../../utils` for Markdown fields (no duplicated REST logic).
- Dependencies: `WebApi` WorkItemTracking API, `validateDraft`, `../../../utils`, planning `types`.

### **PlanningSyncHandler** (`syncWorkItems`)
`src/tools/mcp-apps/planning/sync.ts`. Read-only refresh of already-created items.

- Dedupes/filters ids, batch-reads via `getWorkItemsBatch` with a fixed `SYNC_FIELDS` set, maps to `SyncedWorkItem`, reports `missing` ids as warnings.
- Dependencies: `WebApi` WorkItemTracking API, planning `types`.

### **PlanningGenerationFactory** (`buildGenerationContract`)
`src/tools/mcp-apps/planning/generate.ts`. Pure builder implementing design **Option A**.

- Produces instructions + schema example for the *model* (Claude) to author the draft JSON; the server itself performs no model inference.
- Encodes hierarchy/mode/process rules from `types.ts` into the instruction text.
- Dependencies: planning `types` only (no ADO, no LLM).

### **PlanningValidationHelper** (`validateDraft`)
`src/tools/mcp-apps/planning/validation.ts`. Pure validator.

- Normalizes first (`normalizeDraft`), then checks duplicate/missing localIds, unsupported types, title presence/length (`MAX_TITLE_LENGTH`), unsafe control bytes (`hasUnsafeContent`), orphan parents, illegal child types (`ALLOWED_CHILDREN`), parent cycles (`findCycleMembers`), and emits informational warnings (missing/ignored acceptance criteria, unexpected root type for mode).
- Dependencies: `normalizeDraft`, planning `types`.

### **PlanningNormalizeUtil** (`normalizeDraft` / `flatten` / `buildTree`)
`src/tools/mcp-apps/planning/normalize.ts`. Pure, deterministic (no timestamps/randomness) canonicalization: flatten to `parentLocalId` form, synthesize stable unique localIds (`TYPE_ID_PREFIX`), default status, trim fields.

- Dependencies: planning `types`.

### **PlanningExportUtil** (`exportDraft`)
`src/tools/mcp-apps/planning/export.ts`. Pure export to JSON / YAML (dependency-free emitter) / Markdown (nested by hierarchy). No ADO access.

- Dependencies: `normalizeDraft`, `buildTree`, planning `types`.

### **PlanningUiProvider** (`getPlanningUiResource`)
`src/tools/mcp-apps/planning/ui-resource.ts`. Resolves the UI HTML and a content-hash URI (`ui://ado-planning/<hash>/index.html`).

- Default source is the build-generated `PLANNING_UI_HTML` (`ui.ts`); `ADO_PLANNING_UI_PATH` env var overrides with a file re-read on every call for live iteration.
- `PLANNING_UI_MIME = "text/html;profile=mcp-app"`.
- Dependencies: `./ui` (generated), `crypto`, `fs`.

### **ContentSafetyHelper** (`spotlightContent` / `createExternalContentResponse`)
`src/shared/content-safety.ts`. Wraps untrusted external/narrative content in nonce-delimited spotlighting markers (Spotlighting, delimiting mode) so the model treats it as data, not instructions.

- Dependencies: `crypto`.

### **ElicitationHelper** (`elicitProject` / `elicitTeam`)
`src/shared/elicitations.ts`. Project/team selection via `server.elicitInput` forms, with `ado_mcp_project` / `ado_mcp_team` env defaults.

- Dependencies: `WebApi` Core API.

### **AuthProvider** (`createAuthenticator`)
`src/auth.ts`. Returns a `() => Promise<string>` for `interactive` (MSAL `OAuthAuthenticator`), `azcli`/`env` (`DefaultAzureCredential`/`AzureCliCredential`), `envvar`, and `pat` modes.

- Dependencies: `@azure/identity`, `@azure/msal-node`, `open`, `logger`.

### **OrgTenantProvider** (`getOrgTenant`)
`src/org-tenants.ts`. Resolves an org's tenant id via an unauthenticated HEAD to `vssps.dev.azure.com` (`x-vss-resourcetenant` header), cached at `~/.ado_orgs.cache` with a 1-week TTL.

- Dependencies: `fs/promises`, `logger`.

### **ToolValidationUtil**
`src/shared/tool-validation.ts`. `validateName`/`validateToolName`/`validateParameterName` enforce the Claude API name pattern `^[a-zA-Z0-9_.-]{1,64}$`, plus `extractToolNames`/`extractParameterNames` for the build/lint checks.

- Dependencies: none (pure). Consumed by `eslint-rules/tool-name-lint-rule.js` and `scripts/build-validate-tools.js`.

## Key Interfaces and Contracts

### MCP stdio tool protocol
- Participants: `McpServer`, `StdioServerTransport`, the MCP host (Claude Desktop / Claude Code / VS Code).
- Protocol: MCP over stdio (JSON-RPC).
- Constraints:
  - Tool and parameter names **must** match `^[a-zA-Z0-9_.-]{1,64}$` (`validateName`); the build **shall** fail via `scripts/build-validate-tools.js` and ESLint otherwise.
  - Server logging **must** go to stderr (`src/logger.ts`) — stdout is reserved for the protocol.
  - Every `src/**/*.ts` file except `src/index.ts` **must** carry the MS copyright header (`eslint.config.mjs`).

### Per-domain tool registration contract
- Participants: `configureAllTools`, each `configure<Domain>Tools`, `DomainsManager`.
- Protocol: in-process function calls.
- Constraints:
  - Each domain module **shall** export a `*_TOOLS` literal map and a `configure<Domain>Tools(server, ...)` function and register tools with zod input schemas.
  - The `mcp-apps` domain **must** remain opt-in: it is **required** to be excluded from `all` (`DomainsManager.enableAllDomains` / `validateAndAddDomains`).
  - Handlers **shall** catch errors and return `{ content, isError: true }` rather than throwing across the protocol boundary.

### Planning generation contract (Option A — no server-side LLM)
- Participants: `buildGenerationContract`, the model (Claude), `validateDraft`.
- Protocol: model-mediated (instructions + schema returned as text; the model authors the draft).
- Constraints:
  - The server **must not** call an LLM; `generate_draft` only returns instructions, a schema, and the spotlighted narrative.
  - The model **shall** call `validate_draft` and obtain human approval before `create_approved`.
  - The narrative **must** be treated as untrusted data (spotlighted) and its embedded instructions **must not** be followed.

### Planning draft data model & hierarchy
- Participants: `PlanningDraft`, `DraftWorkItem`, `planningDraftSchema`, `validateDraft`, `ALLOWED_CHILDREN`, `MODE_ROOT_TYPES`.
- Protocol: in-process; JSON across the UI postMessage bridge.
- Constraints:
  - UI-originated payloads **must** be zod-shape-checked (`schema.ts`) before any logic runs; the server **shall not** trust UI-supplied type/parent/id/path/state/tags.
  - localIds **must** be unique and non-empty; child types **must** be legal under `ALLOWED_CHILDREN`; the hierarchy **must** be acyclic; titles **must** be ≤ `MAX_TITLE_LENGTH` (255) and free of unsafe control bytes.

### Human-in-the-loop creation (dry-run-before-write)
- Participants: `createApprovedItems`, `CreateApprovedOptions`, ADO WorkItemTracking API.
- Protocol: REST via `azure-devops-node-api`.
- Constraints:
  - Only items with `status === "approved"` **shall** be created; all others **must** be skipped with a reason.
  - Fatal validation errors **must** abort before any write; `dryRun` **must** perform no writes.
  - Parents **must** be created before children; per-item failures **shall** be isolated, not aborting.

### UI resource contract
- Participants: `getPlanningUiResource`, `planning_open`, MCP App host iframe.
- Protocol: MCP resource (`ui://` URI, mime `text/html;profile=mcp-app`) + postMessage `tools/call` bridge from the iframe.
- Constraints:
  - The UI URI **shall** embed a content hash so it changes when the HTML changes.
  - `ui.ts` is generated and **must not** be hand-edited; the source `ui/workspace.html` is regenerated via `npm run build:ui`.

## Gaps and Risks

- Drafts are **not persisted server-side**: `PlanningDraft` lives only in the UI/conversation and is re-supplied on every tool call. There is no `draftId`-keyed store, so concurrent edits or a lost client lose state. `draftId` is generated but never used as a server key.
- `PlanningDraft.createdAt`/`updatedAt` are declared required in `types.ts` but optional in `planningDraftSchema` and never populated by the pure layer (normalization is intentionally timestamp-free) — a model/contract mismatch that could mislead consumers.
- The planning module **duplicates Azure DevOps work-item creation logic** that already exists in `src/tools/work-items.ts` (JSON-patch construction, parent linking). It correctly reuses `encodeFormattedValue` but reimplements the patch document and hierarchy linking rather than sharing a helper, risking divergence in field handling.
- Direct `fetch` against ADO REST in `search.ts`, `wiki.ts`, `test-plans.ts`, and `auth.ts` bypasses the typed `WebApi` client and the PAT Bearer→Basic interceptor reasoning in `index.ts`, creating two inconsistent HTTP paths.
- The PAT auth path monkey-patches `globalThis.fetch` to rewrite `Authorization: Bearer` → `Basic` (`src/index.ts`); this is a global side effect that could affect any unrelated `fetch` and is fragile.
- `mcp-apps` is opt-in and partially documented; `DomainsManager` error messages filter out `mcp-apps` from the advertised domain list, so an operator may not discover it exists.
- Test coverage threshold is low (40% global, `jest.config.cjs`); the ADO-writing planning paths (`create-approved` real writes, `sync`, `context`) are partially exercised but live write behavior against ADO is not (and cannot be) covered by unit tests.
- The UI postMessage bridge (`workspace.html`) trusts the host frame origin (`postMessage(..., "*")` and an unfiltered `message` listener keyed only by id); a malicious co-resident frame could in principle inject responses.

## Security

- **Authentication** is centralized in `src/auth.ts` (`createAuthenticator`): MSAL interactive OAuth (default), Azure CLI / DefaultAzureCredential (`azcli`/`env`), `envvar` (`ADO_MCP_AUTH_TOKEN`), and `pat` (base64 `email:token` from `PERSONAL_ACCESS_TOKEN`). Tokens are acquired lazily per request through the `connectionProvider` closure built in `index.ts`.
- **Tenant resolution** (`src/org-tenants.ts`) uses an unauthenticated HEAD request and a world-readable on-disk cache (`~/.ado_orgs.cache`) containing only tenant ids (not secrets).
- **Trust boundary — untrusted content**: any data sourced from Azure DevOps or user narrative is wrapped by `spotlightContent` / `createExternalContentResponse` (`src/shared/content-safety.ts`) with nonce-delimited markers so the model does not execute embedded instructions. The planning module applies this to context (`externalJsonResult`), sync results, and the narrative in `generate_draft`.
- **Trust boundary — UI input**: the planning UI runs in a host iframe and communicates via postMessage; the server re-validates every UI-originated payload with zod (`schema.ts`) and never trusts UI-supplied work-item type, parent/local/ADO id, paths, assignee, state, or tags. `validateDraft` additionally blocks raw C0 control bytes.
- **Write safety / least surprise**: no Azure DevOps writes occur except in `createApprovedItems`, which requires explicit `approved` status, supports `dryRun`, and aborts on fatal validation errors — the human-in-the-loop, dry-run-before-write model.
- **No authorization layer of its own**: all access control is delegated to Azure DevOps via the caller's token/PAT; the server performs no role checks.
- The `planning_open` handler escapes `<` when injecting the bootstrap JSON into HTML (`.replace(/</g, "\\u003c")`), mitigating script-breakout in the inlined `window.__ADO_PLANNING_BOOTSTRAP__`.

## Data Flow

**Server startup.** `src/index.ts` parses CLI args, resolves the tenant (`getOrgTenant`), builds the authenticator (`createAuthenticator`) and a lazy `WebApi` factory (`getAzureDevOpsClient`), constructs `McpServer`, and calls `configureAllTools(server, authenticator, connectionFactory, userAgentProvider, enabledDomains)`. `configureAllTools` registers only the enabled domains; `mcp-apps` registers only when explicitly requested.

**Generic ADO read tool.** Host → MCP `tools/call` → domain handler → `connectionProvider()` (acquires token, builds `WebApi`) → typed API call (e.g. `getCoreApi().getProjects`) or direct `fetch` → result serialized to text; external results pass through spotlighting.

**Planning happy path (narrative → backlog → ADO).**
1. `planning_open` returns the UI resource (`getPlanningUiResource`) with bootstrap project/team; the host renders `workspace.html` in an iframe.
2. `planning_get_context` → `getPlanningContext` reads teams/backlogs/area+iteration paths/process hints (best-effort, read-only) → spotlighted JSON.
3. `planning_generate_draft` → `buildGenerationContract` returns instructions + schema + spotlighted narrative. **No LLM runs server-side**; Claude authors the `PlanningDraft` JSON.
4. `planning_validate_draft` → `validateDraft` (which calls `normalizeDraft`) returns a normalized draft with errors/warnings. No ADO access.
5. Human reviews/approves items in the UI (per-item `approved`/`rejected`/`needs_rewrite`).
6. `planning_create_approved` → `createApprovedItems`: re-validates, orders parents-first, and either dry-runs (no writes) or creates approved items via `getWorkItemTrackingApi().createWorkItem`, linking children to parents and returning ADO ids + deep links. Failures are isolated.
7. `planning_sync` → `syncWorkItems` batch-reads created items to refresh state; `planning_export` → `exportDraft` emits JSON/YAML/Markdown.

The draft object is the single payload threaded through steps 3–7; the server holds no draft state between calls.

**UI build pipeline.** `ui/workspace.html` (hand-edited) → `scripts/build-planning-ui.mjs` (`npm run build:ui`, runs in `prebuild`/`pretest`) → `ui.ts` exporting `PLANNING_UI_HTML` → consumed by `ui-resource.ts`. `ADO_PLANNING_UI_PATH` can override the source at runtime for live iteration without a rebuild.