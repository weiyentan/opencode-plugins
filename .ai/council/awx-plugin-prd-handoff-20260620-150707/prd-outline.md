# PRD Outline: AWX OpenCode Plugin

> This outline serves as a lightweight guide for the `/to-prd` process. Each section describes what content should be included and its purpose. The refined PRD already exists at `docs/prd/plugin-awx-refined.md` — this outline identifies gaps and additions surfaced by the Council review.

## 1. Problem Statement & Motivation

**Purpose:** Establish why this plugin is needed, who it serves, and what specific pain points it eliminates.

**Content should include:**
- The 6 pain points identified in the refined PRD: PowerShell 5.1 lock-in, credential XML on disk, hardcoded URLs, duplicated discovery/dot-source coupling, SSL bypass, token wastage in agent sessions
- Why each pain point matters (magnitude: security, cross-platform, maintainability, agent UX)
- The failure modes of the existing PowerShell stack and why a plugin is the right solution
- The gap this fills: OpenCode currently has no plugin-based AWX integration

## 2. Stakeholders & User Value

**Purpose:** Identify who benefits and how, to validate that the scope addresses real needs.

**Content should include:**
- **OpenCode users (primary):** faster, reliable AWX ops; cross-platform access; no PowerShell dependency
- **Platform maintainers:** testable, portable, maintainable code
- **AAP admins:** no config changes needed; PAT-only setup
- **New teams:** plug-and-play — configure `baseUrl` + PAT, done
- User stories: the 9 end-user + 1 maintainer stories from the refined PRD
- Prioritization map (P0-P2) for each user story

## 3. Scope: In-Scope vs Out-of-Scope

**Purpose:** Define the honest, bounded scope for v1 and document what is explicitly deferred.

**Content should include:**

### In-Scope (v1 — 7 tools)
1. `awx-list-templates`
2. `awx-list-projects`
3. `awx-launch-job` (with extra-var transforms)
4. `awx-job-status`
5. `awx-wait-job` (non-blocking, agent-side poll)
6. `awx-get-job-events`
7. `awx-sync-project`

### Consider for v1 (Council finding)
- `get-template` — estimate effort; if ≤ 2h, add as 8th tool for better coverage (8/22 = 36%)

### Out-of-Scope (v1)
- The remaining 14-15 PowerShell actions (documented in tool-action mapping table)
- OAuth2/JWT auth — PAT-only for MVP
- Full AWX API coverage — scoped plugin, not full API client
- Deprecating PowerShell scripts — Phase 2→3 transition is metrics-gated

### Tool-Action Mapping Table
- Complete table of all 22 existing actions with plugin tool coverage (or documented gap)
- Fallback instructions for uncovered actions (use PowerShell)

## 4. Architecture & Design

**Purpose:** Document the plugin architecture, module boundaries, and key design decisions at a level sufficient for implementation planning.

**Content should include:**

### Module Layout
- `auth.ts` — Credential lifecycle via `type: "api"` auth hook
- `client.ts` — HTTP client with resilience middleware
- `transforms.ts` — Extra-var transformations (SSH→HTTPS, branch inference, var validation)
- `contracts/job-detail.ts` — Output contract types matching `awx_job_detail.py` v1.0
- `metrics.ts` — Per-tool metrics collection
- `index.ts` — Plugin entry: tool registration, init-time validation

### Client Middleware Pipeline (Council finding — needs explicit design)
- Composition order: `AbortSignal` → `AbortSignal.timeout()` wrapping → `fetch` → 4xx/no-retry → 5xx/retry-with-backoff → circuit-breaker gate
- Edge cases: open-breaker-returns-immediately, abort-interrupts-backoff, retry-counter-reset policy

### Pagination Strategy (Council finding — needs specification)
- Max-page cap (configurable, default 5 pages)
- Per-page size override (default 50 items/page)
- Timeout budget: tool-level timeout / (pages+1) per page

