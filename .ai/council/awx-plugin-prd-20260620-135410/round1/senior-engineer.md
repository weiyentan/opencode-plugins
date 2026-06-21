---
verdict: refine
confidence: 0.65
round2-requested: yes
---

# Council Opinion: Senior Engineer

## Summary

The plugin is the right direction — replacing brittle PowerShell with a Node.js HTTP client is overdue — but the PRD has two critical blockers (contract mismatch and bearer-token viability) plus several implementation hazards (polling in a plugin runtime, missing extra-vars transformations, undefined plugin API surface) that make it risky to proceed without addressing them.

## Assessment

I read the PRD and then went spelunking in the actual codebase. What I found changes the feasibility picture significantly. Let me walk through each concern.

### 1. The Output Contract Is Wrong — This Will Break Existing Renderers

The PRD's TypeScript type (lines 46–54) declares `host_summary` and `extra_vars_summary`. But the actual `awx_job_detail.py` v1.0 contract (lines 276–284 of that file) produces:

```typescript
{
  schema_version: "1.0",
  job: { ... },
  related: { ... },
  host_status_counts: { ok, failed, changed, unreachable, skipped },
  derived: { is_successful, is_failed, has_unreachable_hosts },
  warnings: string[],
  errors: string[],
  stdout?: string,       // only with --include-stdout
  raw_events?: any[]     // only with --include-events
}
```

There is no `extra_vars_summary` field. There is no `host_summary` field. The `derived` object with boolean flags exists but is not mentioned in the PRD. If the plugin emits `extra_vars_summary`, the existing skill renderers (which expect `host_status_counts` and `derived`) will silently produce broken output. This isn't a minor naming tweak — the entire render pipeline depends on these fields being correct.

**Impact**: Every tool that returns job status (launch-job, job-status, wait-job) will produce output that doesn't match what skills expect. This would cause silent data corruption in reports, not just an error.

**Fix needed**: The `contracts/job-detail.ts` must match the actual Python contract exactly. The PRD table is wrong and must be corrected before any code is written.

### 2. Bearer Token May Not Work — The Existing Skill Says It Doesn't

The `awx-windows` SKILL.md states explicitly (under "Key Findings"): **"PAT Authentication Does NOT Work"** — AAP PAT tokens return 401 for both `awx` CLI calls and Bearer header auth. The current working authentication is OAuth2 token obtained via login flow, or Basic Auth through the PowerShell module which internally creates tokens via `/api/v2/users/{username}/personal_tokens/`.

The PRD assumes `type: "api-key"` auth hook works out of the box. But if AAP rejects Bearer tokens from PATs, the plugin will authenticate successfully during setup and then fail on every tool call with 401. This is a showstopper.

**Risk**: The entire auth model may be invalid. We need a spike to verify that the AAP instance accepts Bearer tokens from a PAT generated at `/api/v2/tokens/` before committing to this design.

**Mitigation**: Either (a) confirm Bearer token works on the target AAP, or (b) implement a login flow that exchanges username+password for an OAuth2 token at plugin init time, or (c) support both mechanisms with auto-detection.

### 3. Polling in a Plugin Runtime — `awx-wait-job` Is Dangerous

The PRD proposes polling for up to 600 seconds (10 minutes) in `awx-wait-job`. In an OpenCode server plugin, each tool execution happens in a plugin runtime context. If the runtime has a timeout shorter than 600 seconds (many do — 30s, 60s, 300s are common), the tool will be killed mid-poll. The agent will see a timeout error, not the final job status.

**Even if the runtime allows long execution**, holding a plugin process open for 10 minutes consuming a slot is bad resource hygiene. The agent's context window would also be blocked while the poll runs.

**Recommendation**: Make `awx-wait-job` return immediately with the job ID and a "poll later" instruction. Give the agent a pattern like:
1. Launch job → get job ID
2. Agent continues working
3. Call `awx-job-status` later
4. Loop until done

This eliminates the long-poll problem entirely and is more agent-friendly.

### 4. Missing Extra-Vars Transformations

The existing PowerShell script (`awx-helper.ps1`) does important work before launching a job:
- **SSH→HTTPS URL conversion** for `target_repo_url` (line 202-204)
- **Git branch inference** when `target_branch` is missing (line 207-215)
- **Required-var validation** against a configurable list (line 216-229)

The PRD says "optional extra vars" but these transformations are business logic, not optional. If the plugin replaces the PowerShell script and doesn't replicate these transformations, agents will get silent failures (jobs launching with SSH URLs that AAP's execution nodes can't resolve, or missing branches).

**This logic needs to live somewhere.** Either in the plugin itself, or we must accept that it's the skill's responsibility to pre-process vars before calling the plugin. The PRD doesn't address this.

