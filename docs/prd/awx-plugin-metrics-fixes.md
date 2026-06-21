# AWX Plugin — Metrics Accounting & Review Findings

## Problem Statement

The AWX OpenCode plugin has been through a PR review that identified a correctness bug in metrics accounting and several hygiene issues. Metrics are persistent and survive plugin reloads, but `callCount` undercounts failed logical calls — it only increments on 2xx responses, not on 4xx, 5xx, circuit-breaker rejections, or network errors. This makes the persisted metrics misleading. Additionally, persistence failures are silently swallowed with no observability, auth documentation doesn't match runtime behaviour, and the root README has an invisible UTF-8 BOM that creates review noise.

## Solution

Fix the metrics accounting so `callCount` tracks every tool call regardless of outcome, `errorCount` tracks every non-2xx outcome including circuit-breaker rejection, wire persistence error logging through OpenCode's app logging, update auth docs to match non-blocking init behaviour, and strip the BOM from the root README. Create follow-up GitHub issues for production npm packaging and a CI pipeline.

## User Stories

1. As an operator reviewing persisted metrics, I want `callCount` to reflect every attempted tool call, so that I can accurately assess usage volume.
2. As an operator reviewing persisted metrics, I want `errorCount` to reflect every failed outcome including circuit-breaker rejections, so that I can detect service degradation.
3. As an operator diagnosing missing metrics, I want persistence failures to be surfaced through OpenCode app logging, so that I can detect disk/path/permission problems.
4. As a developer onboarding to the plugin, I want the auth documentation to match the actual non-blocking init behaviour, so that I'm not misled about plugin startup semantics.
5. As a reviewer reading the PR, I want the root README to not start with a UTF-8 BOM, so that GitHub doesn't show spurious hidden-character warnings.
6. As a downstream consumer, I want the package to be publishable to npm with a proper build output, so that I can depend on it as a production dependency.
7. As a maintainer, I want automated CI checks (lint, test, build), so that regressions are caught before merge.

## Implementation Decisions

The following modules will be modified:

- **`src/client.ts`** — Restructure the `request()` method so that `metrics.recordCall()` is called in a `finally` block for every invocation, not just on 2xx success. Add `shouldRecordError` tracking to increment `errorCount` for any non-2xx outcome including circuit-breaker-open synthetic 503s. Move `clearTimeout_()` into the same `finally` block for consistent cleanup.

- **`src/metrics.ts`** — Add an optional `onError` callback parameter to `setupMetricsPersistence()` so the caller can observe persistence failures without crashing the interval. The callback receives the error object but the interval continues running. Fix stale JSDoc on `recordError()` that incorrectly claims circuit breaker rejections already record errors.

- **`src/index.ts`** — Wire the `onError` callback from `setupMetricsPersistence()` through the OpenCode client's `app.log()` method with service name, severity level, and error details.

- **`src/auth.ts`** — Update the doc comment that claims failed init-time validation blocks plugin startup. The actual runtime behaviour allows the plugin to load so the user can re-authenticate — update the comment to match.

- **`README.md` (root)** — Re-save as UTF-8 without BOM to eliminate the visible hidden-character warning on GitHub.

- **`tests/client.test.ts`** — Update assertions so that test scenarios verify `callCount` increments on all outcomes: success (2xx), client error (4xx), server error (5xx), circuit-breaker rejection, and network error. Verify `errorCount` increments only on non-2xx outcomes.

- **`tests/metrics.test.ts`** — Add a test that `setupMetricsPersistence()` fires the `onError` callback when `store.persist()` throws.

- **No new modules** are created. All changes are localized to existing files.

## Testing Decisions

Good tests only verify external behaviour, not implementation details. The metrics counting tests should assert that after specific HTTP outcomes, the `MetricsStore` counters have the expected state — not that specific internal functions were called in a particular order.

All modified modules already have test files:
- `tests/client.test.ts` — prior art: existing tests for auth headers, 4xx/5xx retry, circuit breaker states, timeout, abort. Extend these with metrics counter assertions.
- `tests/metrics.test.ts` — prior art: counter increment tests, persistence reload, atomic writes, periodic persistence lifecycle. Add the onError callback test here.

Run tests with `npm test` (vitest) and type-check with `npm run lint` (tsc --noEmit) before committing.

## Out of Scope

- Adding new AWX tools or API operations. Only the three existing tools (hello, listTemplates) are affected.
- Production npm packaging — will be a follow-up GitHub issue.
- CI pipeline configuration — will be a follow-up GitHub issue.
- Any changes to the output contract, transforms, or auth hook interface.
- Any changes to the circuit breaker thresholds or backoff parameters.

## Further Notes

This work is driven by a ChatGPT PR review of opencode-plugins PR #29. The review identified shared `MetricsStore` injection, lazy client creation, metrics persistence serialization, and timeout cleanup as resolved concerns. The remaining blocker was the metrics accounting mismatch between the documented contract and the implementation. This PRD addresses all items the review flagged as requiring action.
