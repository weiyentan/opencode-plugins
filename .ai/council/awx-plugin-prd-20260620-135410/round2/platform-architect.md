---
verdict: refine
confidence: 0.60
---

# Council Response: Platform Architect

## Reactions to Other Members

### Agreement

**On the contract mismatch being a system-boundary-breaking defect, not a cosmetic fix.** I missed this entirely in my Round 1. The Senior Engineer's code spelunking — finding that the PRD's TypeScript types (`host_summary`, `extra_vars_summary`) don't match the actual `awx_job_detail.py` output (`host_status_counts`, `derived`) — is the most significant technical finding of this Council. As Platform Architect, I need to be clear: **the output contract IS the system boundary between the plugin and every consumer skill.** A mismatch here means the integration surface is wrong by design. Every single skill that consumes job-detail output will either render empty fields or silently drop data. The schema version mismatch (1.0 vs 1.0.0) I flagged was a shallow symptom; the Senior Engineer found the structural disease.

This changes my position: I now agree with the Delivery Planner and Product Owner that a **contract compatibility test must be the zeroeth deliverable** — before any tool code, before any client module, before any auth hook. Run the same fixtures through both `awx_job_detail.py` and the TypeScript contract module, diff the outputs, and don't proceed until they match.

**On bearer token viability being an existential threat.** The Product Owner's Round 1 flagged this. The Senior Engineer's Round 1 confirmed it with a code reference: the existing `awx-windows` SKILL.md explicitly states "PAT Authentication Does NOT Work." My Round 1 auth concern was about *refresh* — I assumed the basic bearer-token flow worked and was worried about expiry. If the target AAP rejects PAT-based bearer tokens entirely, then my refresh discussion is moot. Two-tier auth (bearer + OAuth2 refresh) is irrelevant if the door is locked at layer 1.

My recommendation now aligns with the Senior Engineer's: **an auth spike using `curl -H "Authorization: Bearer <PAT>" https://aap.tanscloud-internal.com/api/v2/me/` must be the single highest-priority action**, before any architecture decisions are finalized. If it fails, the entire auth architecture must be redesigned around either (a) an OAuth2 login flow exchanging username+password for a session token, or (b) Basic Auth (if the AAP instance allows it). This fundamentally changes the credential lifecycle, the `opencode.jsonc` configuration surface, and the deployment instructions.

**On the Senior Engineer's polling redesign being architecturally superior.** My Round 1 recommended adding jitter to fixed-interval polling. That was optimizing the wrong thing. The Senior Engineer's core point — that plugin runtimes may have 30-60s timeouts incompatible with a 600-second poll loop — is a hard architectural constraint. Converting `awx-wait-job` to return immediately with a job ID and documenting a skill-level poll loop via `awx-job-status` is the right architectural response. It decouples the long-running operation from the plugin process lifetime and respects the plugin runtime's execution model.

However, I add a note of caution: see my **Disagreement with the Cost Reviewer's perspective** below.

**On the 90% coverage claim being false.** The math is 6 of 22 actions = 27%. I didn't verify this claim in Round 1 and should have. The Delivery Planner's action-mapping table recommendation (map each of the 22 script actions to plugin tool or documented gap) is essential from an architecture standpoint — without it, Phase 2 skill updates are guesswork, and we can't know which scripts remain in use.

### Disagreement

**On where extra-var transformations should live.** The Senior Engineer argues these belong in the plugin. The Product Owner accepts skill-side ownership for v1. From an architecture perspective, I land in a third position:

The SSH→HTTPS conversion, git branch inference, and required-var validation are **OpenCode-specific business logic**, not AWX API adapter logic. Putting them in the plugin violates single-responsibility — the plugin becomes part-AWX-client, part-workflow-orchestrator. But putting them in every skill creates duplication and increases the chance of divergent behavior (one skill does it, another doesn't).

**My architectural recommendation**: Create a shared utility module (`awx-transforms.ts` or similar) that lives in the plugin's workspace but is structurally separated from the HTTP client. The plugin's `awx-launch-job` tool imports and applies these transforms internally. This keeps the plugin self-contained and consistent across all callers, while maintaining a clean separation of concerns within the codebase. The transforms module can be extracted into a standalone package in v2 if other OpenCode components need it. This is a pragmatic middle ground — the plugin ships as a complete replacement for the PowerShell helper (including its business logic), but the architecture doesn't force those concerns to leak into the HTTP adapter layer.

**On adding more tools to v1 scope.** The Product Owner and Senior Engineer both recommend adding `awx-get-job-events` to v1. I disagree. From an architecture perspective, adding additional tool surfaces increases the validation surface area — each new tool needs auth, error handling, contract transformation, pagination handling, and test coverage. Given that we already have unresolved unknowns on auth (bearer token viability) and contract alignment, expanding scope before resolving those unknowns is architecturally risky. I support the Delivery Planner's framing: measure actual usage frequency first, then decide.

### New Concerns Raised

**1. Plugin API surface may not exist.** The Senior Engineer found no `@opencode-ai/plugin` TypeScript types in the repository. The auth hook contract (`type: "api-key"`) is undocumented. As Platform Architect, this is an **unvalidated external dependency** that blocks architecture validation. I cannot sign off on the system boundaries without knowing the plugin registration interface, the tool specification contract, and the auth hook API. The implementation cannot start until these types are published or at minimum documented with a concrete interface spec.

**2. AAP version drift risk validated.** My Round 1 raised this; the Product Owner's Round 2 agreed. The Product Owner's point is well-taken: "if someone upgrades AAP mid-project and a field moves, the plugin silently breaks." This confirms the need for init-time version detection as a minimum architectural guard.

**3. Plugin hot-reload capability.** Both the Delivery Planner and Product Owner raised that plugin update mechanics are unknown. If plugin updates require a server restart, Phase 1→2 becomes a session-disrupting event for every user. This is an operational concern I flagged in Round 1 and now has broader backing. It must be confirmed before committing to the 4-phase plan.

**4. Thundering herd on AAP rate limits.** The Product Owner's Round 2 supports my Round 1 concern about concurrent polling triggering AAP rate limits. If we adopt the Senior Engineer's redesigned polling (skill-level loops), the thundering herd risk shifts from the plugin to the agent's control flow — multiple agents running concurrent poll loops against the same AAP instance. Skills must document jitter and rate-limit awareness regardless of where the polling lives.

---

## System Architecture (Revised)

### What Has Changed Since My Round 1

The core architecture direction remains sound (Node.js HTTP adapter plugin replacing PowerShell stack), but three architectural assumptions have been invalidated:

| Assumption (Round 1) | Status (Round 2) | Architectural Impact |
|---|---|---|
| Bearer token auth works | **Invalidated** — existing skill says PAT fails | Auth architecture may need complete redesign |
| PRD contract types match Python output | **Invalidated** — field names differ structurally | Contract types must be rewritten from actual code |
| Long-polling in plugin is feasible | **Invalidated** — plugin runtime timeout may prevent it | Polling must be decoupled from plugin process |

### Revised System Boundaries

**Plugin boundary (unchanged):** The plugin translates tool invocations → HTTPS calls to AAP's REST API. This remains the correct boundary.

**Contract boundary (must be fixed):** The output contract is the integration surface with all skill renderers. The corrected TypeScript types must exactly match `awx_job_detail.py` output. Any field name mismatch is a breaking change at the system boundary. The correction path:

1. Read `awx_job_detail.py` lines 276-284 to extract actual fields
2. Update `contracts/job-detail.ts` to use `host_status_counts`, `derived`, etc.
3. Write a fixture-based compatibility test that validates byte-for-byte output match
4. Add `schema_version: "1.0.0"` (three-part) to match existing contract

**Auth boundary (at risk of redesign):** If bearer token auth fails, the auth boundary changes from:
- Plugin ← read credential from auth hook → OpenCode keychain

To one of:
- Plugin ← exchange user/pass for session token → AAP (then store session token)
- Plugin ← Basic Auth header → AAP (if AAP allows)

Each option changes the credential storage model, the init flow, and the security checklist.

### Revised Resilience Architecture

My Round 1 recommendation stands but with updated specifics based on Senior Engineer validation:

| Parameter | Recommended Value | Rationale |
|---|---|---|
| `fetch` timeout | 30s default, 10s for health-check | Node.js `fetch` has no default timeout |
| Retry policy | Exponential backoff (1s, 2s, 4s), capped at 3 retries | Only for 429/5xx; **zero retries** for 401/403/404 |
| Circuit breaker | Fail fast if AAP health-check fails on consecutive init attempts | Prevents cascading tool failures |
| Polling interval jitter | ±20% random jitter (if polling remains in plugin) | Non-blocking redesign makes this moot for v1 |
| Client-side timeout limits | 10s connect, 30s request, 600s total for any composite operation | Prevents hung sessions |
| Max poll duration | Not applicable — `awx-wait-job` returns immediately | Redesigned to non-blocking pattern |

### Where Extra-Var Transformations Fit (System Boundary Decision)

The SSH→HTTPS conversion, git branch inference, and required-var validation are **internal plugin implementation details**, not part of the plugin's public interface. I recommend:

```
plugin/
  client.ts           ← HTTP adapter (thin, no business logic)
  transforms.ts       ← Extra-var transformations (OpenCode-specific logic)
  tools/
    awx-launch-job.ts ← Calls transforms.ts then client.ts
    ...
```

This keeps the HTTP adapter clean while ensuring the plugin is a complete drop-in replacement for the PowerShell helper. The `transforms.ts` module is an architectural seam that could be extracted in v2.

### Deployment Architecture Notes

**Phase 2 minimum system integration test:** Before updating any skill (Phase 2), the following must be verified end-to-end:

1. **Auth:**
   - Plugin initializes against AAP without manual intervention
   - Token refresh works (if implemented) or token expiry is gracefully handled
   - Token revocation is detected on next API call (401)

2. **Contract:**
   - Fixture-based compatibility test passes (both Python and TypeScript produce identical output)
   - All three fixture types pass: success, partial, failure
   
3. **Full lifecycle:**
   - Launch → immediate job ID → poll via status → final detail output
   - This tests: auth, client, contract transformation, error handling, and the non-blocking pattern end-to-end

4. **Resilience:**
   - AAP unreachable returns structured error within 30s (not indefinite hang)
   - Invalid token returns clear 401 error (not cryptic JSON parse failure)
   - Template not found returns clear error (not empty array confusion)

These four tests constitute the **minimum viable system integration suite**. Without passing these on a live AAP instance, Phase 2 is architecture-blind refactoring.

### Updated Security Checklist

| Item | Status | Required for v1? |
|---|---|---|
| Credential creation | User generates AAP token | Yes — current model |
| Credential refresh | **Unknown** — depends on auth spike result | Yes, if bearer token works but has short TTL |
| Credential revocation | Discovered on next API call (401) | Yes — acceptable for v1 |
| Token leak blast radius | AAP API access with token's permissions | Acceptable if token is short-lived |
| Network boundary | Outbound HTTPS only | Yes — clean |
| Multi-tenancy isolation | One session per process | Yes — clean |
| Init-time version check | Verify AAP version on startup | Recommended |
| Structured metrics | Per-tool counters + latency | Rec. for operational use |

---

## Updated Position

My Round 1 verdict was **refine** at 0.75 confidence. I am staying at **refine** but dropping my confidence to **0.60**. The direction is still correct, but the Round 1 discussion surfaced two issues that change the feasibility picture from "needs polishing" to "has foundational unknowns":

**What got worse:**
- **Bear token viability is uncertain.** My architectural recommendation (two-tier auth with OAuth2 refresh) only matters if bearer tokens work at all. The existing skill says they don't. This is a 25-point confidence drop on its own.
- **Contract types are structurally wrong.** The mismatch isn't cosmetic — every job-detail returning tool would emit unusable output. This requires a contract rewrite from actual code.
- **Plugin API surface is undefined.** The architecture assumes a plugin interface that may not exist yet.

**What hasn't changed:**
- The direction (Node.js HTTP plugin replacing PowerShell stack) is still the right solution.
- The 4-phase rollout is still the right migration pattern.
- Connection resilience must be specified (timeouts, retry, circuit breaker) — the Senior Engineer confirmed native `fetch` lacks these.
- The clean boundary between plugin (HTTP adapter) and AAP (API server) is still correct.

**What I've changed my position on:**
- **Polling redesign:** I now support the Senior Engineer's non-blocking approach over my jitter recommendation. The `awx-wait-job` tool should return immediately with a job ID.
- **Contract priority:** I now agree with the Delivery Planner that a compatibility test is the zeroeth deliverable, not a Phase 1 task.
- **Extra-var transforms:** I now recommend in-plugin transforms (separate module) as a pragmatic v1 decision, keeping the plugin a complete replacement.
- **Scope:** I no longer support adding tools to v1 until usage data confirms the need.

### My Minimum Acceptable Path Forward

1. **Auth spike (highest priority):** `curl -H "Authorization: Bearer <PAT>" https://aap.tanscloud-internal.com/api/v2/me/`. If it fails, design and cost the OAuth2 login-flow alternative. Do not proceed with architecture finalization until resolved.

2. **Contract compatibility test (before any tool code):** Read `awx_job_detail.py` output fields, correct the TypeScript types, write fixture-based diff test. This is a zero-write gate.

3. **Undefined plugin API surface (dependency resolution):** Confirm that `@opencode-ai/plugin` types exist and are published. If not, define the minimum interface that the plugin needs (tool registration, auth hook, event hooks).

4. **Non-blocking polling design:** `awx-wait-job` returns `{ job_id, status_url }`. Agent calls `awx-job-status` in a loop. Document in skill updates.

5. **Resilience parameters specified:** Timeout (30s), retry (3 attempts, exponential backoff on 5xx only), circuit breaker (fail fast on consecutive AAP failures).

6. **Version check on init:** Call `/api/v2/` to validate AAP version and `/api/v2/me/` to validate token before registering any tools.

## Remaining Gaps

1. **Bearer token TTL on target AAP.** If tokens last 1 hour and there's no refresh, the session-scoped auth model is insufficient for any session longer than an hour. This must be measured during the auth spike.

2. **Plugin hot-reload capability.** If plugin updates require server restart, the 4-phase rollout schedule needs adjustment. Must be confirmed with OpenCode server team.

3. **Multi-AAP-instance strategy.** The PRD limits to one AAP instance per session (correct for v1), but enterprise deployments may need workspace-level or environment-level override. This is a v2 concern but should be documented as a known limitation.

4. **Rate limit documentation.** AAP's default rate limits and the target instance's configured limits are unknown. Without this, the polling redesign (even as a skill-level loop) can't define safe polling defaults. The senior engineer's edge case #3 (pagination at 200 items per page) is similarly dependent on AAP configuration.

---

## Addressing the S2 Disagreement Prompt

**What would the Cost Reviewer say is the expensive assumption in your architecture?**

The Cost Reviewer would say the most expensive assumption is my decision to **redesign `awx-wait-job` as a non-blocking return, pushing polling logic into every skill.** The cost delta looks cheap on paper — the plugin is simpler, no long-lived polling thread — but aggregate cost across N skills is higher. Every skill that needs to wait for job completion must now implement its own poll loop: timeout handling, jitter, retry on transient errors, cancellation detection, token expiry mid-poll. If there are 5 skills that wait for jobs, that's 5 separate implementations, 5 sets of edge cases to test, and 5 opportunities for divergent behavior. One skill might use 5-second intervals, another 15-second. One might retry on 503, another might fail immediately.

The better cost-to-maintain answer is a **self-contained polling implementation in the plugin** that either (a) supports the plugin runtime's execution model (if the runtime allows async background tasks), or (b) uses AAP's event-driven webhook API (`/api/v2/jobs/N/notifications/`) to avoid polling entirely. Both options concentrate complexity in one well-tested place.

I acknowledge this cost. My non-blocking recommendation is a v1 pragmatic choice — get something working quickly, push the cost to skills temporarily — but the architectural roadmap should explicitly call out **Phase 2.5: centralized polling** (or webhook-based completion detection) as a debt-reduction item. The PRD's 4-phase plan doesn't account for this, and it should.

This is ultimately a cost-vs-speed tradeoff. The Cost Reviewer would prefer a slower, more expensive plugin with centralized polling. I accept that the non-blocking approach costs more in aggregate skill maintenance, but I believe the speed-to-value (Linux/macOS users getting AWX access weeks earlier) justifies the tradeoff, as long as the centralized polling debt is explicitly tracked and scheduled.

---

## Verdict

**Refine** — the architecture direction is correct, but the Senior Engineer's findings on contract mismatch and bearer token viability have invalidated core assumptions about the integration surface and the auth model. A 2-spike phase (auth + contract) must resolve these before any architecture finalization, and the polling design must be restructured to respect plugin runtime constraints. Confidence reduced from 0.75 to 0.60 due to the two newly-discovered foundational unknowns.