### Token Lifecycle (Council finding — needs explicit decision)
- PAT TTL check needed (curl `/api/v2/tokens/`)
- Decision: token refresh for v1 or v2? Error recovery for mid-session 401?
- Single-PAT-per-session model — implications for long-running sessions

### Non-Blocking Job Pattern
- `awx-wait-job` returns immediately with job ID
- Agent-side poll loop via `awx-job-status`
- Orphaned-job risk documented (jobs continuing after session interruption)
- Max-poll-attempts bound for skills

### Metrics Durability Model (Council finding — needs specification)
- In-memory vs file-backed vs tool-exported counters
- Phase 2→3 deprecation gate depends on 14 consecutive days of zero PowerShell calls
- This requires counters to survive plugin reloads

## 5. Phase-Gate Criteria

**Purpose:** Define measurable gates for each phase transition, ensuring disciplined rollout.

**Content should include:**

### Council Addition: User-Facing Success Metrics
Define:
- "Average `awx-launch-job` latency ≤ 3s from agent call to job ID return"
- "AWX-related agent failure rate < Y% (baseline TBD)"
- Performance budget per tool (acceptable latency range)

### Phase 0 → 1A: "First tool works"
- `awx-list-templates` returns correct output against live AAP
- `contract.test.ts` passes against all fixtures
- Auth hook validates PAT and returns clear errors on failure

### Phase 1A → 1B: "Job lifecycle works"
- Launch, status, wait tools function end-to-end
- Extra-var transforms produce correct job launches
- 5 consecutive successful job lifecycle tests

### Phase 1B → 1C: "Edge tools work"
- `get-job-events` and `sync-project` function correctly
- All 7 tools have basic unit tests
- Integration tests pass against live AAP

### Phase 1C → 2: "Plugin is stable"
- 7 consecutive days without a plugin-caused agent session failure
- No unhandled errors in tool usage logs
- < 5% tool call timeout rate

### Phase 2 → 3: "Skills migrated, PowerShell deprecated"
- 14 consecutive days of zero PowerShell fallback calls for covered actions
- All skill templates updated and verified against new contract
- Tool-action mapping table gaps no longer triggered in agent sessions

## 6. Test Strategy

**Purpose:** Define how the plugin is tested at each level.

**Content should include:**
- **Unit tests:** Pure function tests for transforms, contract types
- **Contract compatibility:** `contract.test.ts` using snapshot approach (not live Python subprocess)
- **Client tests:** Faked HTTP responses to test timeout, backoff, circuit breaker behavior
- **Integration tests:** Gated behind `AWX_TOKEN` env var, run against live AAP
- **Agent-side poll flow:** Documented as behavioral contract between plugin and consuming skills (even if integration-only test)
- **How to regenerate contract snapshots** when Python output contract changes

## 7. Rollout Plan

**Purpose:** Describe the incremental rollout and fallback strategy.

**Content should include:**
- Phase 0: Scaffolding + contract foundation
- Phase 1A: Read-only tools (list-templates, list-projects)
- Phase 1B: Job tools (launch, status, wait)
- Phase 1C: Remaining tools (events, sync) + integration tests
- Phase 2: Skill updates to use plugin tools
- Phase 3: PowerShell fallback deprecation (metrics-gated)
- **Council Addition: Rollback trigger** — "If 3+ blocker bugs found in Phase 2 within the first week, revert to PowerShell fallback and schedule a gap-fill sprint"

## 8. Risks & Unknowns

**Purpose:** Document the remaining risks surfaced by Council review.

**Content should include:**
- Token TTL unknown (must check, decision on refresh needed)
- Plugin hot-reload unknown (spike in Phase 0)
- Skill renderer field consumption unknown (spike before Phase 2)
- Greenfield repo estimation variance (Phase 0 could take 2x)
- Pagination strategy needs spec (max-page cap, timeout)
- Orphaned-job risk in poll pattern (document in skill specs)
- Python CI dependency (mitigated via snapshot approach)
