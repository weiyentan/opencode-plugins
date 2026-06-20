---
verdict: refine
confidence: 0.75
round2-requested: yes
---

# Council Opinion: Platform Architect

## Summary

The plugin architecture is directionally correct — replacing a Windows-locked, PowerShell-dependent credential-on-disk stack with a portable Node.js HTTP client is long overdue — but the design has critical gaps in credential lifecycle management, connection resilience, and deployment strategy that must be resolved before Phase 1 ships.

## System Architecture

### System Boundaries and Coupling

**Where this fits:** The plugin lives entirely in the OpenCode server process as a sidecar plugin. It translates six tool invocations into outbound HTTPS calls to AAP's REST API (`/api/v2/`). There are no reverse dependencies — AAP doesn't know the plugin exists. The plugin consumes OpenCode's `auth` hook for secret management and its tool-registration interface for command surface.

**Boundary clarity: Good.** The boundary between OpenCode and AWX is a standard HTTP interface. The plugin is a thin adapter layer — no leaky abstractions, no shared state across sessions, no filesystem coupling. This is a clean separation.

**Cross-boundary concerns:**
- **Auth hook dependency:** The plugin's security posture is entirely inherited from OpenCode's `auth` hook. If the auth hook doesn't support token refresh (upstream tokens do expire), the plugin has no recovery path. This is a vertical coupling that must be stress-tested.
- **Output contract coupling:** Returning the `awx_job_detail.py` v1.0 schema creates a forward-compatibility risk. Any schema change on the AAP side (new fields, renamed keys) requires a coordinated update. The schema version field mitigates this, but only if consumers actually check it.
- **No multi-instance support (by design):** Limiting to one AAP instance per session is the right boundary decision for v1. Multi-instance support would fundamentally change the auth model and session state management.

### Deployment Strategy

**Phase 1–4 rollout is well-structured** — the coexistence period (Phases 1–2) is essential. Key deployment observations:

1. **Zero-dependency deploy:** The plugin is a `npm` workspace package. No system packages, no PowerShell modules, no Python venvs. This is a significant operational improvement over the current stack.

2. **Plugin lifecycle:** OpenCode plugins are hot-loaded. The deployment strategy should confirm that plugin updates don't require a server restart. If they do, the Phase 1→2 transition will be disruptive.

3. **No AAP-side deployment:** This is correct — the plugin adapts to the existing API. But the PRD doesn't address what happens when AAP API versions drift. A minimum-version policy (AAP 2.3+/AWX 21.0.0+) is stated but no version detection or graceful degradation path is defined.

4. **Configuration distribution:** `baseUrl` is in `opencode.jsonc` per-user. This is fine for a single team but doesn't scale to org-wide configuration (e.g., different environments). Consider supporting an environment variable or workspace-level override for enterprise deployments.

### Ops Requirements

**New operational burden:** Minimal, but non-zero:

| Area | Burden | Severity |
|------|--------|----------|
| Token issuance | User must create AAP token manually (one-time) | Low |
| Token expiry | User must re-create expired token (recurring) | Medium |
| AAP unreachability | Agent tool calls fail with structured error | Low |
| Debug logging | Gated behind flag, no structured log aggregation | Medium |
| Network config | User must ensure AAP is reachable from OpenCode host | Low |

**Monitoring:** The PRD mentions request/response logging behind a debug flag. This is insufficient for operational use. I need to see:

- **Structured error counters** (per HTTP status code category, per tool)
- **Latency histograms** for AAP API calls (p50, p95, p99)
- **Token expiry detection** with an alert path (not just a silent 401)
- **Polling efficiency metrics** for `awx-wait-job` — how many polls per job, average time-to-completion

Without these, diagnosing "AWX tools are slow" will require replicating the user's session — a worst-case debugging scenario.

### Blast Radius Analysis

| Failure Mode | Effect | Severity | Mitigation |
|---|---|---|---|
| Plugin crash | 1 tool call fails; OpenCode server unaffected | Low | Plugin isolation in OpenCode sidecar |
| Token leak | Attacker can call AAP API with token's permissions | Medium | Token held in memory only; session-scoped |
| Token expiry | Tools return 401 mid-session; agent must prompt user | Medium | OAuth2 refresh support needed |
| AAP unreachable | All AWX tools fail with timeout/connection error | Medium | Configurable timeout, meaningful error message |
| Infinite poll (wait-job) | Tool never completes; agent thread blocked | Critical | Hard timeout (PRD has 600s default — good) |
| Concurrent polls | Multiple agents polling AAP simultaneously | Low | AAP handles its own concurrency |
| Schema mismatch | Tools return unrecognised fields; agent misinterprets | Low | Schema version field enables graceful detection |

### Security Checklist Review

1. **Credential lifecycle management:**
   - **Creation:** User generates AAP token in AAP UI, configures via `opencode.jsonc` auth hook.
   - **Rotation:** Not addressed. Bearer tokens can have configurable TTLs; the plugin has no refresh mechanism. **Medium risk.**
   - **Revocation:** User revokes token in AAP UI. Plugin has no way to detect revocation proactively. It discovers on next API call (401).
   - **Blast radius:** Token leaked → AAP API access with token-owner privileges for the token's lifetime. Token scoped to AAP, not infrastructure-wide. Acceptable for v1 **if** tokens are short-lived (hours, not months).

2. **Network accessibility:**
   - Plugin makes **outbound HTTPS only** — no inbound ports, no reverse proxy needed.
   - Network path depends on where the OpenCode process runs (user workstation, CI runner, server). The `baseUrl` config makes this flexible.
   - **No public exposure concern** — AAP remains behind its existing network boundary.

