# Council Brief: AWX Plugin Refined PRD Handoff Review

## Idea Statement

Review and validate the handoff from the completed grill-with-docs session (`handoff-awx-plugin-refined-prd-20260620-150456.md`) to confirm it is ready for the next step: breaking the refined PRD into vertical-slice implementation issues via `/to-issues plugin-awx`.

## Context

A prior Council session (referenced as `.ai/council/awx-plugin-prd-20260620-135410/`) reviewed the original AWX plugin PRD and raised 3 critical unknowns:

1. **Bearer token viability** — was the AAP instance reachable with a PAT?
2. **Output contract alignment** — did the TypeScript types match the actual AWX API output?
3. **Plugin API surface** — were the `@opencode-ai/plugin` types fully understood?

These unknowns have been **resolved** in a subsequent grill-with-docs session:

- **Bearer token:** Curl spike confirmed 200 OK against `example.com`.
- **Output contract:** TypeScript types corrected to match `awx_job_detail.py` v1.0, verified against 3 fixtures.
- **Plugin API:** `@opencode-ai/plugin` v1.14.29 types discovered and documented (tool, auth hook, abort signal).

Additionally, **7 structural changes** were confirmed and documented in 6 Architecture Decision Records (ADRs) under `docs/adr/`:

1. Non-blocking `awx-wait-job` pattern (agent-side polling)
2. Plugin-internal `transforms.ts` for extra-var transformations
3. Connection resilience (timeout, backoff, circuit breaker)
4. Init-time validation (`GET /api/v2/me/` + `GET /api/v2/`)
5. Structured metrics (call count, error count, latency, token expiry)
6. Phase-gate criteria (metrics-based 0→1A→1B→1C→2→3→4)
7. Honest scope (7 of 22 actions, documented mapping table)

The handoff recommends a 14-issue breakdown, starting with Phase 0 scaffolding and contract types, through to integration tests.

## Known Assumptions

1. The AAP instance at `example.com` remains accessible with the same API surface during implementation.
2. The `@opencode-ai/plugin` v1.14.29 API is stable and will not change during development.
3. The 6 ADRs capture all critical architecture decisions and no new decisions will surface during implementation.
4. The 7-of-22 action scope (30%) is correctly bounded and documented.
5. The suggested issue breakdown is complete and correctly ordered by dependency.
6. The bearer token (PAT) model is sufficient for MVP and no OAuth2/JWT will be needed.

## Open Questions

1. **Is the handoff complete enough to proceed directly to `/to-issues`?** Are there gaps or assumptions that need further validation before implementation planning begins?
2. **Are the suggested issues correctly scoped?** The handoff proposes 14 issues — are any missing, redundant, or mis-ordered?
3. **Is the honest-scope admission (7/22 actions) acceptable for v1?** Does it still deliver meaningful user value, or should scope be expanded/reduced?
4. **Are the ADRs sufficient?** Do the 6 ADRs cover all architectural decisions needed for implementation, or are there remaining open questions?
5. **What is the risk level?** Given the unknowns are resolved and the architecture is documented, what is the residual implementation risk?
6. **Is the contract.test.ts-first sequencing correct?** The handoff prioritizes the contract compatibility test before any tool code — is this the right approach?

## What Success Looks Like

Success is a clear signal (proceed / refine / reject) on whether to move forward with `/to-issues plugin-awx`. The Council should determine whether the handoff is complete, the architecture is sound, and the implementation plan is feasible.

If proceeding: the team can confidently run `/to-issues plugin-awx` next session.

If refinement is needed: specific gaps, missing information, or remaining risks should be flagged with actionable guidance.
