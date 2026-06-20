---
verdict: refine
confidence: 0.72
---

# Council Response: Senior Engineer

## Reactions to Other Members

### Agreement

I want to start with what I've changed my mind on, because that's the point of Round 2.

**1. Contract mismatch — I was right, but the Delivery Planner has the better fix.**

I flagged the structural mismatch between the PRD's TypeScript types (`host_summary`/`extra_vars_summary`) and the actual Python output (`host_status_counts`/`derived`). Product Owner and Delivery Planner independently validated this finding and both agreed it's a landmine. But the Delivery Planner's recommendation — a **contract compatibility test written before any tool code** — is the superior implementation approach. My Round 1 recommendation was "fix the type definition," which is passive documentation. A compatibility test that diffs the plugin output against the actual Python script output on the same three fixtures is verification, not just correction. This is the single highest-ROI investment in the entire project.

I now recommend: Issue #4 (contract types) should produce both the TypeScript types AND a compatibility test that runs against the three existing fixtures (`awx_job_success.json`, `awx_job_partial.json`, `awx_job_failure.json`) and asserts field-exact match with Python output. Make this a CI gate.

**2. 90% coverage claim — I accept the correction unreservedly.**

Both Product Owner and Delivery Planner ran the numbers: 6 of 22 actions = 27%, not 90%+. My Round 1 opinion was skeptical but didn't do the math — they did. I was guilty of the same hand-wavey claim the PRD made. Apologies.

This changes the feasibility picture: the plugin cannot stand alone for Phase 2 skill updates. Skills will need to fall back to PowerShell for ~16 operations. The "Phase 3 deprecation" of scripts becomes impossible until those 16 operations have plugin equivalents or are shown to be unused. I adopt the Delivery Planner's recommendation for a **tool-action mapping table** that explicitly states for each of the 22 actions: (a) plugin tool replacement, (b) business logic lost, (c) acceptable for v1? This table is the single source of truth for Phase 2.

**3. Phase 2 is the highest risk — the Delivery Planner and I are aligned.**

Delivery Planner's per-skill breakdown (45-60 min per skill, not 15) matches my effort estimates. The `awx-windows` skill is the worst case: 140+ lines of PowerShell with embedded business logic (SSH-to-HTTPS URL conversion, git branch inference, `RequiredVarNames` validation). Product Owner flagged the SSH conversion gap. The only way to de-risk Phase 2 is the tool-action mapping table plus a **per-skill audit** before any plugin tool ships.

### Disagreement

**Bearer token viability — I'm pushing back on the "just do two-tier auth" recommendation.**

Platform Architect recommends a two-tier strategy (bearer token primary, OAuth2 refresh fallback). Product Owner acknowledged this was deeper than she thought. But no one is directly addressing the core issue: **we don't know if bearer token works on this AAP instance at all.** The existing skill documentation explicitly says PAT authentication returns 401. If that's true, *both* tiers of a bearer-token-first strategy fail.

The responsible engineering approach is:

1. **Spike first**: Before writing a single line of plugin code, run `curl -H "Authorization: Bearer <token>" https://aap.tanscloud-internal.com/api/v2/me/` against the target AAP. This is a 5-minute test that could save days of debugging.
2. **If bearer works**: Implement Platform Architect's two-tier approach (bearer + OAuth2 refresh).
3. **If bearer doesn't work**: Implement a login flow that exchanges credentials for an OAuth2 token on init, then refreshes it. This is a fundamentally different auth module — not a "fallback" but a different primary path.

My Round 1 opinion didn't go far enough on this. I said "spike the auth model." I now recommend the spike happens **before this council session closes**, not during implementation planning. It's that high-impact.

**Polling design — Platform Architect's jitter recommendation is insufficient.**

Platform Architect recommends adding ±20% random jitter to polling intervals to avoid thundering herd. This is a good operational practice, but it doesn't address my fundamental concern: **plugin runtime timeouts will kill `awx-wait-job` before the job completes.**

