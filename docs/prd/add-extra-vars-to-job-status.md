# PRD: Add `extra_vars` to `awx-job-status` Output Contract

## Problem Statement

When querying an AWX job via `awx-job-status`, the response does not include the `extra_vars` that were passed when the job was launched. Users must make a separate raw API call (e.g., `curl` or `Invoke-RestMethod`) to `GET /api/v2/jobs/<id>/` to inspect the `extra_vars`. This defeats the purpose of having a unified job-status tool and creates friction every time a user needs to understand what variables drove a job.

## Solution

Add `extra_vars` as a top-level required field in the `JobDetailOutput` contract returned by `awx-job-status`. The AWX API already returns this field on every job detail response as a raw YAML string — it is currently silently dropped during the API-to-contract mapping. By exposing it directly, the agent can answer "what extra vars were on that job?" with a single tool call instead of a workaround.

## User Stories

1. As an agent operator, I want `awx-job-status` to return the `extra_vars` from the job, so that I can understand what variables were passed to a job without making a separate API call.
2. As a developer debugging a failed job, I want to see the exact `extra_vars` that caused the failure, so that I can diagnose issues faster.
3. As a consumer of the `JobDetailOutput` schema, I want the `schema_version` bumped to signal that a new field was added, so that I can version my parsing logic accordingly.
4. As a test maintainer, I want fixtures and snapshots to include `extra_vars`, so that the contract is fully covered and regressions are caught.

## Implementation Decisions

1. **Field shape**: `extra_vars` will be a required `string` field — the raw YAML string as returned by the AWX API. No server-side parsing into an object. Consumers who need structured access can parse the YAML themselves.
2. **Contract location**: Top-level field in `JobDetailOutput`, positioned after `stdout` and before `raw_events` for logical grouping with other response-detail fields.
3. **Schema version**: Bumped from `"1.0"` to `"1.1"` to indicate a backward-compatible additive change.
4. **Tool scope**: Only `awx-job-status` — not `awx-get-job-events`. Job events do not carry `extra_vars`.
5. **Raw API field**: The AWX API's `GET /api/v2/jobs/<id>/` response includes an `extra_vars` field (YAML string). This will be typed in `RawAwxJob` and mapped through `mapAwxJobToContract()`.
6. **No new modules**: This is a narrow additive change to an existing output contract. No new files, no new deep modules.

## Testing Decisions

1. **What makes a good test**: The test should verify that the `extra_vars` field is present in the contract output and matches the expected YAML string from the fixture. Do not test that the YAML YAML parser works — the field is passed through as an opaque string.
2. **Modules tested**: `job-status.ts` (unit tests) and `contracts/job-detail.ts` (contract validation tests).
3. **Prior art**: Existing tests in `packages/awx/tests/job-status.test.ts` assert the full contract shape. A new assertion will be added alongside the existing field checks. Fixtures already have `extra_vars` in mock data but it is silently dropped — tests will now assert it passes through.
4. **Fixtures updated**: All three fixture files (`awx_job_success.json`, `awx_job_partial.json`, `awx_job_failure.json`) will have realistic `extra_vars` YAML strings added.
5. **Snapshots regenerated**: The snapshot generation script (`generate-snapshots.py`) will include `extra_vars` in its transform, and snapshots will be regenerated.

## Out of Scope

- Parsing `extra_vars` into a structured JSON object (requires YAML parser dependency)
- Adding `extra_vars` to `awx-get-job-events` output
- Adding `extra_vars` to any other AWX tool output
- Changing the `extra_vars` value — this is read-only pass-through
- Updating any domain docs beyond the contract type — file paths and implementation details belong in the implementation plan, not the PRD
- Backfilling `extra_vars` for historical jobs — only future `awx-job-status` calls will surface it

## Further Notes

- The test mock at `packages/awx/tests/job-status.test.ts` line 69 already includes an `extra_vars` field but it was never asserted. This PRD formalises its inclusion.
- This change is inspired by a real workflow gap: the user queried job 4361 and could not see its extra_vars through any AWX plugin tool.
