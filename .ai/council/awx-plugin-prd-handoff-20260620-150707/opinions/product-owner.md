---
role: product-owner
tier: lightweight
verdict: proceed
confidence: 0.80
summary: "The handoff resolves all critical unknowns and the refined PRD is ready for /to-issues, with minor refinements needed on success metrics, the contract.test.ts sequencing risk, and issue consolidation."
---

# Council Opinion: Product Owner

## Summary

This handoff convincingly proves that the AWX plugin is the right solution to a real, measurable problem. The three critical unknowns from the prior Council are resolved with evidence (curl spike, fixture verification, API type discovery). The scope is honest (7/22 actions = 30%) but covers the 80% use case. I recommend **proceed** with three refinements to strengthen the success metrics, reduce the contract.test.ts execution risk, and consolidate a few overly granular issues before running `/to-issues`.

## Problem Validation

The seven pain points in the refined PRD are concrete, not hypothetical:

1. **PowerShell 5.1 lock-in** — I've seen the cross-platform block myself. Linux/macOS users have zero AWX access today. That's a hard platform gap, not a nice-to-have.
2. **Credential XML on disk** — Security risk that's been deferred too long. The XML file is plain-text-adjacent and lives outside any secrets management flow.
3. **Hardcoded URLs** — Directly limits adoption. Every new team must fork scripts.
4. **Duplicated discovery / dot-source coupling** — These are maintainer pain points that manifest as brittle failures in agent sessions.
5. **SSL bypass everywhere** — No production-grade TLS is a compliance issue waiting to surface.
6. **Token wastage** — This is the one the user _feels_. When an agent burns 40% of its context on "PowerShell module not found" debugging, the user gets a worse experience.

These are **real needs**, not perceived ones. The existing PowerShell scripts work when everything is aligned, but that alignment is fragile. The plugin eliminates all six failure modes at once.

## User Value Assessment

| Stakeholder | Value | Magnitude |
|---|---|---|
| **OpenCode users (primary)** | Faster, reliable AWX ops; cross-platform access | High — affects every AWX session |
| **Platform maintainers** | Testable, portable, maintainable code | Medium — reduces support burden |
| **AAP admins** | No config changes needed; PAT-only setup | Low — no change to AAP side |
| **New teams** | Plug-and-play: configure `baseUrl` + PAT, done | High — removes onboarding friction |

The user stories (9 end-user + 1 maintainer) are well-prioritized. The top 7 (launch, status, wait, list-templates, list-projects, sync-project, get-job-events) cover the operational surface area that agents use most.

## Scope Assessment

**The 7/22 actions (30%) coverage is the right call, but I want to stress-test it.**

The tool-action mapping table is exemplary — it's honest, prioritized, and documents what business logic is lost. My concern is whether the gaps will be immediately painful:

- **`get-template`** (individual template detail) — This is the most likely immediate pain point. Agents frequently need to inspect a single template's details before launching. Making them fall back to PowerShell for this is frustrating.
- **`get-job-stdout`** — Partially covered by `awx-job-status --include-stdout`, so this gap is smaller.
- **`list-credentials`** — Medium priority feels right. Important but not day-1 blocking.

**Recommendation:** Consider adding `get-template` to v1 if it's a ~1h add like `get-job-events` was. The handoff already demonstrated the pattern (add to v1 scope when effort is low). If it's more than 2h, defer it.

The 14-issue breakdown is slightly too granular for my taste. Issues 1-3 (scaffolding, contract types, auth hook) and 6-7 (list-templates, list-projects) are well-sized. But issues 10 (`wait-job`) and 11 (`get-job-events`) will each take ~1-1.5h — that's overhead-heavy for issue management. I'd consolidate them into a "Read-only tools" epic and a "Job tools" epic rather than 14 individual issues, but this is a workflow preference, not a blocker.

## Acceptance Criteria Evaluation

**Strengths:**
- `contract.test.ts` as the zeroeth deliverable is architecturally sound — types first, tools second.
- Phase-gate criteria are measurable (consecutive days, pass/fail ratios).
- Integration tests against live AAP are the right final gate.

**Weaknesses:**
- **No user-perceptible success metric.** The gates are all internal (no PowerShell calls, no complaints). I want a metric like "average agent tool call latency reduced by X%" or "AWX-related agent failure rate drops from Y% to Z%." Without a user-facing improvement signal, we can't prove the plugin is actually better — just that it's different.
- **No performance budget.** What's the acceptable latency for each tool? If `awx-launch-job` takes 5 seconds more than the PowerShell equivalent because of the extra-var transforms, users may not perceive an improvement.

