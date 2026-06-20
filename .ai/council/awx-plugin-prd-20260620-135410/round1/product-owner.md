---
verdict: refine
confidence: 0.70
round2-requested: yes
---

# Council Opinion: Product Owner

## Summary

The PRD identifies a genuine, painful problem — a brittle, Windows-only PowerShell AWX stack that causes agent failures, token waste, and excludes Linux/macOS users — and the proposed Node.js plugin architecture is the right solution direction, but the v1 scope is too narrow relative to what agents actually need, and the absence of measurable success criteria makes it impossible to validate whether the migration is working.

## Assessment

**The problem is real.** I've seen the impact firsthand: credential XML files that expire with cryptic errors, module discovery failures when OneDrive changes PSModulePath, the SSL bypass that blocks production deployment, and the Windows-only lockout that means AWX automation is unavailable to any agent running on Linux. These aren't theoretical — the current `awx-helper.ps1` has 379 lines of defensive workarounds (custom module discovery, SSH-to-HTTPS URL conversion, git branch inference) that exist precisely because the foundation is fragile. The token wastage from retries after infrastructure failures is also real and directly degrades the user's effective context window.

**Who benefits, and how?** Three groups:

1. **Linux/macOS OpenCode users** — They gain AWX access they simply don't have today. This is the highest-value unlock: AWX automation becomes available on any platform.
2. **Windows OpenCode users** — They get a reliable, credential-file-free experience without the opaque "AnsibleTower module not found" failures. The bearer token auth is simpler and more secure.
3. **Platform maintainers** — A single TypeScript codebase replaces the Python + PowerShell + dot-sourced script sprawl.

**Success is not measurable.** This is my biggest concern. The PRD says "reduced token wastage" and "improved reliability" but defines no metrics:
- What's the baseline failure rate of the current PowerShell stack? Without this, we can't prove the plugin improves anything.
- What's the target for "token wastage reduction"? 50%? 90%?
- What's the acceptable migration window for the 4-phase rollout? When do we declare Phase 4 (retirement) complete?
- What user satisfaction metric are we tracking? If no one uses the plugin after Phase 2, do we still retire the scripts?

**The v1 scope is too narrow relative to actual usage.** The PRD claims the 6 tools cover "90%+ of AWX operations," but the current `awx-helper.ps1` supports **22 actions**. I mapped the skill files to actual usage:

| Used in critical agent workflows | Covered in v1? |
|---|---|
| launch | ✅ `awx-launch-job` |
| wait-job | ✅ `awx-wait-job` |
| list-templates | ✅ `awx-list-templates` |
| list-projects | ✅ `awx-list-projects` |
| sync-project | ✅ `awx-sync-project` |
| get-job-events | ❌ — but referenced by `awx_job_detail.py` for debugging |
| get-template | ❌ — used by `awx-windows` for template inspection |
| get-jobs | ❌ — used for recent job history queries |
| list-credentials | ❌ — used by skills to find credentials |
| list-inventories | ❌ — referenced in skill docs |
| list-execution-environments | ❌ — referenced in skill docs |
| list-organizations, -hosts, -users, -teams, -instance-groups | ❌ — informational queries |

The critical-path operations (launch, wait, list templates/projects, sync) *are* covered, and I agree these are the right v1 priority. But the "90%+" claim is misleading — measured by distinct operations, it's ~27% of the current surface. The gap in `get-job-events` is most concerning because it's used by the `awx_job_detail.py` contract itself for enriched job failure diagnosis. If the plugin replaces the script but can't provide equivalent debugging information, agents will have a degraded troubleshooting experience.

## Key Concerns

1. **No success metrics.** The PRD reads as a technical replacement plan, not a product initiative. There's no "how will we know this works?" section. Without baseline failure rates and target improvements, this is a rebuild with unproven benefits.

