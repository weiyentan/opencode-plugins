---
verdict: refine
confidence: 0.65
round2-requested: yes
---

# Council Opinion: Delivery Planner

## Summary

The PRD identifies a real problem and the 4-phase rollout is a sensible migration strategy, but the delivery plan has critical gaps — the issue breakdown is viable in principle but the contract mismatch between the PRD and the existing `awx_job_detail.py` schema is a landmine, the "90% coverage" claim dramatically overstates the tool surface, and Phase 2 (skill updates) is where this plan goes to die unless de-risked with explicit mapping between old script actions and new plugin tools.

## Assessment

I've read the brief, the PRD, and the existing PowerShell infrastructure (379-line `awx-helper.ps1` with 22 actions, plus the `awx_job_detail.py` contract script). Here's what I see from a delivery perspective:

### Issue Breakdown: Can This Be Split Into 15-30 Minute Issues?

**Yes, mostly.** The 6 tools are naturally granular. I'd break the work into approximately 15 issues:

| # | Issue | Est. time | Depends on |
|---|-------|-----------|------------|
| 1 | Scaffold workspace + package.json + tsconfig | 15 min | Nothing |
| 2 | Implement auth hook (auth.ts) | 15 min | #1 |
| 3 | Implement client module with fetch wrapper + error handling | 30 min | #2 |
| 4 | Define TypeScript contract types (job-detail.ts) | 15 min | Nothing |
| 5 | Implement awx-list-templates tool | 15 min | #3 |
| 6 | Implement awx-list-projects tool | 15 min | #3 |
| 7 | Implement awx-launch-job tool (name resolution + extra vars) | 30 min | #3, #4 |
| 8 | Implement awx-job-status tool (transforms raw API → contract) | 20 min | #3, #4 |
| 9 | Implement awx-sync-project tool | 15 min | #3 |
| 10 | Implement awx-wait-job tool (polling loop + timeout + jitter) | 30 min | #3, #4 |
| 11 | Wire up plugin entry (index.ts) | 15 min | #5-10 |
| 12 | Fixture-based unit tests (all tools) | 30 min | #5-10 |
| 13 | Integration tests against live AAP | 30 min | #11 |
| 14 | Phase 2: Update skills (awx-windows, awx-integration, awx-cli) | 45 min | #11 |
| 15 | Phase 3: Deprecation warnings on PowerShell scripts | 15 min | #14 |
| 16 | Phase 4: Remove PowerShell scripts | 15 min | #15 |

**But**: Issues #10 (wait-job) and #14 (skill updates) are likely 45-60 min, not 15-30. The `awx-wait-job` tool requires non-trivial polling state management, configurable interval/timeout, jitter, and edge cases (what if the job is cancelled mid-poll?). The skill updates require auditing every agent workflow that calls PowerShell and replacing each with the correct plugin tool — and `awx-helper.ps1` has 22 actions, only 6 of which map to plugin tools.

**Verdict on breakdown**: Achievable but honest estimates push this to 5-7 hours total, not the 4 hours implied by 16×15min claims.

### Dependency Chains and Critical Path

The dependency DAG is shallow — most tools are parallel after the shared infrastructure:

```
Scaffold (#1)
    ├── Auth hook (#2)
    │       └── Client module (#3)  ← CRITICAL PATH
    │               ├── awx-list-templates (#5) ─┐
    │               ├── awx-list-projects (#6) ──┤
    │               ├── awx-launch-job (#7) ─────┤
    │               ├── awx-job-status (#8) ─────┤
    │               ├── awx-sync-project (#9) ───┤
    │               └── awx-wait-job (#10) ──────┤
    │                                            ├── Plugin entry (#11)
    │                                            │       └── Integration tests (#13)
    │                                            └── Skill updates (#14)
    └── Contract types (#4) ───┘
```

**Critical path**: #1 → #2 → #3 → (any single tool) → #11
**Time to first shippable tool**: ~75 minutes (scaffold + auth + client + list-templates + plugin entry)

### Incremental Delivery Strategy

The 4-phase rollout is well-structured, but I'd add a Phase 0 and tighten Phase 2:

**Phase 0 — Contract alignment (30 min, before any code)**: Write a compatibility test that runs the same input through both `awx_job_detail.py` and the planned plugin contract module, and diff the outputs. The PRD and the existing code disagree on the contract shape already (see Key Concerns below). We need to settle this before writing tool code.

**Phase 1A — Read-only tools first**: Ship `awx-list-templates` and `awx-list-projects` as the absolute MVP. These require no AAP write operations and prove auth+client works. This could be done in ~90 minutes.