### 5. Surface Gap: The Six Tools Don't Cover the Full PowerShell Surface

The existing helper has 18 actions. The plugin offers 6. The PRD claims "90%+ coverage" but I'm skeptical. Missing operations that are actively used:
- `get-job-events` — used for debugging failed jobs (the SKILL references it)
- `get-job-stdout` — used for troubleshooting
- CRUD operations (add-template, update-project) — less frequent but used

If the skills are updated to prefer the plugin (Phase 2), but still need to call PowerShell for the missing operations, the Phase 3 deprecation becomes awkward — you can't deprecate scripts that are still needed.

### 6. Missing Plugin API Surface Definition

The PRD references `@opencode-ai/plugin` as a peer dependency with an `auth` hook of type `api-key`, but I found no existing TypeScript types or documentation for this API in the codebase. The plugin developer will need:
- The OpenCode plugin TypeScript interface definitions
- Documentation on how tool registration works
- The auth hook contract (what does `type: "api-key"` expect?)

Without these, the implementation can't even start. This is a dependency risk.

## Implementation Feasibility

### What's straightforward
- `client.ts` — a thin `fetch` wrapper is ~50 lines, simple
- `awx-list-templates` and `awx-list-projects` — basic GET + pagination consolidation, each ~30 lines
- `awx-job-status` — single GET + transform to contract, ~40 lines
- `awx-sync-project` — name-resolve + POST, ~35 lines

### What's tricky
- **`awx-launch-job`** — name resolution (name may not be unique), extra vars serialization, error handling for invalid extra vars. Plus the missing transformations (SSH→HTTPS, branch inference). Estimated 80-100 lines instead of 40.
- **`awx-wait-job`** — the polling/timeout problem described above. Needs careful design.
- **Contract transformation** — properly mapping AWX API response to the v1.0 contract with graceful degradation (missing `summary_fields`, missing `host_status_counts`). This needs defensive code for ~10 edge cases.
- **Auth hook** — unknown API surface; could be trivial or require unexpected ceremony.

### Effort estimates

| Component | Optimistic | Realistic | Pessimistic |
|-----------|-----------|-----------|-------------|
| Project scaffold, tsconfig, package.json | 1h | 2h | 4h |
| Auth hook (`auth.ts`) | 1h | 3h | 6h* |
| Client module (`client.ts`) | 1h | 1.5h | 3h |
| Contract types (`job-detail.ts`) | 1h | 2h | 4h |
| Tool: launch-job | 2h | 4h | 8h |
| Tool: job-status | 1h | 2h | 3h |
| Tool: list-templates | 1h | 1.5h | 2h |
| Tool: list-projects | 1h | 1h | 2h |
| Tool: sync-project | 1h | 1.5h | 3h |
| Tool: wait-job | 3h | 6h | 12h** |
| Plugin entry (`index.ts`) | 1h | 1h | 2h |
| Fixture/unit tests (mocked fetch) | 3h | 5h | 8h |
| Contract tests (fixture validation) | 2h | 3h | 5h |
| Integration tests (live AAP) | 4h | 6h | 10h |
| Skill updates (Phase 2) | 4h | 8h | 16h |
| **Total** | **27h** | **47.5h** | **88h** |

\* *Auth hook estimate depends heavily on undocumented OpenCode plugin API*
\** *Wait-job depends on plugin runtime timeout behavior — could be much more complex*

### Edge cases
1. **Job template name collision** — AWX allows duplicate names? Rare but possible. Name resolution picks the first match.
2. **Unicode in project/template names** — Name-based search with `?name=<name>` may need URL encoding.
3. **Pagination beyond default page size** — AAP defaults to 200 items per page. If someone has 500 templates, we need to follow `next` links.
4. **Extra vars as JSON string vs object** — AWX API accepts both but behaviors differ.
5. **Job not found during `awx-wait-job`** — Job could be deleted mid-run (race condition).
6. **Network partition mid-poll** — `awx-wait-job` loses connection; does it retry or fail?
7. **Token expires during `awx-wait-job`** — 401 on poll N after token expiry. No retry mechanism.
8. **Job status transition from pending → running → failed** during a single name-resolution call — the tool resolves name, then launches, but between the two calls the template could be deleted or disabled.
9. **Large result sets in list operations** — 1000+ templates could produce a very large response. Need a `max_results` cap.

### Test impact
- **Existing fixtures work well** — `awx_job_success.json`, `awx_job_failure.json` are solid. No changes needed.
- **Missing fixture**: Need a "partial" fixture (missing `summary_fields`, missing `host_status_counts`) for graceful-degradation tests.
- **Integration tests** need careful resource isolation — launching real jobs against AAP costs real resources.
- **Contract tests** must be rewritten — the current contract tests test the Python script. We need TypeScript-side contract tests with the same fixtures.