No one has answered the question: What is the OpenCode server's plugin execution timeout? If it's 60 seconds (common for serverless-style runtimes), then a 10-minute polling loop is impossible regardless of jitter. Even if the timeout is generous, holding a plugin thread for 600 seconds is wasteful — it blocks a process slot for an entire job run.

I still recommend: make `awx-wait-job` return immediately with the job ID and let the agent poll via `awx-job-status`. This eliminates the timeout problem entirely, is more token-efficient (the agent can do useful work during job execution), and avoids any thundering herd issue because there's no server-side poll loop.

Platform Architect, you make a good point about rate limits and jitter, but those apply to the *agent's* poll loop, not a server-side poll loop. Document the pattern:
```
1. awx-launch-job → { jobId: 42 }
2. loop { awx-job-status(42) → check status → if complete, break → sleep(10s + jitter) → continue }
```

This is the simplest correct approach. The PRD should specify this pattern and remove server-side polling from `awx-wait-job`.

### New Concerns Raised

**1. Platform Architect's connection resilience requirements are table stakes I hadn't fully accounted for.**

The PRD doesn't specify: fetch timeout, retry policy, circuit breaker, or version detection. Platform Architect is right that Node.js `fetch` has no default timeout (before Node 21), which means a hanging AAP connection would block a tool call indefinitely. I underestimated this because I was focused on the polling problem.

**Revised minimum for `client.ts`**: 
- Configurable timeout (default 30s per request)
- Exponential backoff on 429/5xx (1s, 2s, 4s, max 3 retries)
- Zero retry on 401/403/404
- AAP version detection on init (`GET /api/v2/`), cached, refuse to initialize if below 2.3

This pushes my `client.ts` estimate from 1.5h to 3-4h realistic. Portions of the timeout/retry logic can be extracted into shared middleware to avoid duplication across tools.

**2. Delivery Planner's phased delivery structure is better than my implicit plan.**

Delivery Planner's Phase 1A (read-only tools first) is the correct incremental delivery strategy. I was going to build all 6 tools in parallel. Starting with `awx-list-templates` and `awx-list-projects` proves auth + client + contract output in ~90 minutes without needing write access to AAP. This also provides the earliest possible validation point for the contract compatibility test. I'm adopting this.

**3. Platform Architect's health-check/init-time validation.**

Excellent recommendation. On plugin load, call `/api/v2/me/` to validate the token and `/api/v2/` for version detection. Fail immediately with a clear error message if either check fails. This prevents the worst UX failure: the plugin loads, registers 6 tools, and every tool call returns 401 because the token is invalid.

## Updated Position

My position has evolved on several points:

| Issue | Round 1 | Round 2 | What changed |
|-------|---------|---------|-------------|
| Contract mismatch | Fix the type definition | Write a compatibility test as a CI gate | Delivery Planner's better approach |
| 90% coverage claim | "Skeptical" | Accept 27%, demand tool-action mapping table | PO and DP ran the numbers |
| Bearer token viability | "Spike the auth model" | Spike before council closes, prepare two-tier or login flow | PA's auth analysis deepened my conviction |
| Polling design | Remove server-side polling | Same position, stronger: add documented agent-side poll pattern | PA's jitter is good but doesn't solve the runtime timeout |
| Connection resilience | Not addressed | Adopt PA's 4-point spec | New concern from PA's analysis |
| Phase 2 risk | "Hidden risk" | Break per-skill with mapping table | DP's concrete breakdown |
| Plugin API surface | "Unknown, can't start" | Still unknown. Need types published. | No new information |
| Extra-var transformations | "Plugin should handle" | Agreed with PA's nuance: belongs in plugin, but skills should have pre-process hook | PA's boundary analysis |

**On the extra-var transformations question**: Platform Architect asked whether they belong in the plugin or in skills. At the implementation level, the SSH→HTTPS URL conversion and branch inference are *idempotent transformations on input parameters* — they don't depend on AAP state or plugin context. This argues for putting them in the plugin's `awx-launch-job` tool, because:
- Skills shouldn't need to duplicate this logic
- The agent calling `awx-launch-job` shouldn't need to know about SSH URL conversion
- If the logic is wrong, it's fixed in one place