## S2 Structured Disagreement Response

**What the Senior Engineer would say I'm underestimating:**

> "You're signing off on a `contract.test.ts` that requires running Python from a Node.js test suite. That means `child_process.execFile('python', ...)` with all the `python3` vs `python` vs virtualenv ambiguity. This is fragile — it'll break on the first CI runner that doesn't have Python installed. And you're gating ALL tool code on this? If the Python diff fails for environmental reasons, no tool work can proceed. That's a dangerous dependency."

This is a fair concern. I'm mitigating it because **we have three verified fixtures** — the Python script has already been run against them and the output is known. The `contract.test.ts` could use a **snapshot approach** instead of a live cross-language subprocess: run the Python script once (it's done), capture the output as a JSON snapshot, and have the TypeScript test diff against that snapshot. This eliminates the Python dependency from CI entirely.

If we insist on the live subprocess approach (which has value for ongoing validation), we need to document the Python setup as a dev dependency and handle the `python3` vs `python` resolution in the test harness. Not a blocker, but needs explicit attention in the first implementation issue.

## Key Concerns

1. **Success metrics lack a user-facing improvement signal.** The phase gates measure internal adoption (no PowerShell calls, no complaints) but not whether the user experience actually improved. Add: "Average tool call latency < X seconds" and "AWX-related agent failure rate < Y%."

2. **The `get-template` gap is the most likely immediate user pain.** Get a size estimate before finalizing the v1 scope. If it's ~1h, include it (8/22 = 36% coverage, much better story).

3. **14 issues may be too granular** for effective tracking. Risk of issue-management overhead eating implementation time. Consider 7-10 issues with grouped scopes.

4. **No rollback plan.** If Phase 2 reveals that the plugin has critical gaps, what's the escape hatch? The PowerShell scripts aren't deprecated yet (Phase 3), but the handoff doesn't discuss what triggers a rollback vs. a gap-fill iteration.

## Recommendations

1. **Proceed with /to-issues** — the foundation is solid and the unknowns are resolved.

2. **Add a user-facing performance metric** to the phase-gate criteria before breaking issues. Define: "Average `awx-launch-job` latency ≤ 3s from agent call to job ID return."

3. **Consolidate the issue breakdown** from 14 to 8-10 issues:
   - Phase 0 Scaffolding (current 1)
   - Contract + Auth (merge 2, 3)
   - Client module (current 4)
   - Transforms (current 5)
   - Read-only tools (merge 6, 7)
   - Job tools: launch + status (merge 8, 9)
   - Job tools: wait + events (merge 10, 11)
   - Sync tool (current 12)
   - Plugin entry + integration (merge 13, 14)

4. **For `contract.test.ts`:** Use a snapshot-based approach to avoid the Python subprocess dependency. Run `awx_job_detail.py` against fixtures once, check the snapshot into the repo, and have the TypeScript test diff against the snapshot. Document how to regenerate the snapshot.

5. **Document a rollback trigger.** Define: "If 3 or more blocker bugs are found in Phase 2 within the first week, revert to PowerShell fallback and schedule a gap-fill sprint."

## Questions That Need Answers

1. What's the estimated effort for `get-template` as an 8th tool? If ≤ 2h, should it be included in v1?

2. What is the current AWX-related agent failure rate (to be the baseline for the improvement metric)?

3. Are there any existing users on Linux/macOS who need AWX access now (vs. "eventually")? This affects the priority of the cross-platform benefit.

4. What's the token TTL on the target AAP? ADR 0001 flagged this as unknown. A 1-hour TTL would make the single-PAT-per-session model painful for long-running agent sessions.

5. Who will own the `contract.test.ts` snapshot regeneration when the Python script's output contract changes? This is a cross-team dependency that needs an owner.

## Strongest Counterargument

The strongest counterargument is from the **Platform Architect**: "You're approving a plugin that covers only 30% of the existing surface area. When the first agent session encounters a gap (e.g., needs to list credentials and can't), the user experience regresses — they have to manually switch mental models and run a PowerShell script. This regression in UX is worse than the current state where everything works (if fragile)."

I respect this concern, but it does not change my conclusion because: the tool-action mapping table is transparent — there are no hidden gaps. The documented fallback pattern (use PowerShell for gaps) preserves the current capability. And the 7 covered actions represent the high-frequency, high-value operations. A regression from "everything works but brittle" to "core operations work smoothly, edge cases need fallback" is a net improvement in the 80% case. The phase gates (Phase 2→3) explicitly ensure the transition only completes when the gaps are no longer painful. This is exactly the right rollout strategy.