**Phase 1B — Job tools**: Add `awx-launch-job`, `awx-job-status`, `awx-wait-job`. This is the critical value: launching jobs and getting results.

**Phase 1C — Sync tool**: Add `awx-sync-project` (least used, lowest risk).

**Phase 2 — Skill updates**: This is not a single issue. It should be split per skill:
- Update `awx-windows` skill (most complex — 22 actions, SSH conversion, branch inference)
- Update `awx-integration` skill
- Update `awx-cli` skill

Each skill update requires: (a) mapping its script calls to plugin tools, (b) updating documentation examples, (c) testing that the new examples work.

**Phase 3+4**: Straightforward once Phase 2 is confirmed stable.

### Smallest Shippable Chunk

A single tool plus infrastructure. The smallest I'd ship:

**1 issue (30 min):** Scaffold + auth + client + `awx-list-templates` tool + plugin entry.

This proves: auth hook works, client calls AAP successfully, structured output returns, plugin registers with OpenCode. It's not independently useful to a user (listing templates without launching jobs is frustrating), but it's the earliest validation point.

**More useful MVP (2 issues, ~60 min):** The above + `awx-launch-job` + `awx-job-status`. Now a user can launch a job and check its status without touching PowerShell.

### Token/Cost Efficiency Analysis

**Current PowerShell cost per call:**
- Subprocess spawn: ~300-500ms startup
- Module discovery and import: ~500-2000ms (scanning PSModulePath, parsing .psd1 files)
- Credential file parsing: ~100ms
- SSL bypass setup: ~50ms
- API call: ~200-500ms
- Output formatting to text: ~100ms
- **Total latency**: ~1.2-3.5 seconds per call
- **Token cost for failed calls**: When credential XML is missing/expired (~200-400 error tokens), the agent may retry 2-3 times, burning 400-1200 tokens on infrastructure failures alone.

**Plugin cost per call:**
- In-process fetch: ~50ms setup
- Token in memory: ~1ms access
- API call: ~200-500ms (same network)
- Structured JSON output: ~20ms
- **Total latency**: ~250-550ms per call (3-6× faster)
- **Token cost for failures**: 401/403 responses return structured errors (~50-100 tokens). No retries for auth failures — fail fast.

**Estimated per-session savings**: For a session with 8 AWX operations:
- Current: ~10-28 seconds wall time + ~400-1600 tokens for infrastructure overhead
- Plugin: ~2-4 seconds + ~0 tokens for auth overhead
- **Token savings**: ~400-1600 tokens per session (conservative; more if failures occur)

**Model call cost**: The plugin doesn't reduce model calls (OpenCode still calls the tool), but it reduces **wasted model context** by eliminating error messages in the conversation history. Each avoided "credential not found" error keeps ~200-400 tokens available for actual work.

### What the Product Owner would say I'm undervaluing

The Product Owner would say I'm over-indexing on delivery efficiency and missing **the primary user value**: the 90% of OpenCode users who can't access AWX at all today because they're on Linux or macOS. Every minute spent on contract alignment, issue breakdown, or multi-phase rollout planning is a minute those users can't run AWX automation. The PO would argue: ship a working (even imperfect) MVP this week, not a perfect migration next month. The wait-job polling doesn't need jitter on day one. The contract doesn't need byte-for-byte compatibility — it needs to be *good enough* that agents can parse the output. The cross-platform unlock is worth taking some delivery shortcuts.

I acknowledge this is fair, but I counter: the contract mismatch will cause *worse* failures than the current PowerShell stack if skills that parse job detail output get unexpected shapes. A 30-minute contract alignment check before coding is the minimum gate.

## Key Concerns

1. **Contract mismatch between PRD and existing code.** The PRD's output contract shows `host_summary` and `extra_vars_summary`. The existing `awx_job_detail.py` output has `host_status_counts` and `derived` — and no `extra_vars_summary`. These are structurally different. If the plugin ships with PRD's contract shape, every skill that reads job detail output will either (a) not find fields it expects, or (b) find new fields it doesn't understand. The schema version check won't help if consumers don't check it. **This must be resolved before writing tool code.**

2. **"90%+ of AWX operations" is false and dangerous.** The existing `awx-helper.ps1` supports 22 actions. The PRD covers 6. That's 27%, not 90%. The claim is counting something else (maybe "covers 90% of what agents invoke") but without data to back it, this will mislead downstream planning. Skills that use `get-job-events`, `get-job-stdout`, `get-template`, `get-jobs`, or any of the 10+ list-* operations will have no plugin replacement and will need to keep PowerShell as a fallback, complicating Phase 2.

