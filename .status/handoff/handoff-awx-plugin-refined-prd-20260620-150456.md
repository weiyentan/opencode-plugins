# Handoff: AWX Plugin Refined PRD — Ready for Implementation Planning

## Current State

We completed a **grill-with-docs** session that resolved **all 3 critical unknowns** from the previous Council review and confirmed **all 7 structural changes**. The refined PRD is ready at `docs/prd/plugin-awx-refined.md`.

### What Was Resolved This Session

| Unknown | Resolution |
|---------|-----------|
| **Bearer token viability** | ✅ Curl spike confirmed 200 OK on target AAP instance. MVP uses PAT. |
| **Output contract alignment** | ✅ Corrected TypeScript types match actual `awx_job_detail.py` v1.0 output. Verified against all 3 fixtures. |
| **Plugin API surface** | ✅ `@opencode-ai/plugin` v1.14.29 types found at `C:\ai\opencode\node_modules\@opencode-ai\plugin`. `tool()` + `type: "api"` auth hook + `abort` signal documented. |

### Structural Changes Confirmed

| Change | Decision |
|--------|----------|
| `awx-wait-job` pattern | Non-blocking — returns job ID immediately, agent-side poll loop via `awx-job-status` |
| Extra-var transformations | Plugin-internal `transforms.ts` shared helper (SSH→HTTPS, branch inference, var validation) |
| Connection resilience | 30s timeout, exponential backoff (5xx only), zero retry on 4xx, circuit breaker |
| Init-time validation | `GET /api/v2/me/` (token check) + `GET /api/v2/` (AAP version) on plugin load |
| Structured metrics | Per-tool call count, error count, latency, token expiry events, PowerShell fallback |
| Phase-gate criteria | Metrics-based triggers for 0→1A→1B→1C→2→3→4 transitions |
| Honest scope | 7 of 22 actions covered (30%), documented tool-action mapping table |
| `awx-get-job-events` | Added to v1 scope (~1h simple passthrough) |

### Artifacts Produced This Session

- **Refined PRD:** `docs/prd/plugin-awx-refined.md` — complete PRD incorporating all council findings and session decisions
- **Domain glossary:** `CONTEXT.md` — updated with plugin architecture terms
- **Architecture Decision Records:**
  - `docs/adr/0001-bearer-token-auth-model.md`
  - `docs/adr/0002-output-contract-alignment.md`
  - `docs/adr/0003-plugin-api-surface-discovery.md`
  - `docs/adr/0004-non-blocking-awx-wait-job.md`
  - `docs/adr/0005-extra-var-transformations-in-plugin.md`
  - `docs/adr/0006-connection-resilience-parameters.md`
- **Updated Council outline:** `.ai/council/awx-plugin-prd-20260620-135410/prd-outline.md` — marked all items as resolved
- **Previous Council artifacts:** `.ai/council/awx-plugin-prd-20260620-135410/` — full Round 1+2 opinions, decision.yaml, brief

### Key Configuration Discovered

**OpenCode Plugin API** (`@opencode-ai/plugin` v1.14.29):
- Installed at: `C:\ai\opencode\node_modules\@opencode-ai\plugin`
- Entry: `export default { server: async (ctx: PluginInput) => Hooks { auth, tool } }`
- Tools: `tool({ description, args: zodSchema, execute(args, context: ToolContext) })` from `@opencode-ai/plugin/tool`
- Auth: `type: "api"` with `authorize(inputs) => { type: "success", key }`
- Context includes `abort: AbortSignal` — native cancellation support
- Dependencies: `zod` (v4), `effect`, `@opencode-ai/sdk`

### Next Session Should

Run `/to-issues plugin-awx` to break the refined PRD into vertical-slice implementation issues. Suggested issue breakdown:

1. **Phase 0 scaffolding** — `package.json`, `tsconfig.json`, workspace registration, fixture copies
2. **Contract types** — `contracts/job-detail.ts` + `contract.test.ts` (the zeroeth deliverable — must pass before any tool code)
3. **Auth hook** — `auth.ts` with `type: "api"` PAT prompt
4. **Client module** — `client.ts` with timeout, retry, circuit breaker
5. **Transforms** — `transforms.ts` with SSH→HTTPS, branch inference, var validation
6. **Tool: list-templates** — First read-only tool (proofs auth + client + contract)
7. **Tool: list-projects** — Second read-only tool (parallel with list-templates)
8. **Tool: job-status** — First job tool (proves contract transformation)
9. **Tool: launch-job** — With transforms integration
10. **Tool: wait-job** — Non-blocking return (thinnest tool)
11. **Tool: get-job-events** — Simple passthrough
12. **Tool: sync-project** — Lowest priority
13. **Plugin entry + integration** — `index.ts` wiring, `metrics.ts`, init-time validation
14. **Integration tests** — Live AAP full lifecycle test

### Skills to Use in Next Session

| Skill | Why |
|-------|-----|
| `to-issues` | Break the PRD into implementation issues |
| `codebase-design` | Deep module design for `client.ts`, `transforms.ts`, `contracts/job-detail.ts` |
| `domain-modeling` | Update domain vocabulary as implementation clarifies |
| `implement` | Implement the issues once issued |

### Conversation Prompt for Next Agent

> This handoff is from a grill-with-docs session that resolved all critical unknowns for the `@opencode-ai/plugin-awx` PRD. The refined PRD is at `docs/prd/plugin-awx-refined.md`. The output contract, auth model, and plugin API surface have been verified against the actual AAP instance and code. Six ADRs in `docs/adr/` document key decisions. The next step is to break this PRD into vertical-slice implementation issues using `/to-issues plugin-awx`. The highest-priority deliverable is the contract compatibility test (`contract.test.ts`) — it gates all tool code.
