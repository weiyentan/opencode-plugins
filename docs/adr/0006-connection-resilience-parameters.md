# ADR 0006: Connection Resilience Parameters

**Status:** Accepted  
**Date:** 2026-06-20  
**Council Session:** `awx-plugin-prd-20260620-135410`

## Context

The PRD specified `client.ts` as a thin `fetch` wrapper with no timeout, retry, or circuit breaker behavior. Node.js native `fetch` has no default timeout, meaning an unreachable AAP instance would hang a tool call indefinitely.

## Decision

**Implement connection resilience in `client.ts`** with the following parameters:

| Parameter | Value |
|-----------|-------|
| Request timeout | 30s default (10s for health-check) |
| Retry policy | Exponential backoff (1s, 2s, 4s), 3 retries max, 5xx only |
| Auth failure retry | Zero retries for 401/403/404 |
| Circuit breaker | Fail fast if AAP health-check fails on consecutive init attempts |

Additionally, wire `ToolContext.abort` (an `AbortSignal`) into all fetch calls as a runtime-level cancellation mechanism.

## Consequences

- `client.ts` estimated effort increases from 1.5h to 3-4h to implement timeout, retry, error normalization.
- The timeout/retry middleware can be shared across all tool implementations.
- `ToolContext.abort` provides a second safety net — the plugin runtime can cancel mid-request.
- No third-party HTTP dependencies needed — native `fetch` + `AbortSignal.timeout()` (Node.js 18+) covers the timeout case.

## Alternatives Considered

1. **No resilience** — Accept that AAP unreachability causes hung tool calls. Rejected: unacceptable for agent-autonomous operation.
2. **Use `undici` or `got` library** — Build in retry/timeout from battle-tested libraries. Rejected: native `fetch` is sufficient with explicit timeout/retry wrapping, keeping the zero-dependency goal intact.
3. **Infinite retry** — Keep retrying until AAP responds. Rejected: would mask genuine availability problems.