But — this adds surface area and testing burden to the plugin. The pragmatic v1 approach is: **document that the plugin expects pre-processed inputs, and add the transformations as a non-blocking v1.1 enhancement.** The tool-action mapping table can note this as "business logic lost" for v1.

## Remaining Gaps

1. **Plugin API surface still undefined.** `@opencode-ai/plugin` TypeScript types are not in this repo. I cannot authoritatively estimate the auth hook implementation without them. The 3-6h pessimistic estimate for `auth.ts` stands. This needs to be resolved before any implementation starts.

2. **No usage frequency data for the 22 actions.** Delivery Planner asked this and it's the right question. Without knowing which of the 16 uncovered actions are used frequently vs. rarely, we can't make informed v1 scope decisions. A 1-week audit of agent logs (if available) or a survey of heavy AWX users would answer this.

3. **OpenCode plugin runtime timeout is unknown.** This is the deciding factor for the polling design. If the timeout is 300s or more, a redesign of `awx-wait-job` as an agent-side poll loop is still cleaner but no longer critical. If it's 60s or less, server-side polling is impossible. This must be documented before Phase 1B.

4. **No skill renderer audit.** Product Owner asked which skills consume `schema_version` and which fields they actually read from the job detail output. A 30-minute grep through the skill repository would tell us which fields are critical vs. cosmetic. This should be part of Phase 0.

## Implementation Feasibility (Revised)

### Changes from Round 1 estimates

The Round 2 discourse has clarified several requirements that change the effort picture:

| Component | Round 1 (Realistic) | Round 2 (Revised) | Delta | Reason |
|-----------|-----------|-----------|-----------|--------|
| Auth hook (`auth.ts`) | 3h | 5h | +2h | Two-tier auth (bearer + OAuth2 refresh) is more complex than single-token storage |
| Client module (`client.ts`) | 1.5h | 3h | +1.5h | Timeout, retry policy, circuit breaker, version detection |
| Contract types + compatibility test | 2h | 3h | +1h | Compatibility test is additive work, not just types |
| Tool: `awx-launch-job` | 4h | 5h | +1h | Extra-var pre-processing (if included) or validation logic |
| Tool: `awx-wait-job` | 6h | 3h | -3h | Removing server-side polling → simplified to single GET + status check |
| Skill updates (Phase 2) | 8h | 12h | +4h | Per-skill breakdown, tool-action mapping, business logic gap analysis |
| **Total realistic** | **47.5h** | **47h** | **~same** | Rebalanced — polling simpler, auth/client more complex |

The total effort holds steady at ~47 hours (6 days for one developer), but the risk profile shifts: auth and contract are now the critical path, not polling.

### Revised tool-action mapping (necessary for Phase 2)

| `awx-helper.ps1` action | Plugin tool | v1 covered? | Business logic lost in v1 |
|---|---|---|---|
| launch | `awx-launch-job` | ✅ | SSH→HTTPS conversion, branch inference, RequiredVarNames validation |
| wait-job | `awx-wait-job` → agent poll pattern | ✅ | — |
| list-templates | `awx-list-templates` | ✅ | — |
| list-projects | `awx-list-projects` | ✅ | — |
| sync-project | `awx-sync-project` | ✅ | — |
| get-template | **none** | ❌ | Must use PowerShell fallback |
| get-job-events | **none** | ❌ | **Highest-priority gap** — used for debugging |
| get-job-stdout | **none** | ❌ | Medium priority |
| get-jobs | **none** | ❌ | Low priority |
| list-credentials | **none** | ❌ | Medium priority |
| list-inventories | **none** | ❌ | Low priority |
| list-ee | **none** | ❌ | Low priority |
| list-organizations | **none** | ❌ | Low priority |
| list-hosts | **none** | ❌ | Low priority |
| list-users | **none** | ❌ | Low priority |
| list-teams | **none** | ❌ | Low priority |
| list-instance-groups | **none** | ❌ | Low priority |
| add-template | **none** | ❌ | Very low priority |
| update-project | **none** | ❌ | Very low priority |
| ... (4 more) | **none** | ❌ | Very low priority |

