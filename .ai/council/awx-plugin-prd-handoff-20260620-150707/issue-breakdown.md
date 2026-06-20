# Issue Breakdown: AWX OpenCode Plugin

> Suggested vertical-slice issues for `/to-issues`. This breakdown incorporates Council findings from both Product Owner and Senior Engineer roles. Dependency ordering: issues should be tackled in the order listed (each builds on the previous).

## Issue 1: Phase 0 — Repository Scaffolding

- **Goal:** Create the plugin package directory structure, configure the build toolchain, establish test infrastructure, and verify plugin hot-reload behavior.
- **Estimated size:** 8-12 hours
- **Acceptance criteria:**
  - `packages/plugin-awx/` directory exists with valid `package.json` referencing `@opencode-ai/plugin` as a dependency
  - `tsconfig.json` compiles without errors on `tsc --noEmit`
  - Test runner (vitest or jest) configured and a trivial test passes
  - A minimal "hello world" tool loads and is invocable from the OpenCode server
  - **Hot-reload verifed:** change a tool description, confirm it's picked up without server restart (or document the limitation — if every change requires a restart, add a dev-mode flag)
  - `package.json` `scripts` block includes: `build`, `test`, `lint`, `typecheck`
  - README for the plugin documents: setup, build, test, and CI requirements
  - **Decision made:** npm workspaces vs pnpm? Single tsconfig vs project references? Package naming convention?
- **Dependencies:** None (first issue)
- **Risks:** Greenfield repo — no prior packages/ infrastructure in this repo. Toolchain decisions ripple through all subsequent issues. Hot-reload unknown may require architecture adjustment.

---

## Issue 2: Contract Types + Auth Hook

- **Goal:** Define the output contract TypeScript types matching `awx_job_detail.py` v1.0, write contract compatibility tests, and implement the credential lifecycle via `@opencode-ai/plugin` auth hook.
- **Estimated size:** 2-3 hours
- **Acceptance criteria:**
  - `contracts/job-detail.ts` exports a typed interface matching all fields from `awx_job_detail.py` v1.0 (`schema_version`, `job`, `related`, `host_status_counts`, `derived`, `warnings`, `errors`, optional `stdout`/`raw_events`)
  - `contract.test.ts` passes against all 3 existing fixture files — TypeScript output diffed against fixture snapshots (not live Python subprocess)
  - **Snapshot approach used:** run Python script against fixtures once, check generated snapshots into repo; document how to regenerate
  - `auth.ts` implements `type: "api"` auth hook with `authorize(inputs)` returning `{ type: "success", key }` on PAT validation
  - Failed auth returns clear, actionable error (e.g., "Invalid token. Check `baseUrl` and `AWX_TOKEN` in opencode.jsonc")
- **Dependencies:** Issue 1 (workspace structure exists)

---

## Issue 3: Client Middleware Design (Design Spike)

- **Goal:** Produce a design document for the HTTP client middleware pipeline before implementation begins. Address the composition order and edge cases of timeout, backoff, circuit breaker, and abort signal.
- **Estimated size:** 1-2 hours
- **Acceptance criteria:**
  - Design document covers the composition order: `ToolContext.abort` signal → `AbortSignal.timeout(30000)` → `fetch` → 4xx check (no retry) → 5xx check (retry with exponential backoff) → circuit breaker gate
  - **Edge cases explicitly designed:**
    - If circuit breaker is OPEN, should timeout be skipped? (yes — return immediately with cached error)
    - If `abort` fires during retry backoff wait, does the timer respect the signal? (yes — use `AbortSignal.any()`)
    - Should retry counter reset after a successful call? (yes — per-request, not per-session)
  - Circuit breaker granularity decided: tool-level (each tool has its own breaker) or client-level (shared breaker for all tools)
  - Design approved by project lead before Issue 4 begins
  - Output: `docs/client-middleware-design.md` (or inline in ADR)
- **Dependencies:** Issue 1 (workspace for docs), precedes Issue 4

---

## Issue 4: Client Module Implementation

