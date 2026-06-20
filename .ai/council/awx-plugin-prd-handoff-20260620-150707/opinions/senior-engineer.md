---
role: senior-engineer
tier: lightweight
verdict: proceed
confidence: 0.78
summary: "The handoff resolves all 3 critical unknowns and the architecture is sound, but 6 engineering-specific gaps (pagination strategy, token TTL, client middleware composition, orphaned-job risk in poll pattern, greenfield-phase-0 scope, and CI Python dependency) must be captured as explicit issues during /to-issues."
---

# Council Opinion: Senior Engineer

## Summary

The handoff is thorough, the three critical unknowns are genuinely resolved by real evidence (curl spike, Python script runs, API type spelunking), and the architectural decisions in the 6 ADRs are well-reasoned. The refined PRD provides clean module boundaries, a correct output contract, and an honest scope admission. However, I identify 6 engineering concerns that are not yet surfaced in the proposed 14-issue breakdown. They are tractable — none is a blocker — but they must be captured as explicit issues or acceptance criteria during `/to-issues`. With those additions, the project is ready to proceed.

## Integrated Assessment

### Architecture Fit

The plugin architecture maps well onto the `@opencode-ai/plugin` v1.14.29 API surface. The three-pillar design (auth hook for credential lifecycle, client module for HTTP resilience, tools for AWX operations) has clean separation of concerns. Key architectural wins:

- **Non-blocking `awx-wait-job`** (ADR 0004) is the correct pattern for a plugin runtime with bounded execution slots. The agent-side poll loop mirrors how LLM agents natively handle async — it's not a workaround, it's idiomatic for this platform.
- **Init-time validation** (token check + AAP version gate) prevents the silent-failure classes that plague the PowerShell stack. Fail-fast before tool registration is the right call.
- **No hardcoded URLs** with `baseUrl` in `opencode.jsonc` makes the plugin generic. This is non-negotiable for a shared package.
- **Extra-var transforms in-plugin** (ADR 0005) rather than in skills avoids the N-implementation divergence that would occur if each skill rolled its own SSH→HTTPS logic.

### Implementation Feasibility

**Effort realism:** The 23-42 hour estimate is optimistic but achievable for a senior developer with TypeScript and AWX API familiarity. My breakdown:

| Phase | PRD estimate | My estimate | Delta reason |
|-------|-------------|-------------|-------------|
| Phase 0 | 6-10h | 8-12h | Greenfield repo — no `package.json`, no workspace, no `tsconfig`. Scaffolding from absolute zero costs more. |
| Phase 1A (read-only tools) | 3-5h | 4-6h | Pagination adds complexity that isn't accounted for. |
| Phase 1B (job tools) | 3-5h | 4-6h | Contract transform layer is nontrivial — field mapping, null handling, edge cases. |
| Phase 1C (sync + integration) | 3-5h | 4-6h | Integration tests require AAP credentials orchestration. |
| Phase 2 (skill updates) | 6-14h | 8-16h | 3 skills, each with unknown rendering surface. |
| **Total** | **~23-42h** | **~28-46h** | Tight but reasonable. |

**Risk of blowup:** The highest uncertainty is in Phase 2 (skill updates). We don't know which fields skill renderers actually consume. If `host_status_counts` or `derived` fields are used by template renderers in unexpected ways, the contract compatibility test might pass but skill rendering could break. This unknown (called out in the PRD as "Remaining unknowns") needs an explicit spike before Phase 2 begins.

**Repository state:** The repo is fully greenfield — no `packages/` directory, no `package.json`, no `tsconfig.json`. This makes Issue #1 (Phase 0 scaffolding) significantly heavier than a "copy the pattern" task. The scaffolder must decide: npm workspaces or pnpm? Single `tsconfig` or project references? Test runner (vitest vs jest)? Every decision here ripples through all subsequent issues. Issue #1 should be broken into sub-tasks or given a larger estimate.

