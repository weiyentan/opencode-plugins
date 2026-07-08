# AWX Tool Gap Audit

**Date:** 2026-07-07  
**Plugin:** `@weiyentan/opencode-plugin-awx`  
**Version:** 0.5.4  

## Current AWX Tool Coverage

The following 25 tools are currently registered in the AWX plugin:

| # | Tool Name | Description | Endpoint |
|---|-----------|-------------|----------|
| 1 | `hello` | Sanity-check tool, returns greeting | (none) |
| 2 | `awx-sync-project` | Trigger SCM sync on a project | `POST /api/v2/projects/{id}/update/` |
| 3 | `awx-list-templates` | List job templates with pagination | `GET /api/v2/job_templates/` |
| 4 | `awx-list-projects` | List projects with pagination | `GET /api/v2/projects/` |
| 5 | `awx-list-jobs` | List jobs with pagination | `GET /api/v2/jobs/` |
| 6 | `awx-list-organizations` | List organizations with pagination | `GET /api/v2/organizations/` |
| 7 | `awx-list-credentials` | List credentials with pagination | `GET /api/v2/credentials/` |
| 8 | `awx-list-inventories` | List inventories with pagination | `GET /api/v2/inventories/` |
| 9 | `awx-launch-job` | Launch a job template | `POST /api/v2/job_templates/{id}/launch/` |
| 10 | `awx-job-status` | Fetch detailed job status | `GET /api/v2/jobs/{id}/` |
| 11 | `awx-wait-job` | Non-blocking job status check | `GET /api/v2/jobs/{id}/` |
| 12 | `awx-get-job-events` | Get job events | `GET /api/v2/jobs/{id}/job_events/` |
| 13 | `awx-get-resource` | Get resource detail (template/project/inventory) | `GET /api/v2/{resources}/{id}/` |
| 14 | `awx-create-project` | Create a project | `POST /api/v2/projects/` |
| 15 | `awx-create-template` | Create a job template | `POST /api/v2/job_templates/` |
| 16 | `awx-create-inventory` | Create an inventory | `POST /api/v2/inventories/` |
| 17 | `awx-update-project` | Update a project | `PATCH /api/v2/projects/{id}/` |
| 18 | `awx-update-template` | Update a job template | `PATCH /api/v2/job_templates/{id}/` |
| 19 | `awx-update-inventory` | Update an inventory | `PATCH /api/v2/inventories/{id}/` |
| 20 | `awx-delete-project` | Delete a project | `DELETE /api/v2/projects/{id}/` |
| 21 | `awx-delete-template` | Delete a job template | `DELETE /api/v2/job_templates/{id}/` |
| 22 | `awx-delete-inventory` | Delete an inventory | `DELETE /api/v2/inventories/{id}/` |
| 23 | `awx-debug-env` | Debug environment configuration | (none) |
| 24 | `awx-configure` | Configure AWX connection settings | (none) |
| 25 | `awx-attach-credential` | Attach credential to job template | `POST /api/v2/job_templates/{id}/credentials/` |

## Gap Analysis

The following gaps represent AWX API operations that are not yet covered by plugin tools. Recommendations are prioritized by expected user impact.

> **Update (2026-07-07):** The three P0 gaps (list organizations, list credentials, list inventories) have been resolved in v0.5.4 with the addition of `awx-list-organizations`, `awx-list-credentials`, and `awx-list-inventories` tools. The gaps below have been re-prioritized accordingly.

### P1 — High Priority (frequently needed)

| # | Gap | AWX API Endpoint | Impact | Recommendation |
|---|-----|------------------|--------|----------------|
| 1 | **List users** | `GET /api/v2/users/` | Agent cannot enumerate users for RBAC assignments, audit, or ownership changes. | Add `awx-list-users` tool with pagination and optional search filter. |
| 2 | **List teams** | `GET /api/v2/teams/` | Required for team-based role assignments and permission audits. | Add `awx-list-teams` tool with pagination. |
| 3 | **Ad-hoc commands** | `POST /api/v2/ad_hoc_commands/` | Running ad-hoc commands on inventory hosts is a core AWX capability not yet represented. | Add `awx-run-command` tool accepting inventory ID, module name, and module args. |
| 4 | **Workflow job templates** | `GET /api/v2/workflow_job_templates/` | Workflows are a distinct resource type from job templates. Agents cannot discover or launch them. | Add `awx-list-workflow-templates` and `awx-launch-workflow` tools. |

