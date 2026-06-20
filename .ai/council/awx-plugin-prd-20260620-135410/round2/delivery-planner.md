---
verdict: refine
confidence: 0.72
---

# Council Response: Delivery Planner

## Reactions to Other Members

### Agreement

**Contract mismatch is the critical landmine (Senior Engineer + Product Owner).** The Senior Engineer's forensic work — actually reading `awx_job_detail.py` and finding `host_status_counts`/`derived` instead of `host_summary`/`extra_vars_summary` — confirms my Round 1 fear that the PRD was written from first principles rather than from the existing codebase. The Product Owner's finding about the `schema_version` format (two-part vs three-part) is another symptom of the same root cause. All three of us converge on the same prescription: a contract compatibility test as a Phase 0 gate, diffing the Python script output against the planned TypeScript contract output using existing fixtures, before writing any tool code.

**Bearer token might not work (Senior Engineer).** The Senior Engineer went and *read the skill file* — `awx-windows/SKILL.md` explicitly documents that PAT authentication fails with 401 on this exact AAP instance. This is a showstopper, not a theoretical concern. The Platform Architect's recommendation of a two-tier auth strategy (bearer + OAuth2 refresh fallback) is the right structural answer, but the immediate question is: does *any* token-based auth work against this AAP? We need a spike before we can commit to *any* auth design.

**Phase 2 is underspecified (everyone).** Every member flagged this. The Product Owner identified the SSH URL conversion and git branch inference gaps. The Platform Architect pointed out that monitoring must precede deprecation. The Senior Engineer noted that skills don't call a uniform API. My Round 1 recommendation to split Phase 2 into per-skill issues with an action-to-tool mapping table is now reinforced by the full Council — this isn't optional complexity, it's the core delivery risk.

**Polling in a plugin runtime is dangerous (Senior Engineer).** The Senior Engineer's argument that plugin execution timeouts (30s-300s common) make a 600-second blocking `awx-wait-job` infeasible is technically unassailable. The Platform Architect's jitter requirement is technically valid but moot if we change the polling model entirely. The Product Owner's willingness to accept a simpler v1 reinforces the direction. I now agree: the smallest shippable version does *not* block on the job.

### Disagreement