**Dependencies:** Zero third-party npm deps is achievable (`fetch` + `AbortSignal.timeout()` covers the HTTP layer), but `zod` is already required by `@opencode-ai/plugin/tool` and `effect` comes from the OpenCode SDK peer dep — we're not starting from a truly clean slate there. The Python dependency for `contract.test.ts` is a CI infrastructure concern that must be surfaced early.

### Testing Assessment

The test strategy is correct:
- **`contract.test.ts` as zeroeth deliverable** is the right gate. It validates the most critical risk (output contract mismatch) before any tool code exists.
- **Fixture-driven** — matching the existing Python test approach — ensures the TypeScript and Python implementations stay in lockstep.
- **Integration tests gated behind `AWX_TOKEN` env var** is pragmatic. These won't run in public CI, but they shouldn't need to for a plugin that wraps known API endpoints.

One gap: there's no test for the **agent-side poll flow** (launch → poll → status → break). This is a behavioral contract between the plugin and any consuming skill. It should be documented as a test scenario even if the test itself is manual or integration-only.

## Key Concerns

### 1. Pagination Strategy Is Underspecified (Medium)
The PRD says "Consolidates paginated results into a single list" for `list-templates` and `list-projects`, but AWX DRF pagination defaults to 25 items/page with `next` links. An org with 200+ templates requires 8 sequential API calls. What's the max-page cap? What's the timeout budget for a single tool call that fans out into 8 requests? Without a cap, a large AAP instance could cause a tool call to exhaust its 30s timeout before returning. This needs to be spec'd in the tool design issue.

### 2. Token TTL Is Still Unknown (Medium)
ADR 0001 explicitly calls out that token TTL hasn't been checked (`/api/v2/tokens/`). If PATs expire in 1 hour and a session lasts 3 hours, every tool call after hour 1 returns 401. The plugin will surface this as a clear error (no silent fail), but the user has no recovery path within the session. This needs a decision: either (a) check TTL in Phase 0 and document it, or (b) accept the risk for v1 and plan token refresh for v2.

### 3. Client Middleware Composition Needs Explicit Design (Medium-High)
`client.ts` must compose: (a) 30s request timeout, (b) exponential backoff on 5xx, (c) zero retry on 4xx, (d) circuit breaker, (e) `ToolContext.abort` signal. These interact in subtle ways:
- If the circuit breaker is open, should we skip the timeout and return immediately?
- If `abort` fires mid-retry-wait, does the backoff timer respect the signal?
- Should the retry counter reset after a successful call, or is it per-session?

The current design treats these as independent concerns, but they need a composed pipeline. Issue #4 (Client module) must include a design for this composition — not just "implement timeout + retry."

### 4. Orphaned Jobs in Agent-Side Poll Pattern (Low-Medium)
The `awx-wait-job` returns immediately with a job ID, and the agent polls via `awx-job-status`. If the agent session is interrupted (conversation hits token limit, user closes tab, server restarts), the AWX job continues running but the agent never collects the result. For short-lived jobs (<5min) this is acceptable. For long-running jobs (deployments, infrastructure changes), the orphaned job could leave infrastructure in an intermediate state. The skill documentation should warn about this and suggest a max-poll-attempts bound.

### 5. Plugin Hot-Reload Is a Development-Speed Concern (Medium)
The PRD lists this as unknown. If every code change requires a full OpenCode server restart to reload the plugin, iteration time is 30-60 seconds per edit. For a 7-tool plugin, that's painful. Issue #1 should include a "verify plugin hot-reload behavior" spike: load the plugin with a minimal tool, change the tool description, reload, confirm the change is picked up. If hot-reload isn't supported, we need a dev-mode flag that simplifies restarts.

### 6. Python Dependency for Contract Tests Is a CI Concern (Low-Medium)
`contract.test.ts` runs each fixture through the Python `awx_job_detail.py` script and diffs the output against the TypeScript contract module. This requires Python + the script to be available in the test environment. CI configuration needs to ensure Python is installed and the script is accessible. Not a blocker, but it must be surfaced in the issue breakdown — otherwise the contract test infrastructure will fail on first CI run.