### P2 — Medium Priority (important for completeness)

| # | Gap | AWX API Endpoint | Impact | Recommendation |
|---|-----|------------------|--------|----------------|
| 5 | **List inventory groups** | `GET /api/v2/inventories/{id}/groups/` | Agents managing inventory structure need group access for host organization. | Add `awx-list-groups` tool for a given inventory. |
| 6 | **List inventory hosts** | `GET /api/v2/inventories/{id}/hosts/` | Required for inventory content inspection and host-level operations. | Add `awx-list-hosts` tool with optional filter parameters. |
| 7 | **Detach credential** | `POST /api/v2/job_templates/{id}/credentials/` with `DELETE` | Once a credential is attached, there is no way to remove it. Full lifecycle requires detach capability. | Add `DELETE` support or a `awx-detach-credential` tool. |
| 8 | **List job templates by credential** | `GET /api/v2/credentials/{id}/job_templates/` | Reverse lookup — which templates use a given credential? Useful for impact analysis before credential rotation. | Add a `job_templates` relation endpoint to `awx-get-resource` for credentials, or a new tool. |

### P3 — Lower Priority (nice-to-have)

| # | Gap | AWX API Endpoint | Impact | Recommendation |
|---|-----|------------------|--------|----------------|
| 9 | **List notification templates** | `GET /api/v2/notification_templates/` | Auditing and configuring notifications requires enumeration. | Add `awx-list-notifications` tool. |
| 10 | **List schedules** | `GET /api/v2/schedules/` | Agents cannot inspect or manage job schedules without this endpoint. | Add `awx-list-schedules` tool with filter by unified_job_template_id. |
| 11 | **List instance groups** | `GET /api/v2/instance_groups/` | Required for capacity management and execution environment configuration. | Add `awx-list-instance-groups` tool. |
| 12 | **List labels** | `GET /api/v2/labels/` | Labels are used for template organization but cannot be enumerated. | Add `awx-list-labels` tool with optional organization filter. |
| 13 | **List execution environments** | `GET /api/v2/execution_environments/` | Needed for template creation where custom execution environments are required. | Add `awx-list-execution-environments` tool. |
| 14 | **Get credential detail** | `GET /api/v2/credentials/{id}/` | Once a credential ID is known, its detail (type, inputs, organization) cannot be inspected. | Extend `awx-get-resource` to support `"credential"` type, or add a dedicated tool. |
| 15 | **Ping / health check** | `GET /api/v2/ping/` | No way to verify AWX connectivity without making a resource-specific call. | Add `awx-ping` tool or enhance `awx-debug-env` with a connectivity check. |

## Summary

| Priority | Open Gaps |
|----------|-----------|
| **P0 (Critical)** | 0 ✅ *(all 3 resolved in v0.5.4)* |
| **P1 (High)** | 4 |
| **P2 (Medium)** | 4 |
| **P3 (Lower)** | 7 |
| **Total** | **15** |

## Coverage Statistics

| Metric | Value |
|--------|-------|
| Current tools | 25 |
| Documented gaps | 15 |
| Total AWX operations (est.) | 60+ |
| Estimated coverage | ~42% |

## Notes

- The `hello`, `awx-debug-env`, and `awx-configure` tools are infrastructure/utility tools, not mapped to AWX API operations.
- Integration tests (`tests/integration/`) exist for read-only and job lifecycle scenarios but are skipped by default (`skip` not `todo`).
- The `awx-get-resource` tool supports template, project, and inventory types but could be extended to support more resource types (credentials, organizations, etc.). Extension is recommended over creating individual getter tools.
- The plugin uses the AWX API v2 throughout. There is no v1 API coverage and none is planned.