2. **The "90%+ coverage" claim is overstated.** The actual action coverage is 6 of 22 (~27%), and while those 6 cover the critical path, the gap in job events/debugging is material. The PRD should be honest about what's missing and justify why it's acceptable for v1.

3. **Contract version mismatch risk.** The PRD says `schema_version: "1.0"` (two-part), but the current `awx_job_detail.py` uses `schema_version: "1.0.0"` (three-part). Skills that parse this field — if any — will break. This is a small detail but signals that the contract alignment analysis may not have been thorough.

4. **Migration Phase 2 is underspecified.** "Update skills to prefer plugin tools" sounds straightforward, but the `awx-windows` skill alone has 140+ lines of PowerShell examples with specific flag combinations (`-RequiredVarNames`, `-ExtraVars`, SSH-to-HTTPS conversion) that the plugin tools don't explicitly replicate. The SSH URL conversion (`ConvertTo-HttpsUrl` in the helper) is business logic that agents currently get for free — will the plugin provide it?

5. **No user research or stakeholder input.** Was this validated with actual OpenCode users who hit AWX failures? The 6-tool set feels like it was derived from reading the script file, not from observing real agent workflows.

## What the Senior Engineer Would Say

*"You're underestimating the contract alignment effort. The plugin output needs to be byte-for-byte compatible with what `awx_job_detail.py` produces, or every skill that consumes job detail output — `awx-windows`, `awx-cli`, `awx-integration`, `opencode-develop-loop-runner` — will need individual fixes. The 4-phase rollout sounds clean, but Phase 2 is where every edge case you missed surfaces as a production breakage. Also, the 'no auto-retry' policy will create a worse user experience than you think — agents encountering a transient 503 will fail immediately instead of retrying, burning tokens on error messages rather than useful work."*

I agree with this. The Senior Engineer is right that contract compatibility is the highest-risk item in the migration. I'd add that the output contract should be defined by an integration test that runs the same input through both the old script and the new plugin, with a `diff` step. If we haven't done that, we're flying blind.

## Recommendations

1. **Define success metrics before writing code.** Baseline the current PowerShell failure rate (run a monitoring script for 2 weeks), set target improvements, and define what "migration complete" means.

2. **Add `awx-get-job-events` to v1 scope.** The PRD already has `awx-job-status`; adding `awx-get-job-events` (even as a simple passthrough) closes the debugging gap that `awx_job_detail.py` currently fills. Without it, the plugin is a regression for troubleshooting.

3. **Be honest about the coverage gap.** Change "90%+ of AWX operations" to "critical-path operations (launch, status, wait, list templates/projects, sync projects)" and explicitly call out the debugging gap as a v1 limitation.

4. **Pin the schema version to `1.0.0` (three-part)** to match the existing contract exactly. This costs nothing and prevents a subtle breakage.

5. **Add a contract compatibility test.** Before Phase 2, run the same operation through both the PowerShell script and the plugin, diff the outputs, and fix discrepancies. Make this a CI gate.

6. **Specify the auto-retry strategy.** Even if it's just "retry once on 5xx with exponential backoff" — the current "no auto-retry" stance will produce poor agent behavior in real network conditions.

## Questions That Need Answers

1. What is the current failure rate of PowerShell AWX operations? (Measured how, over what period?)
2. What is our target success rate for the plugin? (e.g., "95% of launch operations succeed on first attempt")
3. Which skills consume the `schema_version` field and would break on format change?
4. Will the plugin replicate the SSH-to-HTTPS URL conversion and git branch inference logic that the PowerShell helper currently provides?
5. What is the expected lifespan of Phase 1 (both paths running)? A week? A month? A quarter?
6. Have we validated the 6-tool set with anyone who actually uses AWX through OpenCode daily?

---

**Verdict: Refine.** The problem is real and the architecture is sound, but the v1 scope needs honest bounding, success metrics must be defined, and the contract alignment risk needs a concrete test strategy before migration begins. Without these, we're building a replacement that we can't prove is better than what it replaces.