### 7. Metrics "Simple Counters" Is Too Vague (Low)
The PRD specifies "Per-tool call count, error count, latency, token expiry events, PowerShell fallback count" but says "Metrics are exported via simple counters." Simple counters where? `console.log`? In-memory Map? Exported via a metrics endpoint? If counters are in-memory only, they reset on every plugin load, making them useless for Phase 2→3 deprecation monitoring (which requires 14 consecutive days of zero PowerShell calls). The metrics durability model must be specified.

## Recommendations

1. **Add a Pagination issue** — Before or merged into Issues #6/#7 (list-templates, list-projects). Must specify: max-page cap, per-page size override, timeout budget for multi-page fan-out.

2. **Split Issue #1 into sub-tasks** — Phase 0 scaffolding is greenfield. Break it into: (a) repo structure (workspace config, tsconfig, package.json), (b) test infrastructure (vitest/jest, Python dependency for contract tests), (c) hot-reload spike.

3. **Add a Client Design issue** — Before Issue #4. Explicitly design the compose pipeline: `AbortSignal.timeout()` wrapping → fetch → 4xx/no-retry → 5xx/retry-with-backoff → circuit-breaker gate. The ADR spells out parameters but not the composition order.

4. **Document orphaned-job risk in skill specs** — When skills are updated (Phase 2), include a warning about jobs launched via agent-side poll that may not have their results collected.

5. **Specify metrics durability in Issue #13** — Decide: in-memory (resets on restart) vs. file-backed (persists across restarts) vs. exported via tool (caller fetches counters). This affects Phase 2→3 gate criteria.

6. **Add Python to CI requirements checklist** — Whether in Issue #1 or as a separate note in the /to-issues brief.

## Questions That Need Answers

1. What is the maximum page depth for paginated list endpoints? If AAP has 500 templates, do we fetch all of them?
2. What is the PAT TTL on the target AAP instance? (Run `curl /api/v2/tokens/` to check.)
3. Does the `@opencode-ai/plugin` runtime support hot-reload, or does every code change require a full server restart?
4. Which fields of the output contract do skill renderers actually use? (A grep of `host_status_counts`, `derived`, `schema_version` in skill repos.)
5. Should the circuit breaker operate at the tool level or the client level? If `launch-job` triggers the breaker, should `list-templates` also fail fast?
6. What is the expected latency of `awx-get-job-events` for a job with 500+ events? Should we page the events response?

## Delivery Planner Counterargument

The Delivery Planner would say: *"Your 28-46 hour estimate is untested — this team has never built an OpenCode plugin. The greenfield state of the repo adds hidden setup cost. The 7/22 coverage means 70% of existing functionality remains in brittle PowerShell, which you're not replacing — you're adding a parallel path. The agent-side poll pattern introduces a new failure mode (orphaned jobs) that doesn't exist today with the blocking PowerShell wait. And the Python dependency for contract tests is an unplanned CI infrastructure cost.*

*Worst case: Phase 0 takes 20 hours because of repo setup unknowns, the token TTL forces a mid-project auth redesign, and Phase 2 reveals skill renderer incompatibilities that require rework. That pushes the total to 60+ hours — nearly 3x the estimate. Is this project robust enough to absorb that variance?"*

This counterargument is reasonable but does **not** change my conclusion. Three things mitigate the Delivery Planner's concerns: (1) The 3 critical unknowns are resolved with *evidence*, not assumptions — the curl spike, Python script runs, and API type exploration are real. (2) The 7/22 scope is intentional and well-documented — the tool-action mapping table makes the gaps explicit, so there's no hidden scope creep from "we thought it covered everything." (3) The 6 concerns I've raised are specific, tractable, and each has a clear owner. None is a showstopper. The estimate variance is real, but the recommended minimum 14 issues break the work into independently shippable slices — if Phase 0 takes 20 hours, we know by week 1, not week 4.