**Effort estimates — my Round 1 breakdown was too optimistic.** The Senior Engineer produced a detailed 27-47.5-88 hour estimate spanning the full implementation. My 16-issue breakdown roughly mapped to ~5-7 hours of pure dev time. The gap comes from:
1. I didn't price testing thoroughly enough (I had it as one 30-minute issue; SE rightly allocates 9-23h).
2. I assumed auth would be straightforward (15 min); SE correctly flags the undocumented plugin API surface and potential auth redesign (1-6h).
3. I underestimated `awx-wait-job` complexity (30 min vs SE's 3-12h).
4. My 45-minute Phase 2 estimate is laughably optimistic next to SE's 4-16h.

**Reconciliation**: My issue structure is a good *topological map* of the work, but the estimates need 2-3× inflation across the board. I'm adopting SE's range as the authoritative total-effort forecast and reslicing accordingly below.

**On extra-var transformations — I now lean plugin, not skills.** In Round 1 I was neutral. After reading the Senior Engineer's analysis that the SSH→HTTPS conversion and branch inference are business logic executed at launch time — not skill-level documentation — I agree these belong in the plugin's `awx-launch-job` tool. The alternative (duplicating this logic in every skill) guarantees inconsistency. The Platform Architect's question of "plugin or skills" is resolved by the delivery reality: putting it in the plugin means one implementation, one test, one maintenance point. Required-var validation can stay in skills because it's configurable per deployment.

**On metrics surface — the Product Owner wants product-level success metrics; the Platform Architect wants operational metrics.** These are complementary, not conflicting, but they serve different gates. The Platform Architect's per-tool call/error counters and latency histograms are what we need for Phase 1→2 gating (can we prove the plugin is being used?). The Product Owner's business metrics (failure rate reduction, token waste reduction) are what we need for Phase 2→3→4 gating (can we prove the migration is worth completing?). I'll synthesize both in my updated plan.

## New Concerns Raised

**Undefined plugin API surface (Senior Engineer).** I had not considered that `@opencode-ai/plugin` TypeScript types and the auth hook contract don't exist in the repository yet. This is a *blocking dependency* — you can't implement `auth.ts` without knowing the interface. This adds a Phase 0 discovery spike that I didn't account for. Depending on what's found, this could range from "read the published npm package" (1h) to "the interface doesn't exist yet and must be defined" (4-8h) to "the interface exists but doesn't support our use case" (needs upstream change, uncertain timeline).

**Bearer token PLUS SSH-to-HTTPS gap means `awx-launch-job` is the riskiest tool.** The Senior Engineer's effort table labels launch-job at 2-8h, but stacked against the two unknowns (auth model + extra-var transformations), this could balloon to 10-12h if both require redesign. I'm calling this out explicitly: the critical path goes through `awx-launch-job` with the highest uncertainty multiplier.

**AAP API version detection is a new Phase 0 requirement.** The Platform Architect raised that the PRD states AAP 2.3+ as a minimum but defines no version detection or graceful degradation. This affects `client.ts` design — should every request check version, or just init-time? If the target AAP is known to be version X, do we even need this for v1? This needs a decision before `client.ts` is written.

## Updated Position

My position has **evolved but not flipped**. I still believe the core idea (Node.js plugin replacing PowerShell) is directionally correct and the 4-phase rollout is the right migration pattern. But the Council has surfaced **three concrete blockers** that change the delivery plan:

1. **Auth may not work at all** — requires a spike before any tool code.
2. **Contract types are wrong** — requires alignment before any tool code.
3. **Plugin API is undefined** — requires discovery before any tool code.

These aren't refinements; they are preconditions. The updated plan below reflects this by adding a Phase 0 that resolves all three before we write a single tool.

My confidence has moved from 0.65 → 0.72. Higher because the gaps are now well-understood and actionable. Lower than I'd like because the auth question is binary (works / doesn't work) and if the answer is "doesn't work," the entire PRD's auth model needs fundamental redesign, which could cascade into a 4-8 week delay.

## Refined Delivery Plan — Council Consensus Version

### Phase 0: Spikes & Alignment (prerequisites, ~6-10 hours)

These are **blocking** — no Phase 1 tool code starts until these resolve.

| # | Issue | Est. | Depends on | Addresses council concern |
|---|---|---|---|---|
| 0.1 | **Auth viability spike**: Generate PAT from target AAP, test `curl -H "Authorization: Bearer <token>" /api/v2/me/`. If fails, spike OAuth2 token-exchange via login flow. Document findings. | 2-4h | Nothing | SE's #2 (bearer may fail), PA's #1 (OAuth2 refresh) |
| 0.2 | **Contract alignment**: Read actual `awx_job_detail.py` output from all 3 fixtures. Write `contracts/job-detail.ts` types to match exactly (`host_status_counts`, `derived`, no `extra_vars_summary`). Pin `schema_version` to match existing format. | 1-2h | Nothing | SE's #1 (contract mismatch), PO's #3 (version format) |
| 0.3 | **Plugin API discovery**: Find/read `@opencode-ai/plugin` TypeScript types and auth hook contract. If unavailable, define the interface. Verify `type: "api-key"` supports bearer token storage. | 1-2h | Nothing | SE's #6 (undefined plugin API) |
| 0.4 | **Action-to-tool mapping table**: For each of the 22 `awx-helper.ps1` actions, document: plugin tool replacement (if any), business logic lost, acceptable-for-v1 flag. Publish to PRD. | 1-2h | Nothing | My #2 (false 90% claim), PO's #2 (coverage gap) |
| 0.5 | **AAP version detection**: Check target AAP version. Decide: init-time version check or no check (fixed target). | 0.5h | Nothing | PA's #5 (API version drift) |

**Gate: Phase 1 starts only when 0.1-0.3 are resolved and 0.4 is published.**