- **Goal:** Implement the HTTP client with timeout, exponential backoff, circuit breaker, and `abort` signal integration, following the design from Issue 3.
- **Estimated size:** 2-3 hours
- **Acceptance criteria:**
  - `client.ts` exports `createClient(baseUrl: string, token: string, opts?: ClientOptions)` returning a configured HTTP helper (or individual functions)
  - 30-second request timeout enforced via `AbortSignal.timeout()` combined with `ToolContext.abort` signal
  - Exponential backoff on 5xx responses only: base delay 1s, multiplier 2x, max 3 retries, jitter
  - Zero retry on 4xx responses — error passed through immediately
  - Circuit breaker trips after 5 consecutive 5xx errors, cooldown period 60s, half-open after 30s
  - All middleware interactions are unit-tested with fake HTTP server / mocked `fetch`
  - Test: open-circuit returns immediately without making request
  - Test: abort during retry backoff cancels the pending retry
  - Test: 4xx does not trigger backoff
- **Dependencies:** Issue 3 (design), Issue 1 (test infrastructure)

---

## Issue 5: Extra-Var Transformations

- **Goal:** Implement the `transforms.ts` module with SSH→HTTPS URL conversion, git branch inference, and required variable validation.
- **Estimated size:** 1-2 hours
- **Acceptance criteria:**
  - `transforms.ts` exports `normalizeScmUrl(url: string): string` — converts SSH git URLs (`git@github.com:org/repo.git`) to HTTPS (`https://github.com/org/repo.git`)
  - `transforms.ts` exports `inferGitBranch(ref: string): string` — extracts branch name from ref string (handles `refs/heads/`, `refs/tags/`, raw branch names)
  - `transforms.ts` exports `validateRequiredVars(vars: Record<string, unknown>, required: string[]): string[]` — returns list of missing required vars
  - All transforms are pure functions (no I/O, no side effects)
  - **Edge cases handled:** malformed URLs (unchanged + warning), null/undefined inputs, empty required lists, already-HTTPS URLs
  - Full unit test coverage for all edge cases
- **Dependencies:** Issue 1 (workspace), Issue 4 (client not directly needed for pure functions)

---

## Issue 6: Read-Only Tools — List Templates + List Projects

- **Goal:** Implement `awx-list-templates` and `awx-list-projects` tools with pagination consolidation.
- **Estimated size:** 3-5 hours
- **Acceptance criteria:**
  - Both tools registered via `tool({ ... })` from `@opencode-ai/plugin/tool`
  - `awx-list-templates` returns paginated template list, consolidated into a single sorted array
  - `awx-list-projects` returns paginated project list, consolidated into a single sorted array
  - **Pagination implemented:** max-page cap (configurable, default 5 pages of 50 items = 250 max); per-page size override supported
  - **Timeout budget:** tool-level timeout divided by (pages_to_fetch + 1) per page request
  - If page cap is exceeded, return what's been fetched + warning "More items exist. Increase max-pages or use a filter."
  - Both tools return output matching the job-detail contract schema (or appropriate subset)
  - Unit tests: mock paginated responses, verify consolidation, verify timeout behavior on slow pages
- **Dependencies:** Issue 4 (client module), Issue 2 (contract types)

---

## Issue 7: Job Tools — Launch + Status

- **Goal:** Implement `awx-launch-job` with transforms integration and `awx-job-status` with contract transformation.
- **Estimated size:** 3-4 hours
- **Acceptance criteria:**
  - `awx-launch-job` accepts `template_id` (number) and optional `extra_vars` (record), returns job ID
  - Extra-vars processed through transforms pipeline: SSH→HTTPS normalization, branch inference, required var validation before launch
  - `awx-job-status` accepts `job_id` (number) and optional `include_stdout` (boolean), returns formatted output matching contract v1.0
  - Error handling: invalid `template_id` returns clear message; AAP errors propagated with status code
  - Transforms failure does NOT launch the job — fails fast with actionable error message
  - Unit tests: mock client responses, verify transforms are called in correct order, verify contract output shape