### Dependencies
- **`@opencode-ai/plugin` TypeScript types** — must exist and be published. Unknown API surface.
- **Node.js 18+** — native `fetch` is available. Verified okay.
- **AAP version** — PRD says AAP 2.3+ (AWX 21.0.0+). Need to verify target instance version.
- **Existing fixtures** — already exist at `C:\ai\opencode\tests\fixtures\awx_job_*.json`. No changes needed.

### What would the Delivery Planner say is the risk in your delivery plan?

The Delivery Planner would flag **Phase 2 as the hidden risk**. The 4-phase rollout assumes that skill updates are a simple find-and-replace: swap `powershell -File awx-helper.ps1 -Action X` for tool calls. But:

1. **Skills don't call a uniform API** — some skills invoke the helper script, others call `awx` CLI directly, others use the Python helper. Each has different integration patterns.
2. **The skill update window is unbounded** — until every skill is updated, both the old script and the new plugin must work. That's parallel maintenance.
3. **Agent prompts that produce PowerShell invocations** — the agent may still choose to generate PowerShell code even when the plugin is available. The skill update doesn't control the agent's code-generation behavior.
4. **Phase 3 deprecation warnings on scripts** will cause failures if any workflow chain still depends on script output (e.g., piping script stdout into another tool).

The safe approach is: Phase 2 should add the plugin as a *sidecar* that skills prefer, but Phase 3 (deprecation) should not begin until we've verified in production that no agent workflow is hitting the old scripts. That requires monitoring, which isn't in the plan.

## Key Concerns

1. **Contract mismatch** — PRD TypeScript type doesn't match the actual `awx_job_detail.py` v1.0 output. This will break existing renderers and cause silent data corruption.
2. **Bearer token authentication may not work** — existing documentation explicitly states PAT authentication fails. The auth model needs verification before implementation.
3. **Polling in plugin runtime** — `awx-wait-job` with 10-minute timeout is incompatible with typical plugin execution constraints.
4. **Missing extra-var transformations** — SSH→HTTPS conversion, branch inference, and required-var validation are absent from the plugin design.
5. **Undefined plugin API** — `@opencode-ai/plugin` types and auth hook contract are not available in the repository, making implementation impossible to start.

## Recommendations

1. **Fix the contract definition** before writing code. Align the PRD TypeScript types with the actual Python v1.0 contract (`host_status_counts`, `derived`, etc.). Get the renderers working.
2. **Spike the auth model** — Generate a PAT from the target AAP, try it with `curl -H "Authorization: Bearer <token>" /api/v2/me/`. If it fails, design an OAuth2 token-exchange flow instead.
3. **Remove or redesign `awx-wait-job`** — Return the job ID immediately and document a poll-loop pattern using `awx-job-status`. Don't hold the plugin process hostage.
4. **Add extra-var transformation** to the launch-job tool, or explicitly document that skills must pre-process vars before calling the plugin.
5. **Add `awx-get-job-events` and `awx-get-job-stdout`** to the v1 scope — they're needed for the debugging workflows that skills currently rely on.

## Questions That Need Answers

1. Has anyone verified that `Authorization: Bearer <PAT>` works against `https://example.com/api/v2/me/`? If not, can we do this as a spike before Round 2?
2. What is the OpenCode plugin execution timeout? Is it documented? Can it be configured per-tool or per-plugin?
3. Where are the `@opencode-ai/plugin` TypeScript types? Are they published to npm? What's the auth hook interface signature?
4. Can we review the skill renderers that consume the v1.0 contract to confirm which fields they actually use? This determines whether the contract mismatch is cosmetic or destructive.
5. Should the extra-var transformations (SSH→HTTPS, branch inference) live in the plugin, or should they remain in skills as a pre-processing layer? My vote is plugin — otherwise every skill duplicates the logic.

**Strongest counterargument**: The Platform Architect might argue that the contract mismatch is a quick fix — just update the PRD types to match the Python output. They're right that the *fix* is easy, but my deeper concern is that this mismatch indicates the PRD was written without consulting the actual codebase. If the contract type table is wrong, what else is wrong? The bearer-token assumption, the polling design, the missing tool surface — these are all symptoms of the same root problem: the design was done from first principles rather than from the existing implementation. A single spike to verify auth + read the actual contract file would have caught these issues and should be a prerequisite for implementation.

---

**Verdict**: The plugin is a worthwhile replacement for the PowerShell stack, but I cannot sign off on feasibility until the contract is corrected, bearer-token auth is verified, and the polling design is rethought. **Refine and re-submit with a week-long spike phase to resolve these unknowns.**