### Phase 1A: Infrastructure (~3-5 hours)

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 1.1 | Scaffold workspace + package.json + tsconfig | 0.5h | 0.3 |
| 1.2 | Implement auth module with two-tier strategy (primary: bearer; fallback: OAuth2 token exchange). Outcome of 0.1 determines complexity. | 1-3h | 0.1, 0.3, 1.1 |
| 1.3 | Implement client module (`client.ts`): fetch wrapper with 30s timeout, exponential backoff retry (1s/2s/4s for 5xx, zero retry for 4xx), structured error handling | 1h | 1.2 |
| 1.4 | Define contract types (`contracts/job-detail.ts`) matching actual Python output from 0.2 | 0.5h | 0.2, 1.1 |
| 1.5 | Contract compatibility test: run all 3 fixtures through both Python script and contract types, diff output, CI gate | 0.5h | 1.4 |

### Phase 1B: Read-Only Tools (~1 hour)

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 1.6 | `awx-list-templates` | 0.5h | 1.3 |
| 1.7 | `awx-list-projects` | 0.5h | 1.3 |

**MVP gate**: Issues 1.1-1.7 + plugin entry + a single tool test = first shippable chunk (~5-7 hours). Proves auth works, client works, at least one tool returns structured output.

### Phase 1C: Job Tools (~3-5 hours)

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 1.8 | `awx-launch-job` with SSH→HTTPS URL conversion and git branch inference. Name resolution with collision handling. | 2-3h | 1.3, 1.4, 1.5 |
| 1.9 | `awx-job-status` — transform raw API response to contract format | 0.5h | 1.4, 1.5 |
| 1.10 | `awx-get-job-events` — new tool per PO request. Pass-through GET `/api/v2/jobs/<id>/job_events/` | 0.5h | 1.3 |
| 1.11 | `awx-wait-job` — NON-BLOCKING version. Return job ID immediately plus a "poll later" pattern using `awx-job-status`. No internal polling loop. | 0.5h | 1.9 |

**Key design decision (Council consensus)**: `awx-wait-job` does NOT block. It returns the job ID with a structured response telling the agent to poll via `awx-job-status`. This eliminates the plugin-runtime-timeout problem (SE), avoids polling jitter complexity (PA), and provides debugging-level job events (PO). If users demand auto-polling later, it becomes a v2 feature with proper WebSocket/SSE integration.

### Phase 1D: Sync Tool (~0.5 hour)

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 1.12 | `awx-sync-project` | 0.5h | 1.3 |

### Phase 1E: Plugin Integration & Testing (~3-5 hours)

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 1.13 | Wire up plugin entry (`index.ts`) — register all tools and auth hook | 0.5h | 1.6-1.12 |
| 1.14 | Fixture-based unit tests — all tools with mocked fetch | 1-2h | 1.13 |
| 1.15 | Integration tests against live AAP — isolated test template/project | 1-2h | 1.13 |
| 1.16 | Per-tool metrics counters (success/failure counts, latency, token expiry events) for Phase-gate monitoring | 1h | 1.13 |

### Phase 2: Skill Updates (~6-14 hours total)

Split per skill, scheduled **after** monitoring confirms plugin adoption:

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 2.1 | Update `awx-windows` skill — map its 22 actions to plugin tools using table from 0.4, update examples, note SSH conversion is now in plugin | 2-4h | 0.4, 1.13 |
| 2.2 | Update `awx-integration` skill | 2-4h | 0.4, 1.13 |
| 2.3 | Update `awx-cli` skill | 1-2h | 0.4, 1.13 |
| 2.4 | Add deprecation-awareness: skill examples should mention "prefer plugin, fallback to script" | 1-2h | 2.1-2.3 |
| 2.5 | Monitor for 7 days: verify plugin handles 100% of agent-initiated AWX calls | 1h (setup) | 1.16 |

**Phase 1→2 gate**: Plugin handles 100% of agent-initiated AWX calls for 7 consecutive days (measured by metrics from 1.16).

### Phase 3: Deprecation (~1 hour)

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 3.1 | Add deprecation warnings to PowerShell scripts | 0.5h | 2.5 |
| 3.2 | Monitor for 14 days: zero PowerShell AWX calls | 0.5h (setup) | 3.1 |

**Phase 2→3 gate**: Zero PowerShell AWX calls for 14 consecutive days (measured against baseline from 1.16).

### Phase 4: Retirement (~0.5 hour)

| # | Issue | Est. | Depends on |
|---|---|---|---|
| 4.1 | Remove PowerShell scripts from repository | 0.5h | 3.2 |

