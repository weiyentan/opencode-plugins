# ADR 0002: Output Contract Alignment with `awx_job_detail.py`

**Status:** Accepted  
**Date:** 2026-06-20  
**Council Session:** `awx-plugin-prd-20260620-135410`

## Context

The PRD for `@opencode-ai/plugin-awx` defined TypeScript output types with `host_summary` and `extra_vars_summary` fields. The existing `awx_job_detail.py` v1.0 script — which all skill renderers consume — actually produces `host_status_counts` and `derived`. The PRD types were structurally wrong, which would cause silent data corruption in every skill that reads job output.

## Decision

**Adopt the exact output shape of `awx_job_detail.py` v1.0** as the canonical TypeScript contract. No field name or shape deviations.

## Corrected Contract

```typescript
interface JobDetailOutput {
  schema_version: "1.0";
  job: {
    id: number;
    name: string;
    status: string;
    failed: boolean;
    job_type: string;
    playbook: string;
    created: string;
    started: string | null;
    finished: string | null;
    elapsed: number | null;
    execution_node: string;
    controller_node: string;
    scm_branch: string;
    verbosity: number;
    forks: number | null;
    limit: string;
  };
  related: {
    inventory_name: string;
    project_name: string;
    job_template_name: string;
    instance_group_name: string;
    created_by: string;
    credential_names: string[];
    label_names: string[];
  };
  host_status_counts: {
    ok: number;
    failed: number;
    skipped: number;
    changed: number;
    unreachable: number;
  };
  derived: {
    is_successful: boolean;
    is_failed: boolean;
    has_unreachable_hosts: boolean;
  };
  warnings: string[];
  errors: string[];
  stdout?: string;
  raw_events?: unknown[];
}
```

## Evidence

The Python script was run against all three existing fixtures (`awx_job_success.json`, `awx_job_partial.json`, `awx_job_failure.json`) and the output fields were verified byte-for-byte.

## Consequences

- The `contracts/job-detail.ts` file must be rewritten from scratch to match the corrected shape.
- A compatibility test must be written before any tool code: run fixtures through both Python and TypeScript, diff the output, and gate CI on field-exact match.
- Any future schema version bumps must be coordinated between the Python script and the plugin.
- Skill renderers that read job output will continue to work unchanged.

## Alternatives Considered

1. **Adopt PRD types and normalize downstream** — Transform the plugin output to the PRD's claimed shape. Rejected because it would break every skill that already consumes the real Python output.
2. **Define a new v2 contract** — Break backward compatibility intentionally. Rejected for v1 — no justification for breaking existing renderers.
