---
verdict: refine
confidence: 0.55
---

# Council Response: Product Owner

## Reactions to Other Members

### Agreement

**On the contract mismatch being a showstopper, not a cosmetic fix.** The Senior Engineer's discovery that the PRD's TypeScript types don't match the actual `awx_job_detail.py` output — `host_summary` vs `host_status_counts`, missing `derived`, phantom `extra_vars_summary` — is the most important finding in Round 1. I flagged a shallow symptom (version format "1.0" vs "1.0.0"), but the Senior Engineer went deeper and found the entire type table is wrong. This changes my assessment: this isn't a documentation update, it's a redesign of the core contract. Every tool that returns job status will produce output that existing skill renderers can't parse. I now agree with the Delivery Planner that a contract compatibility test must be the **zeroeth deliverable**, written before any tool code.

**On the bearer token viability being a foundational risk.** The Senior Engineer's cite of the existing `awx-windows` skill — "PAT Authentication Does NOT Work" — is a thunderbolt. I had assumed bearer-token auth was uncontroversial (a standard HTTP header). If the target AAP instance rejects bearer tokens from personal access tokens, then the entire auth hook design is invalid. The Platform Architect's OAuth2 token refresh concern becomes moot if bearer tokens don't work at all. This elevates the auth question from "how do we handle expiry?" to "can we authenticate at all?" I agree with the Senior Engineer's recommendation: **a spike to test `curl -H "Authorization: Bearer <PAT>" /api/v2/me/` on the target AAP must happen before we plan implementation timelines.**

**On the 90% coverage claim being false.** The Delivery Planner's math matches mine: 6 of 22 actions is 27%, not 90%. We both called this out independently, and no one defended the 90% figure. I appreciate the Delivery Planner's tool-action mapping table recommendation — a per-action mapping of script → plugin (or gap) would make Phase 2 mechanically derivable and prevent the hidden-continuation problem (Phase 2 updates that silently leave scripts in use).

**On polling being wrong for a plugin runtime.** The Senior Engineer's point that plugin runtimes may have 30-60s timeouts — making 600-second polling impossible — is a design constraint I hadn't considered deeply enough. The Platform Architect's jitter concern is downstream of this fundamental question: can we block the plugin thread for 10 minutes at all? The Senior Engineer's proposed alternative — `awx-wait-job` returns immediately with a job ID, and the agent uses a poll-loop via `awx-job-status` — is the right design for the plugin architecture. I wish the PRD had surfaced this constraint instead of assuming synchronous polling.

### Disagreement

**On the scope of missing tools.** The Senior Engineer recommends adding `awx-get-job-events` and `awx-get-job-stdout` to v1 scope. I made the same recommendation in my Round 1 (add `awx-get-job-events`). But after reading the Delivery Planner's point about per-action usage frequency, I'm less certain. **We don't know how often agents actually call `get-job-events`.** If it's a rare debugging call, it belongs in Phase 1B or Phase 2. If it's called in every session, it's a v1 blocker. The Delivery Planner's question — "what is the actual agent usage frequency for each action?" — is the right framing. I'd rather answer that question with data than guess, even though answering it delays scope decisions.

**On whether the extra-var transformations block v1.** The Senior Engineer identified that the existing script does SSH→HTTPS conversion, branch inference, and required-var validation before launching jobs. I flagged this as a concern in Round 1. But I disagree that this must live in the plugin. **It could live in the skills as a pre-processing step** — the skill instructs the agent: "before calling `awx-launch-job`, ensure `target_repo_url` is HTTPS and `target_branch` is set." This is worse for the agent (more instructions to follow) but simpler for the plugin. The Senior Engineer prefers plugin-side; I could accept either as long as it's explicitly assigned. My position: **document a clear owner for these transforms in the PRD, but don't block v1 on it** — the transforms can be skill-side initially and moved into the plugin later if agent compliance is poor.

### New Concerns Raised

**1. Plugin API surface is undefined.** The Senior Engineer noted that `@opencode-ai/plugin` TypeScript types don't exist in the repository. The auth hook interface is undocumented. This is a genuine dependency risk — if the plugin API doesn't exist yet, the implementation can't start. I should have caught this as the Product Owner: the PRD references an API that doesn't exist. This is a scoping gap.

**2. AAP API version drift.** The Platform Architect raised that the PRD states AAP 2.3+ as minimum but defines no version detection or graceful degradation. From a user value perspective: if someone upgrades AAP mid-project and a field moves, the plugin silently breaks. A version check on init is a small investment for significant reliability. I support adding it.

**3. Phase-gate criteria.** The Delivery Planner defined concrete gates (Phase 2 starts when plugin handles 100% of AWX calls for 7 days, etc.). I should have done this in the PRD. These are measurable, conservative, and address my Round 1 complaint about missing success metrics. I'm adopting these wholesale.

**4. Concurrent polling thundering herd.** The Platform Architect flagged that 20 concurrent `awx-wait-job` polls could trigger AAP rate limiting. This is a real operational concern that the PRD missed entirely. If we keep the polling model (even as a skill-level pattern rather than a plugin tool), we need jitter and rate-limit awareness.

## Updated Position

My Round 1 verdict was **refine** at 0.70 confidence. After reading all Round 1 opinions, I am holding at **refine** but dropping my confidence to **0.55**. Here's why:

**What got worse:**
- **Bearer token might not work at all.** This isn't a nuance; it's an existential threat to the auth model. Confidence dropped 15 points.
- **Contract mismatch is structural, not cosmetic.** The entire TypeScript type table is wrong. This isn't "fix a version string" — it's redesign the output contract. Confidence dropped 10 points.
- **Plugin API may not exist.** We can't start implementation until the `@opencode-ai/plugin` types are published. This is a schedule risk I hadn't estimated. Confidence dropped 5 points.

**What stayed the same or improved:**
- The problem (brittle, Windows-only PowerShell stack) is still real. No one disputed this.
- The direction (Node.js plugin, cross-platform, bearer auth) is still correct.
- The 4-phase rollout is still the right migration pattern.
- My concerns about success metrics, coverage claims, and extra-var transformations were validated by the engineers and planner.

**What I'll change my position on:**
- **v1 scope:** I no longer insist on adding `awx-get-job-events` to v1. Instead, I insist on **measuring actual usage frequency first** to decide what's v1-critical vs. Phase 2.
- **Extra-var transformations:** I accept skill-side preprocessing as a v1 mitigation, as long as it's documented in the skill files and the PRD says whose job it is.
- **Polling:** I agree with the Senior Engineer — `awx-wait-job` should not be a synchronous long-poll. Make it return immediately and document a skill-level poll loop.
- **Success metrics:** I adopt the Delivery Planner's Phase-gate criteria as the minimum. No need to invent from scratch.

### Summary of Minimum Acceptable Path Forward

Before this PRD moves to implementation, I need these six things:

1. **Auth spike** (1 hour): Confirm bearer token auth works on `https://aap.tanscloud-internal.com`. If it fails, design and cost an OAuth2 token-exchange alternative. This is the single highest-risk item and must be resolved first.

2. **Contract alignment** (30 min): Write a compatibility test that runs the existing fixtures through both `awx_job_detail.py` and the corrected TypeScript contract module, and diff the outputs. The TypeScript types must match the Python output byte for byte. This is a zero-write gate — no tool code until this passes.

3. **Honest scope statement**: Replace "90%+ of AWX operations" with "6 critical-path tools (launch, status, list templates/projects, sync projects)" and add a per-action mapping table showing which of the 22 existing actions are covered, which are gaps, and whether those gaps are acceptable for v1.

4. **Non-blocking polling**: `awx-wait-job` redesigned to return immediately with a job ID. The skill update teaches agents "call `awx-job-status` in a loop" rather than blocking the plugin thread. Acceptable as a v1 pattern — we can add server-side polling later.

5. **Documented extra-var responsibility**: The PRD must state whether the plugin or the skills owns SSH→HTTPS conversion, branch inference, and required-var validation. I accept skill-side ownership for v1, but it must be explicit so the skill authors know what to write.

6. **Phase-gate criteria**: Defined in the PRD. I'll adopt the Delivery Planner's proposal: Phase 1→2 gate = plugin handles 100% of agent-initiated AWX calls for 7 days; Phase 2→3 gate = zero PowerShell AWX calls for 14 days; Phase 3→4 gate = no complaints about deprecation for 30 days.

## Remaining Gaps

1. **Undefined plugin API surface.** I need to know whether `@opencode-ai/plugin` types exist, where they live, and whether the auth hook called `type: "api-key"` is a real contract. If the types don't exist, the delivery timeline starts with "write the plugin interface" which adds a hidden dependency.

2. **Agent usage data.** I recommended measuring actual action frequency before deciding whether `get-job-events` is v1-critical. But I don't know if this data is accessible. Do we have telemetry on which `awx-helper.ps1` actions agents invoke? Without this, scope decisions remain subjective.

3. **Plugin hot-reload capability.** The Platform Architect asked whether plugin updates require a server restart. If they do, Phase 1→2 is a disruptive event for every user. This should be confirmed before committing to the 4-phase plan.

4. **AAP bearer token TTL.** The Platform Architect and Delivery Planner both asked this. If tokens last 30 days, the refresh concern is manageable. If they last 1 hour, the auth model is broken even if bearer tokens work. This must be confirmed during the auth spike.

## Addressing the S2 Prompt

**What would the Senior Engineer say is the implementation risk you're underestimating?**

The Senior Engineer would say I'm underestimating **the bearer token viability risk** by treating auth as a solved problem. In my Round 1 opinion, I focused on scope coverage and success metrics — important product concerns — while assuming the auth model was settled. The Senior Engineer found written evidence in the codebase that PAT authentication fails on this AAP instance. If that's still true, the entire v1 plan collapses: no auth = no plugin = no migration. Every other concern I raised — contract alignment, scope, metrics — becomes irrelevant. The Senior Engineer is right: I should have flagged this as the single highest-risk item and required a spike before any other planning. My Round 2 treatment elevates this to #1 on the path forward precisely because I now recognize I was too credulous about the auth assumption.

---

**Verdict: Refine.** The problem is real and the direction is correct, but the PRD has three critical unknowns — whether bearer token auth works at all, whether the plugin API surface exists, and whether the contract has been correctly reverse-engineered from the actual code — that must be resolved through spikes before implementation begins, and the scope claims must be replaced with honest per-action mapping and measurable phase-gate criteria.