**Phase 3→4 gate**: No user complaints about deprecation for 30 days.

### Revised Total Effort

| Phase | Issues | Optimistic | Realistic | Pessimistic |
|-------|--------|-----------|-----------|-------------|
| Phase 0 | 5 | 5h | 8h | 14h |
| Phase 1A-1E | 16 | 12h | 18h | 28h |
| Phase 2 | 5 | 6h | 10h | 14h |
| Phase 3 | 2 | 1h | 1.5h | 2h |
| Phase 4 | 1 | 0.5h | 0.5h | 0.5h |
| **Total** | **29** | **24.5h** | **38h** | **58.5h** |

This aligns with the Senior Engineer's 27-47.5-88h range at the lower-to-mid end. My original 16-issue/5-7h breakdown was structurally sound but estimate-naive.

## Remaining Gaps

1. **Auth is still a binary unknown.** If 0.1 finds that *no* token-based auth works against the target AAP (and the only working auth is the PowerShell module's Basic-Auth-internal-token-exchange), then the plugin design needs fundamental changes. The plan above assumes this resolves in Phase 0 with *some* viable token-based approach. If it doesn't, we need to reconvene the Council.

2. **SSH→HTTPS URL conversion logic needs to be extracted from the PowerShell script and ported to TypeScript.** This is non-trivial business logic (~30 lines in `awx-helper.ps1`) that currently handles edge cases (GitHub SSH URLs, GitLab SSH URLs, URLs with ports). Porting it to TypeScript for `awx-launch-job` assumes we can accurately reverse-engineer the PowerShell regex. This should be verified during Phase 0 with a test matrix of known URL formats.

3. **Per-tool metrics export mechanism is undefined.** The Platform Architect wants structured metrics (latency histograms, error counters) but the OpenCode plugin metrics interface may not exist. If 0.3 finds no metrics interface, 1.16 needs to define a workaround (e.g., structured logging to a known path) — adding complexity.

4. **Plugin hot-reload behavior is unknown.** If plugin updates require server restart, every Phase 1→2→3 transition is a disruptive event. This should be verified in 0.3.

5. **No E2E test plan.** The test matrix (unit, contract, integration) covers correctness, but there's no end-to-end test that simulates a full agent workflow (launch → poll → get events → parse output). This could mask integration issues that only surface in real agent sessions. I'm accepting this as a v1 gap, but it should be added to the out-of-scope list explicitly.

## Strongest Counterargument to My Position

**What the Product Owner would say I'm undervaluing**: "Every hour spent on Phase 0 spikes, contract alignment, action-to-tool mapping, and phased rollout planning is an hour that Linux/macOS users cannot run AWX automation. The cross-platform unlock is the primary value — it exists the moment the first tool works. Your 29-issue plan adds weeks of ceremony before anyone sees benefit. Ship a working `awx-list-templates` against the live AAP this week with a hardcoded token, prove the concept, then add the scaffolding."

**Why this doesn't change my conclusion**: The Product Owner is right that the cross-platform unlock is urgent. But the Senior Engineer's auth finding changes the risk calculus: if we ship a tool that authenticates successfully in testing but returns 401 on every real call, we don't have an MVP — we have a frustrating demo that erodes user trust. The Phase 0 auth spike (issue 0.1) is the *fastest* path to a real working tool because it resolves the binary unknown before we invest in tool code. If the spike takes 2 hours and reveals that OAuth2 login flow works, we can build the MVP in the same afternoon. If it takes 4 hours and reveals we need a different auth approach, we've saved weeks of wasted implementation. The spike is not ceremony; it's the fastest path to a shippable tool.

---

**Updated Verdict: Refine.** The Council has surfaced three concrete, actionable blockers (auth viability, contract alignment, plugin API discovery) that require Phase 0 spike work before Phase 1 tool implementation can begin. The 29-issue revised plan absorbs all Council concerns — contract gate, non-blocking wait-job, plugin-housed extra-var transformations, per-skill Phase 2 breakdown, and metrics-gated rollout phases — while respecting the original 4-phase structure. Resolve Phase 0, and this plan is ready to proceed.
