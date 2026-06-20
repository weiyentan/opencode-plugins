# Client Middleware Pipeline Design

**Status:** Implemented (issue #5) — see `packages/awx/src/client.ts`  
**Date:** 2026-06-20  
**Issue:** [#4](https://github.com/weiyentan/opencode-plugins/issues/4), [#5](https://github.com/weiyentan/opencode-plugins/issues/5)

## Overview

The `client.ts` HTTP client composes five middleware concerns into a single pipeline. This document specifies the composition order, edge case handling, and parameter defaults.

## Pipeline Composition

```
ToolContext.abort signal
  │
  ▼
createTimeoutSignal(30000)
  │
  ▼
Circuit breaker gate
  │  ├── OPEN? ──→ return immediately with "circuit breaker open" error (no timeout)
  │  └── CLOSED/HALF-OPEN? ──→ proceed to fetch
  │
  ▼
fetch(AAP_URL, { signal, headers })
  │
  ├── 4xx (401/403/404) ──→ pass through immediately, no retry, update breaker (failure)
  ├── 5xx ──→ exponential backoff & retry (up to 3 attempts), update breaker on failure
  └── 2xx ──→ return response, reset breaker failure count
```

## Circuit Breaker

### States

| State | Behavior |
|-------|----------|
| **CLOSED** | Normal operation. Requests flow through. Failure counter increments on 5xx/4xx/network errors. |
| **OPEN** | Requests are rejected immediately without calling `fetch`. Returns error: "AWX circuit breaker is open — AAP may be unreachable. Try again in 30s." |
| **HALF-OPEN** | After cooldown, one probe request is allowed. Success → CLOSED. Failure → OPEN again. |

### Parameters

| Parameter | Default | Notes |
|-----------|---------|-------|
| Trip threshold | 5 consecutive errors | Errors include 5xx, network failures, timeouts. 4xx counts too (but these should be rare). Counter resets on success — no sliding time window. |
| Cooldown duration | 30s (30,000ms) | Time before transitioning from OPEN → HALF-OPEN |
| Half-open probe count | 1 success to close, 1 failure to re-open | Single probe is sufficient |

### Granularity

**Per-tool circuit breakers.** Each tool has its own breaker instance. This means:
- A `sync-project` failure storm does not block `list-templates`
- Breaker state is tracked per tool name using a `Map<string, BreakerState>`
- Read tools (list-templates, list-projects) remain operational even if job tools are experiencing issues

```typescript
interface BreakerState {
  state: "closed" | "open" | "half-open";
  failureCount: number;
  cooldownUntil: number | null;     // Date.now() timestamp when half-open is permitted
}
```

### Edge Cases

- **Open breaker → immediate return:** When OPEN, return instantly without applying the 30s timeout. Fail-fast is the purpose.
- **Abort during backoff:** The backoff timer uses `AbortSignal.any([timeoutSignal, abortSignal])` so an abort during a retry wait cancels immediately — it does not wait for the backoff delay to elapse.
- **Retry counter:** Per-request. Each tool call starts with 3 fresh retry attempts. A successful call resets the counter. This prevents one failing request from degrading subsequent unrelated requests.

## Retry Policy

| Parameter | Value |
|-----------|-------|
| Retry condition | 5xx only (Server Error) |
| Max retries | 3 |
| Backoff strategy | Exponential: 1s, 2s, 4s |
| Jitter | 0–50% additive jitter applied to each delay (`Math.random() * base * 0.5`) |
| Retry counter scope | Per-request (resets on each new tool call) |
| Abort during retry | Cancel immediately via `AbortSignal.any()` |
| 4xx behavior | Zero retries — pass through immediately |

## Timeout

| Parameter | Value |
|-----------|-------|
| Default timeout | 30s |
| Health-check timeout | 10s (used during init-time `GET /api/v2/me/`) |
| Mechanism | `createTimeoutSignal(ms)` (Node 18-compatible `setTimeout` + `AbortController`) combined with `ToolContext.abort` via `anyAbortSignal()` |

## Error Handling

The `client.ts` `request()` method returns a raw `Response` object to the caller.
Callers (tools) are responsible for normalizing errors as needed.

When the circuit breaker is open, a synthetic 503 `Response` is returned with a
JSON body containing `code: "CIRCUIT_OPEN"` and a human-readable message.

For network errors and timeouts, the native `fetch` error (`TypeError` or
`DOMException` `"AbortError"`) is thrown directly — the caller must catch it.

## Implementation Notes

- No third-party HTTP dependencies — uses Node.js 18+ native `fetch`, `AbortSignal`, `AbortController`
- Node 18 compatibility is handled transparently: `createTimeoutSignal()` replaces `AbortSignal.timeout()`, and `anyAbortSignal()` provides a manual fallback when `AbortSignal.any()` is unavailable
- Per-tool breaker state stored in a simple in-memory `Map<string, CircuitBreaker>` — does not persist across plugin restarts
- Metrics counters (`metrics.ts`) are wired into the `client.ts` pipeline: every call records success/error counts, latency, and token expiry events via `MetricsStore`
- When the circuit breaker is OPEN, the pipeline returns immediately without applying the 30s timeout (fail-fast per the design)