- **Dependencies:** Issue 4 (client), Issue 5 (transforms), Issue 2 (contract types)

---

## Issue 8: Job Tools — Wait + Get Events

- **Goal:** Implement `awx-wait-job` (non-blocking — returns immediately for agent-side polling) and `awx-get-job-events` (simple passthrough).
- **Estimated size:** 2-3 hours
- **Acceptance criteria:**
  - `awx-wait-job` accepts `job_id`, returns immediately with job ID (does NOT block — agent polls via `awx-job-status`)
  - `awx-get-job-events` accepts `job_id` and optional `event_filter`, returns events array
  - Both tools handle: job not found (error), job still running (empty event set for events tool)
  - `awx-wait-job` spec and skill documentation includes: **orphaned-job warning** — if agent session is interrupted, the launched job continues; skills should set `max_poll_attempts` and recommend job timeout
  - Unit tests: verify return shape, verify non-blocking behavior (returns synchronously), verify event filtering
- **Dependencies:** Issue 4 (client), Issue 2 (contract types)

---

## Issue 9: Sync Project Tool + Plugin Entry Wiring

- **Goal:** Implement `awx-sync-project`. Wire all tools into `index.ts` with metrics collection and init-time validation.
- **Estimated size:** 3-5 hours
- **Acceptance criteria:**
  - `awx-sync-project` accepts `project_id` (number), returns sync status with fields: `id`, `status`, `url`, `scm_type`, `last_updated`
  - `metrics.ts` implements: per-tool call count, error count, latency (ms), token expiry events, PowerShell fallback count
  - **Metrics durability:** decided (in-memory vs file-backed vs tool-exported). If Phase 2→3 gate requires 14 days of zero PowerShell calls, counters must survive plugin reload (file-backed or DB-backed)
  - Init-time validation on plugin load: `GET /api/v2/me/` (token validity check) + `GET /api/v2/` (AAP version check, gating minimum version)
  - All 7 tools registered and exported from `index.ts` as default export: `export default { server: async (ctx) => ({ auth, tools: [/* ... */] }) }`
  - Plugin loads without errors when `baseUrl` + token are correctly configured
  - Plugin surfaces clear error on load if AAP version < minimum required
- **Dependencies:** All prior issues (this wires everything together)

---

## Issue 10: Integration Tests

- **Goal:** Write live AAP integration tests covering the full tool lifecycle. These verify real behavior against the target AAP instance.
- **Estimated size:** 2-4 hours
- **Acceptance criteria:**
  - Integration tests gated behind `AWX_TOKEN` environment variable (not run in public CI by default)
  - Test: `awx-list-templates` against live AAP — validates response structure, fields, and pagination
  - Test: `awx-list-projects` against live AAP — validates response structure
  - Test: `awx-launch-job` → `awx-job-status` → `awx-wait-job` → `awx-get-job-events` (full lifecycle)
  - Test: `awx-sync-project` (if non-destructive — confirm with AAP admin first)
  - Test: auth failure returns clear error (run with deliberately invalid token)
  - Test: unconfigured plugin (no token) returns clear configuration error
  - **Agent-side poll flow** documented as a behavioral contract test scenario (even if manual observation)
  - README section: "Running Integration Tests" with prerequisites and environment setup
- **Dependencies:** Issue 9 (all tools wired)

---

## Implementation Order Summary

```
Issue 1  ──►  Issue 2  ──►  Issue 3  ──►  Issue 4  ──►  Issue 6
                             │                          │
                             │                          ▼
                             │                     Issue 7  ──►  Issue 8
                             │                          │
                             ▼                          │
                        Issue 5  ◄─────────────────────┘
                             │
                             ▼
                        Issue 9  ──►  Issue 10
```

- **Critical path:** 1 → 2 → 3 → 4 → 6 → 7 → 8 → 9 → 10
- **Parallelizable:** Issue 5 can start alongside Issues 3-4 (pure functions, no client dependency)
- **Issue 3 is a design spike** — if < 1h, roll into Issue 4 as an "architecture decision" section