3. **Multi-tenancy isolation:**
   - Plugin serves one OpenCode session per process. No cross-tenant state sharing. Clean.
   - If OpenCode itself supports multi-session, that's OpenCode's isolation problem, not the plugin's. The boundary is respected.

4. **Connection resilience:**
   - **Critically unaddressed.** The PRD does not specify:
     - Connection timeout (fetch defaults can be very long — Node.js has no default timeout for `fetch`)
     - Retry policy (should be exponential backoff for transient errors, no retry for 401/403/404)
     - Circuit breaker (if AAP is down, every tool call should fail fast, not hang)
   - **This must be specified before Phase 1.** A missing timeout on `awx-wait-job` could hang an agent session indefinitely beyond the 600s hard limit.

5. **Monitoring and alerting:**
   - No metrics, no structured logging, no error budgets defined.
   - The debug flag is ad-hoc. For an operational tool, I need counters exported.
   - Minimum viable: per-tool success/failure counters, latency tracking, token-expiry events.

6. **Maintenance window impact:**
   - Plugin updates: Can roll out via npm workspace update. No AAP downtime needed. No OpenCode server restart if hot-reload is supported.
   - AAP maintenance: Plugin must handle 502/503/504 gracefully (currently not specified).
   - Backward compatibility: The v1.0 contract is a promise. Any breaking change requires a schema version bump, which must be checked by consumers.

## Key Concerns

1. **No OAuth2 token refresh strategy.** Bearer tokens have finite TTL. When they expire mid-session, the agent either fails or must prompt the user to re-authenticate. This is a worse user experience than the current credential-XML approach it's replacing. The PRD assumes tokens are long-lived or refreshed out-of-band — that's not how enterprise AAP deployments work.

2. **Connection resilience is unspecified.** Node.js `fetch` has no default timeout. If AAP becomes unreachable, the default behaviour is to wait indefinitely. No retry policy, no circuit breaker, no exponential backoff. For a tool that agents call autonomously, this is unacceptable.

3. **Debug logging is insufficient for operations.** A `debug` boolean flag is not a substitute for structured metrics. When an enterprise team runs multiple agents against AAP, they need dashboards, not `console.log` output from a remote session.

4. **The `awx-wait-job` polling strategy is naive.** Fixed 10-second polling intervals don't scale. AAP has API rate limits (configurable but real). If an EDA rulebook fires 20 concurrent job launches, the resulting 20 simultaneous poll loops could trigger AAP rate limiting. Add exponential backoff or jitter.

5. **No graceful degradation for AAP API version drift.** The PRD states AAP 2.3+ as minimum but doesn't describe what happens if an API endpoint structure changes in a minor AAP upgrade. A capability detection or version-check on plugin init would prevent mysterious failures.

## Recommendations

1. **Replace bearer-token-only auth with a two-tier strategy:**
   - Primary: Bearer token (as specified) for short sessions.
   - Fallback: OAuth2 token refresh via AAP's `/api/v2/tokens/` refresh endpoint, with a stored refresh token. The plugin should attempt a single refresh before surfacing 401 to the agent.

2. **Specify connection resilience parameters in the PRD:**
   - `fetch` timeout: 30s per request (default).
   - Retry: Exponential backoff (1s, 2s, 4s) for 429/5xx, capped at 3 retries. Zero retries for 401/403/404.
   - Polling jitter: Add ±20% random jitter to `awx-wait-job` intervals to avoid thundering herd.

3. **Add a health-check tool or init-time validation:**
   - On plugin load, call `/api/v2/me/` to validate the token and `/api/v2/` to detect API version. Fail early with a clear message if either check fails.

4. **Define a minimum structured metrics surface:**
   - Export per-tool call count, error count, and latency via the OpenCode plugin metrics interface (or a simple callback). This is essential for Phase 3 (deprecation monitoring) to know whether any PowerShell scripts are still being used.

5. **Add a `version` capability check:**
   - On startup, check `/api/v2/` for the AWX version and cache it. If the version is below the minimum, refuse to initialise with a clear error message.

## Questions That Need Answers

1. **What is the typical TTL of AAP bearer tokens in the target deployment?** If tokens last 30 days, the refresh concern is manageable. If they last 1 hour, the v1 auth model is broken.

2. **Does the OpenCode plugin auth hook support token refresh/rotation, or is it strictly one-shot?** This determines whether we need to build refresh logic into the plugin itself or extend the hook.

3. **What rate limits does the target AAP instance enforce?** Without this, we can't design safe polling defaults.

4. **Does the OpenCode server support hot-reloading of plugins without restart?** This affects whether Phase 2 updates cause session disruption.

5. **Who is responsible for creating the bearer token today?** If it's already part of the AAP onboarding workflow, the auth model may be sufficient. If it's an extra step, it's a new friction point.

## Counterargument Reflection

**What the Cost Reviewer would say is the expensive assumption:** The assumption that "Node.js 18+ native `fetch` with no third-party dependencies is sufficient for a production API client" is the expensive one. Native `fetch` has no built-in retry, no timeout (before Node 21), no connection pooling, and no circuit breaker. Building these correctly is non-trivial. The perceived "zero-dependency" cost saving will be consumed by custom resilience code that will need maintenance, testing, and debugging — code that battle-tested libraries like `undici` or `got` already provide. The PRD should either accept a minimal dependency or cost the custom implementation effort explicitly.

---

**Verdict: The architecture is sound in direction but under-specified in resilience, auth lifecycle, and operations. Proceed with Phase 1 only after the bearer-token refresh path and connection resilience parameters are defined.**
