# Architecture Scorecard

| Quality | Rating | Justification |
|---------|--------|---------------|
| Security | Strong | Untrusted ADO/narrative content is spotlighted; UI payloads re-validated with zod; writes gated behind explicit approval + dryRun; auth delegated to ADO tokens. Global `fetch` PAT monkey-patch is the main rough edge. |
| Scalability | Good (for intent) | Stateless stdio server, lazy per-request connections, domain gating limits loaded tools. Not designed for multi-tenant/remote scale (that is the separate Remote MCP Server). |
| Maintainability | Good | Consistent `configure*Tools` + `*_TOOLS` pattern, enforced copyright + tool-name lint, strict TS. Some large files (`work-items.ts`, `repositories.ts`) and duplicated work-item-create logic in the planning module reduce the score. |
| Testability | Good | Planning pure core (normalize/validate/export/generate) is deterministic and unit-tested; jest with ts-jest. Coverage threshold only 40%; live ADO write paths untested. |
| Operability | Fair | stderr-only structured logging (winston), version/useragent composition, tenant cache. No metrics/health/tracing; failures surfaced as tool errors only. |