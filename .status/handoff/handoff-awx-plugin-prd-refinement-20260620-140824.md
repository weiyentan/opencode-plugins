# Handoff: AWX Plugin PRD Refinement

## Current State

We completed a full **Standard Council review** of the `@opencode-ai/plugin-awx` PRD (stored at `docs/prd/awx-plugin.md`). The council **unanimously refined** the PRD — the direction is correct (Node.js HTTP plugin replacing brittle PowerShell), but **3 critical unknowns** and **5 structural gaps** must be resolved before implementation.

### Council Session

- **Session ID:** `awx-plugin-prd-20260620-135410`
- **Session directory:** `.ai/council/awx-plugin-prd-20260620-135410/`
- **Decision artifact:** `.ai/council/awx-plugin-prd-20260620-135410/decision.yaml`
- **Refinement guidance:** `.ai/council/awx-plugin-prd-20260620-135410/prd-outline.md`
- **Round 1 opinions (4):** `round1/product-owner.md`, `round1/platform-architect.md`, `round1/senior-engineer.md`, `round1/delivery-planner.md`
- **Round 2 responses (4):** `round2/product-owner.md`, `round2/platform-architect.md`, `round2/senior-engineer.md`, `round2/delivery-planner.md`

### Critical Unknowns (Must Resolve Before Tool Code)

1. **Bearer token auth viability** — The existing `awx-windows/SKILL.md` explicitly documents PAT auth returns 401 on this AAP instance. Need a 5-minute `curl` spike against `https://aap.tanscloud-internal.com/api/v2/me/` to verify.
2. **Output contract mismatch** — The PRD's TypeScript types (`host_summary`, `extra_vars_summary`) don't match the actual `awx_job_detail.py` output (`host_status_counts`, `derived`). Need to read the Python source and correct the types.
3. **Plugin API surface undefined** — `@opencode-ai/plugin` TypeScript types and auth hook interface not found in the repository. Need to discover before any implementation starts.

### Key Council Findings to Incorporate into Next PRD

1. **`awx-wait-job`** must be non-blocking (return job ID immediately, agent polls via `awx-job-status`). Plugin runtimes may have < 600s timeouts.
2. **Extra-var transformations** (SSH→HTTPS URL conversion, git branch inference) should live in a `transforms.ts` module within the plugin.
3. **`awx-get-job-events`** should be added to v1 as a simple passthrough (~1h cost, closes debugging gap).
4. **Connection resilience** parameters: 30s timeout, exponential backoff retry (1s/2s/4s, 5xx only), zero retry on 4xx.
5. **Init-time validation**: call `/api/v2/me/` (token check) and `/api/v2/` (version check) on plugin load.
6. **Structured metrics**: per-tool call count, error count, latency, token expiry events for phase-gating.
7. **Phase-gate criteria**: metrics-based triggers for Phase 1→2→3→4 transitions.
8. **Honest scope**: 6 of 22 actions covered (27%, not 90%+). Action-to-tool mapping table needed.

### Existing Artifacts to Reference

- Original PRD: `docs/prd/awx-plugin.md`
- Council refinement guidance: `.ai/council/awx-plugin-prd-20260620-135410/prd-outline.md` (detailed recommendations)
- Concersation context from the original grill-with-docs session covered: scope, auth model, tool surface, output contract, module structure, testing strategy, and rollout plan

## What the Next Session Should Do

### Option A: New grill-with-docs session

Run `/grill-with-docs` to redesign the PRD incorporating all Council findings. Suggested starting scope:
- Redesign auth flow based on the bearer token spike result
- Correct the output contract types
- Reslice the delivery plan into the 7-phase structure (Phase 0 + 1A-1C + 2-4)
- Decide ownership of extra-var transformations
- Design the structured metrics surface

### Option B: Direct PRD update

Run `/to-prd plugin-awx-refined` to update the existing PRD, referencing:
- The Council refinement guidance (`prd-outline.md`)
- The decision.yaml
- The 4 Round 2 opinions for implementation details

## Skills to Use in Next Session

| Skill | Why |
|-------|-----|
| `grill-with-docs` | To run a new design session incorporating Council findings |
| `domain-modeling` | To update domain vocabulary and capture architecture decisions as ADRs |
| `to-prd` | To produce the updated PRD |
| `to-issues` | To break the refined PRD into implementation issues once ready |

## Next Conversation Prompt

> This handoff is from a Council session that reviewed the `@opencode-ai/plugin-awx` PRD. The council refined the PRD with specific guidance in `.ai/council/awx-plugin-prd-20260620-135410/prd-outline.md` and `decision.yaml`. The critical first action is to **run a bearer token auth spike** against the target AAP instance. The user may want to start a new `/grill-with-docs` session to redesign the auth model and output contract based on the Council's findings.
