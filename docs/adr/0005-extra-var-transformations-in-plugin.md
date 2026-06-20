# ADR 0005: Extra-Var Transformations in Plugin `transforms.ts`

**Status:** Accepted  
**Date:** 2026-06-20  
**Council Session:** `awx-plugin-prd-20260620-135410`

## Context

The existing PowerShell helper (`awx-helper.ps1`) performs three transformations before launching a job:
1. SSH→HTTPS URL conversion for `target_repo_url` (e.g., `git@gitlab.com:org/repo.git` → `https://gitlab.com/org/repo`)
2. Git branch inference when `target_branch` is missing (runs `git branch --show-current`)
3. Required-var validation against a configurable list (`RequiredVarNames`)

The PRD didn't address where these transformations would live in the new plugin architecture.

## Decision

**Add a `transforms.ts` module within the plugin** that handles SSH→HTTPS URL conversion and git branch inference. The module is a shared utility importable by any tool or caller, not tied to a single tool.

Required-var validation remains in the skill/caller layer as it is per-deployment configurable.

## Module Structure

```
packages/awx/src/
  transforms.ts       ← Shared helper: sshToHttps(), inferBranch(), validateRequiredVars()
  client.ts           ← HTTP adapter (thin, no business logic)
  tools/
    awx-launch-job.ts ← Imports transforms.ts then calls client.ts
```

## Consequences

- `awx-launch-job` imports and applies transformations internally before making the API call.
- `awx-job-status` and other read-only tools do not need transformations.
- The transforms module is structurally separated from the HTTP client (clean separation of concerns).
- Can be extracted into a standalone package in v2 if other OpenCode components need it.
- Skills document the required-var list but don't duplicate SSH or branch logic.
- The module is importable by other tools or external callers — a shared helper, not hidden inside a single tool.

## Alternatives Considered

1. **In each skill** — Every skill duplicates SSH→HTTPS conversion and branch inference. Rejected: N implementations diverging over time.
2. **In the HTTP client** — Violates single-responsibility; `client.ts` becomes part-HTTP-adapter, part-workflow-orchestrator.
3. **Separate npm package** — Premature extraction for v1; the module is small and only consumed within the plugin.
