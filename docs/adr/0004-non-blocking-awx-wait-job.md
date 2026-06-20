# ADR 0004: Non-Blocking `awx-wait-job` Design

**Status:** Accepted  
**Date:** 2026-06-20  
**Council Session:** `awx-plugin-prd-20260620-135410`

## Context

The PRD specified `awx-wait-job` as a blocking server-side poll loop (polling AAP every 10s for up to 600s). The Council identified two problems:

1. **Plugin runtime timeout** — OpenCode plugin runtimes may have execution timeouts (30-300s) that would kill a 600s poll loop mid-operation.
2. **Resource hygiene** — Holding a plugin process slot for up to 10 minutes blocks that slot from serving other tool calls.

## Decision

**`awx-wait-job` returns immediately** with the job ID. The agent performs the poll loop by calling `awx-job-status` in a documented pattern. No server-side polling loop.

## Agent-Side Poll Pattern

```
1. awx-launch-job({ template: "deploy-app", extra_vars: {...} })
   → { jobId: 42 }

2. Agent continues with other work, then polls:
   loop {
     status = awx-job-status({ jobId: 42 })
     if status.job.status in ["successful", "failed", "canceled", "error"] → break
     sleep(10s + uniform_jitter)  // jitter: ±2s to avoid thundering herd
   }
```

## Consequences

- `awx-wait-job` becomes a thin wrapper: single GET to `/api/v2/jobs/<id>/`, returns the full v1.0 contract.
- Estimated effort drops from 6h (realistic, Round 1) to 1.5h.
- Agents use more tokens for the poll loop, but can interleave useful work between polls.
- Skills that need wait semantics must implement the poll pattern (documented once in skill updates).
- Future enhancement: centralized polling utility or AAP webhook-based completion detection (Phase 2.5 debt item).

## Evidence

- `ToolContext.abort` (from `@opencode-ai/plugin`) provides `AbortSignal` — the runtime can signal cancellation natively if needed.
- The agent-side pattern is already how most LLM agent frameworks handle async operations.

## Alternatives Considered

1. **Blocking server-side poll** (PRD v1) — Hold plugin process for up to 600s. Rejected due to runtime timeout risk and resource waste.
2. **Centralized polling in plugin with async background task** — Plugin spawns background poller, agent checks in later. Rejected for v1: adds state management complexity with no clear benefit over agent-side pattern.
3. **AAP event-driven webhooks** — `/api/v2/jobs/N/notifications/` for push-based completion. Deferred to v2: requires AAP webhook configuration and public endpoint.