**Key takeaway**: `get-job-events` is the one uncovered action that will actively degrade the debugging experience compared to the current stack. I recommend adding it to v1 scope — it's a simple passthrough to the AAP API with minimal implementation cost (~1h).

### Updated edge case list

Adding from Platform Architect's analysis:
1. **Token expires mid-session during `awx-get-job-events` polling** — agent sees 401 with no clear path to re-authenticate
2. **AAP version incompatibility on init** — version check should fail fast with actionable message
3. **Network timeout on long-running AAP queries** — default fetch timeout must be configured
4. **Rate limiting on burst of concurrent tool calls** — retry with backoff
5. **Plugin hot-reload failure during Phase 1→2 transition** — deployment strategy must account for this

### Critical dependency status

| Dependency | Status | Concern level |
|---|---|---|
| `@opencode-ai/plugin` TypeScript types | **Not found in repo** | 🔴 HIGH — blocks implementation |
| Node.js 18+ native `fetch` | Available | 🟢 None |
| Existing test fixtures | Available at `C:\ai\opencode\tests\fixtures\awx_job_*.json` | 🟢 None |
| Target AAP version | Unknown — assume 2.3+ per PRD | 🟡 MEDIUM — verify before Phase 1B |
| Bearer token auth viability | **Unknown** — skill docs say PAT auth fails | 🔴 HIGH — spike needed before coding |
| Plugin runtime timeout | **Unknown** | 🔴 HIGH — determines polling design |

### What the Delivery Planner says is the risk in my delivery plan

The Delivery Planner would flag two risks in my current position:

1. **The "spike auth before council closes" recommendation delays everything.** I'm asking for a verification step before we even commit the design. The Delivery Planner would say: "You're holding up 6 tools and a 6-day implementation for a 5-minute curl command. Do the spike *today*, but don't gate the council verdict on it — make it a Phase 0 pre-requisite with a 1-day max." I accept this: the spike doesn't change the verdict, it changes the auth module design. It should be done now but doesn't block the planning.

2. **My contract compatibility test recommendation adds scope to Phase 0.** Delivery Planner's own recommendation is the same test, so we agree here. The risk is scope creep in Phase 0. I recommend bounding it: the test covers exactly the three existing fixtures and asserts field-exact match. No more, no less. That's a clear done-done.

### Verdict

**Refine.** The council has converged strongly on the key issues — contract mismatch, bearer token uncertainty, scope overclaim, and Phase 2 risk. I'm raising my confidence from 0.65 to 0.72 because the discourse has clarified exactly what needs to happen before Phase 1 begins:

1. **Phase 0 (must do before coding)**:
   - Bearer token auth spike (5 min curl test)
   - Contract compatibility test (30 min)
   - Tool-action mapping table covering all 22 actions (1h)
   - OpenCode plugin API types verified published (30 min)

2. **Phase 1A (read-only tools)**:
   - `awx-list-templates` + `awx-list-projects` — proves auth, client, contract output

3. **Phase 1B (job tools + add `awx-get-job-events`)**:
   - `awx-launch-job` (with documented extra-var pre-processing limitations)
   - `awx-job-status`
   - `awx-wait-job` (agent-side poll pattern, no server-side loop)
   - Add `awx-get-job-events` as v1 passthrough

4. **Phase 1C (sync tool)**:
   - `awx-sync-project`

5. **Phase 2 (per-skill updates with mapping table)**:
   - Per-skill issues, each with explicit action-to-tool mapping

Without Phase 0, Phase 1 is built on assumptions we already know are wrong. With Phase 0, every Phase 1 tool has verified authentication, verified contract output, and a clear migration path.

The plugin is the right solution. But build it on verified ground, not PRD assumptions.
