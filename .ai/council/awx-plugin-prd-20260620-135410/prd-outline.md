# PRD Refinement Guidance

This document captures the Council's required changes before this PRD is ready for implementation. The Council unanimously agreed the direction is correct, and the **3 critical unknowns have been resolved** in a grill-with-docs session on 2026-06-20. ADRs documenting each resolution are in `docs/adr/`.

---

## Phase 0: Spikes ✅ All Resolved (2026-06-20)

All three critical unknowns have been resolved in a grill-with-docs session. See ADRs in `docs/adr/` for details.

### 1. Auth Viability Spike ✅ RESOLVED

**Result:** Bearer token auth **works** on the target AAP instance (`curl` returned 200 OK with user data for `svc_cicd`). Proceeding with bearer token design. MVP uses PAT; OAuth2 refresh deferred to v2.

**ADR:** `docs/adr/0001-bearer-token-auth-model.md`

### 2. Contract Alignment Spike ✅ RESOLVED

**Result:** Corrected TypeScript types to match actual `awx_job_detail.py` v1.0 output. Verified against all 3 fixtures (success, partial, failure).

**Key corrections:**
- `host_summary` → `host_status_counts`
- `extra_vars_summary` → `derived` object (boolean flags)
- `related` fields are resolved names, not URLs
- `schema_version: "1.0"` (two-part)

**ADR:** `docs/adr/0002-output-contract-alignment.md`

### 3. Plugin API Discovery ✅ RESOLVED

**Result:** `@opencode-ai/plugin` v1.14.29 types found at `C:\ai\opencode\node_modules\@opencode-ai\plugin`. Key interfaces:
- **Tool registration:** `tool({ description, args: zodSchema, execute })` from `@opencode-ai/plugin/tool`
- **Auth hook:** `type: "api"` with `authorize()` returning `{ type: "success", key }`
- **Plugin entry:** `server: (ctx: PluginInput) => Promise<Hooks>` with `tool`, `auth`, `event` hooks
- **ToolContext** includes `abort: AbortSignal` for runtime-level cancellation

**ADR:** `docs/adr/0003-plugin-api-surface-discovery.md`

---

## Structural Changes — All Resolved (2026-06-20)

All structural changes have been confirmed in the grill-with-docs session. See ADRs in `docs/adr/` for detailed reasoning.

| # | Change | Status | ADR |
|---|--------|--------|-----|
| 4 | Correct "90%+ coverage" claim to 27%; add tool-action mapping table | ✅ Confirmed | — |
| 5 | `awx-wait-job` non-blocking — returns job ID immediately, agent-side poll loop | ✅ Confirmed | `0004-non-blocking-awx-wait-job` |
| 6 | Connection resilience: 30s timeout, exponential backoff (5xx only), zero retry on 4xx, circuit breaker | ✅ Confirmed | `0006-connection-resilience-parameters` |
| 7 | Extra-var transformations in plugin `transforms.ts` (shared helper module); required-var validation stays in skill layer | ✅ Confirmed | `0005-extra-var-transformations-in-plugin` |
| 8 | Phase-gate criteria: metrics-based triggers for 0→1A→1B→1C→2→3→4 transitions | ✅ Confirmed | — |
| 9 | Structured metrics: per-tool call count, error count, latency, token expiry, PowerShell fallback | ✅ Confirmed | — |
| 10 | Init-time validation: `GET /api/v2/me/` (token) + `GET /api/v2/` (AAP version) on plugin load | ✅ Confirmed | — |

---

## v1 Scope Decision (Recommendation from Council)

| Tool | Include in v1? | Note |
|------|---------------|------|
| `awx-list-templates` | ✅ Yes | Read-only, lowest risk, proofs auth |
| `awx-list-projects` | ✅ Yes | Read-only, lowest risk |
| `awx-launch-job` | ✅ Yes | With `transforms.ts` for URL conversion + branch inference |
| `awx-job-status` | ✅ Yes | Contract transformation |
| `awx-wait-job` | ✅ Yes | Non-blocking (returns job ID immediately) |
| `awx-sync-project` | ✅ Yes | Lowest priority tool |
| `awx-get-job-events` | ✅ Yes | Simple passthrough, ~1h cost, closes debugging gap |

---

## Remaining Unknowns to Document in the PRD

1. **Plugin hot-reload** — determines whether Phase 1→2 transitions are disruptive. Must be confirmed before Phase 2.
2. **AAP rate limits** — determines safe polling defaults. Document target instance configuration.
3. **Skill renderer field usage** — grep the skill repository for `host_status_counts`, `derived`, `schema_version` to know which fields are critical vs. unused.

## Resolved Unknowns

| Unknown | Resolution |
|---------|-----------|
| Plugin runtime timeout | No longer relevant — `awx-wait-job` is non-blocking; no long-running plugin operations |
| Bearer token TTL | Measure during implementation; OAuth2 refresh deferred to v2 if needed |
| Bearer token viability | ✅ Confirmed working (200 OK on spike) |
| Contract alignment | ✅ Verified against all 3 fixtures |
| Plugin API surface | ✅ Types discovered at `@opencode-ai/plugin` v1.14.29 |

---

## Resliced Phase Plan

| Phase | Content | Estimated effort |
|-------|---------|-----------------|
| Phase 0 | Spikes & alignment (auth, contract, plugin API, mapping table) | 6-10 hours |
| Phase 1A | Read-only tools (list-templates, list-projects) | 3-5 hours |
| Phase 1B | Job tools (launch, status, wait, get-events) | 3-5 hours |
| Phase 1C | Sync tool + integration + metrics | 3-5 hours |
| Phase 2 | Per-skill updates (3 skills) | 6-14 hours |
| Phase 3 | Deprecation with monitoring gate | 1-2 hours |
| Phase 4 | Retirement | 0.5 hours |
| **Total** | | **~23-42 hours** |