3. **Phase 2 (skill updates) is underspecified and is the highest-risk delivery item.** The `awx-windows` skill has 140+ lines of PowerShell examples with business logic (SSH-to-HTTPS URL conversion in `ConvertTo-HttpsUrl`, git branch inference, `RequiredVarNames` validation) that has no stated equivalent in the plugin. Updating these skills isn't "find and replace" — it's understanding what each script does, whether the plugin replicates it, and updating agent prompts accordingly. I estimate this at 45-60 minutes per skill, not the implicit 15 minutes.

4. **No success metrics for rollout phases.** The PO raised this and I agree: how do we know when Phase 1 is "done" and Phase 2 can start? What's the trigger for deprecation? Without metrics, the 4-phase plan is a calendar, not a decision framework. I'd define: "Phase 2 starts when the plugin handles 100% of agent-initiated AWX calls for 7 consecutive days with zero failures" — but we can't measure that without monitoring.

5. **Effort is underestimated for polling/logic-heavy tools.** `awx-wait-job` needs: configurable polling interval, configurable timeout, jitter (per Platform Architect), cancellation detection, error handling for AAP becoming unreachable mid-poll. This is more than a simple GET loop — it needs state management across poll iterations. Similarly, `awx-launch-job` needs template name resolution (extra API call), extra vars handling, validation, and error mapping. These aren't 15-min issues.

6. **Contract version format mismatch.** The PRD says `schema_version: "1.0"` (two-part). The existing `awx_job_detail.py` defines `SCHEMA_VERSION = "1.0"` — actually the same. But the PRD's contract structure differs (different field names). This needs a compatibility test.

## Recommendations

1. **Write a contract compatibility test before any tool code.** Take the three existing fixtures (`awx_job_success.json`, `awx_job_partial.json`, `awx_job_failure.json`), run them through `awx_job_detail.py`, then verify the plugin's contract module produces identical output. Fix discrepancies before shipping. This is a 30-minute gate that prevents the worst migration failure mode.

2. **Reslice the work plan.** Separate the issue list into Phase 1A (read-only, 2 tools), Phase 1B (job tools, 3 tools), Phase 1C (sync tool), and Phase 2 (3 skill-specific issues). Be honest that Phase 2 is 45-60 min per skill, not 15.

3. **Add a tool-action mapping table to the PRD.** For each of the 22 actions in `awx-helper.ps1`, state: (a) which plugin tool replaces it, (b) what business logic (if any) is lost, (c) whether the loss is acceptable for v1. This makes Phase 2 mechanically derivable.

4. **Define Phase-gate criteria.** Phase 1→2 gate: "Plugin handles 100% of agent-initiated AWX calls for 7 days." Phase 2→3 gate: "Zero PowerShell AWX calls for 14 days." Phase 3→4 gate: "No complaints about deprecation for 30 days."

5. **Accept that Phase 1 will not retire all scripts.** Be explicit that scripts for `get-job-events`, `get-job-stdout`, `get-template`, `get-jobs`, and all list-* operations beyond the 6 tools will continue to run alongside the plugin. Remove the "90%+" language.

## Questions That Need Answers

1. **What is the actual agent usage frequency for each of the 22 helper actions?** Without this, I can't tell which missing tools are critical gaps vs. nice-to-haves. If `get-job-events` is called 3× per session, it's a critical gap. If it's called once a month, it's Phase 2 material.

2. **Who owns the skill updates in Phase 2?** Is this the same developer who builds the plugin, or a separate person? If separate, the handoff cost must be factored in. If the same person, the skill updates may need to precede tool completion so agents can test against real workflows.

3. **What is the bearer token TTL in the target AAP deployment?** This determines whether we need a token refresh mid-session — and that affects the `client.ts` complexity estimate significantly.

4. **How does the OpenCode plugin hot-reload work?** When we push a new version of a plugin in Phase 1→2 transition, does the user need to restart their session? If yes, the rollout is more disruptive than the PRD implies.

5. **Are there existing skills that parse `schema_version` from job detail output?** If any skill checks `payload.schema_version`, the format change would trigger a break. This is a 5-minute grep but must be done before Phase 2.

---

**Verdict: Refine.** The core idea — replacing brittle PowerShell with a Node.js HTTP plugin — is directionally correct, and the 4-phase rollout is the right migration pattern. But the delivery plan needs honest reslicing (6 of 22 actions ≠ 90%+), a contract compatibility gate must be added before Phase 1 coding, and Phase 2 skill updates need explicit action-by-action mapping to avoid shipping a plugin that agents can't fully use. Fix these gaps and the plan is ready to proceed.
