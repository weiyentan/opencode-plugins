# AWX Tool Gap Audit

**Date:** 2026-07-01  
**Plugin:** `@weiyentan/opencode-plugin-awx`  
**Version:** 0.5.3  

## Current AWX Tool Coverage

The following 22 tools are currently registered in the AWX plugin:

| # | Tool Name | Description | Endpoint |
|---|-----------|-------------|----------|
| 1 | `hello` | Sanity-check tool, returns greeting | (none) |
| 2 | `awx-sync-project` | Trigger SCM sync on a project | `POST /api/v2/projects/{id}/update/` |
| 3 | `awx-list-templates` | List job templates with pagination | `GET /api/v2/job_templates/` |
| 4 | `awx-list-projects` | List projects with pagination | `GET /api/v2/projects/` |
| 5 | `awx-list-jobs` | List jobs with pagination | `GET /api/v2/jobs/` |
| 6 | `awx-launch-job` | Launch a job template | `POST /api/v2/job_templates/{id}/launch/` |
| 7 | `awx-job-status` | Fetch detailed job status | `GET /api/v2/jobs/{id}/` |
| 8 | `awx-wait-job` | Non-blocking job status check | `GET /api/v2/jobs/{id}/` |
| 9 | `awx-get-job-events` | Get job events | `GET /api/v2/jobs/{id}/job_events/` |
| 10 | `awx-get-resource` | Get resource detail (template/project/inventory) | `GET /api/v2/{resources}/{id}/` |
| 11 | `awx-create-project` | Create a project | `POST /api/v2/projects/` |
| 12 | `awx-create-template` | Create a job template | `POST /api/v2/job_templates/` |
| 13 | `awx-create-inventory` | Create an inventory | `POST /api/v2/inventories/` |
| 14 | `awx-update-project` | Update a project | `PATCH /api/v2/projects/{id}/` |
| 15 | `awx-update-template` | Update a job template | `PATCH /api/v2/job_templates/{id}/` |
| 16 | `awx-update-inventory` | Update an inventory | `PATCH /api/v2/inventories/{id}/` |
| 17 | `awx-delete-project` | Delete a project | `DELETE /api/v2/projects/{id}/` |
| 18 | `awx-delete-template` | Delete a job template | `DELETE /api/v2/job_templates/{id}/` |
| 19 | `awx-delete-inventory` | Delete an inventory | `DELETE /api/v2/inventories/{id}/` |
| 20 | `awx-debug-env` | Debug environment configuration | (none) |
| 21 | `awx-configure` | Configure AWX connection settings | (none) |
| 22 | `awx-attach-credential` | Attach credential to job template | `POST /api/v2/job_templates/{id}/credentials/` |

## Gap Analysis

The following gaps represent AWX API operations that are not yet covered by plugin tools. Recommendations are prioritized by expected user impact.

### P0 — Critical Gaps (blocking common workflows)

| # | Gap | AWX API Endpoint | Impact | Recommendation |
|---|-----|------------------|--------|----------------|
| 1 | **List organizations** | `GET /api/v2/organizations/` | Most CRUD operations require an `organization_id`, but agents have no way to resolve organization names to IDs. This is a prerequisite for every create/update operation. | Add `awx-list-organizations` tool with pagination support, similar to `awx-list-templates`. |
| 2 | **List credentials** | `GET /api/v2/credentials/` | Agents need to discover credential IDs before attaching them to templates. Without this, `awx-attach-credential` requires out-of-band knowledge. | Add `awx-list-credentials` tool with filtering by name, kind, and organization. |
| 3 | **List inventories** | `GET /api/v2/inventories/` | Templates and job launches reference inventory IDs, but there is no list tool. Agents must know the ID ahead of time. | Add `awx-list-inventories` tool with pagination and filtering. |

### P1 — High Priority (frequently needed)

| # | Gap | AWX API Endpoint | Impact | Recommendation |
|---|-----|------------------|--------|----------------|
| 4 | **List users** | `GET /api/v2/users/` | Agent cannot enumerate users for RBAC assignments, audit, or ownership changes. | Add `awx-list-users` tool with pagination and optional search filter. |
| 5 | **List teams** | `GET /api/v2/teams/` | Required for team-based role assignments and permission audits. | Add `awx-list-teams` tool with pagination. |
| 6 | **Ad-hoc commands** | `POST /api/v2/ad_hoc_commands/` | Running ad-hoc commands on inventory hosts is a core AWX capability not yet represented. | Add `awx-run-command` tool accepting inventory ID, module name, and module args. |
| 7 | **Workflow job templates** | `GET /api/v2/workflow_job_templates/` | Workflows are a distinct resource type from job templates. Agents cannot discover or launch them. | Add `awx-list-workflow-templates` and `awx-launch-workflow` tools. |

### P2 — Medium Priority (important for completeness)

| # | Gap | AWX API Endpoint | Impact | Recommendation |
|---|-----|------------------|--------|----------------|
| 8 | **List inventory groups** | `GET /api/v2/inventories/{id}/groups/` | Agents managing inventory structure need group access for host organization. | Add `awx-list-groups` tool for a given inventory. |
| 9 | **List inventory hosts** | `GET /api/v2/inventories/{id}/hosts/` | Required for inventory content inspection and host-level operations. | Add `awx-list-hosts` tool with optional filter parameters. |
| 10 | **Detach credential** | `POST /api/v2/job_templates/{id}/credentials/` with `DELETE` | Once a credential is attached, there is no way to remove it. Full lifecycle requires detach capability. | Add `DELETE` support or a `awx-detach-credential` tool. |
| 11 | **List job templates by credential** | `GET /api/v2/credentials/{id}/job_templates/` | Reverse lookup — which templates use a given credential? Useful for impact analysis before credential rotation. | Add a `job_templates` relation endpoint to `awx-get-resource` for credentials, or a new tool. |

### P3 — Lower Priority (nice-to-have)

| # | Gap | AWX API Endpoint | Impact | Recommendation |
|---|-----|------------------|--------|----------------|
| 12 | **List notification templates** | `GET /api/v2/notification_templates/` | Auditing and configuring notifications requires enumeration. | Add `awx-list-notifications` tool. |
| 13 | **List schedules** | `GET /api/v2/schedules/` | Agents cannot inspect or manage job schedules without this endpoint. | Add `awx-list-schedules` tool with filter by unified_job_template_id. |
| 14 | **List instance groups** | `GET /api/v2/instance_groups/` | Required for capacity management and execution environment configuration. | Add `awx-list-instance-groups` tool. |
| 15 | **List labels** | `GET /api/v2/labels/` | Labels are used for template organization but cannot be enumerated. | Add `awx-list-labels` tool with optional organization filter. |
| 16 | **List execution environments** | `GET /api/v2/execution_environments/` | Needed for template creation where custom execution environments are required. | Add `awx-list-execution-environments` tool. |
| 17 | **Get credential detail** | `GET /api/v2/credentials/{id}/` | Once a credential ID is known, its detail (type, inputs, organization) cannot be inspected. | Extend `awx-get-resource` to support `"credential"` type, or add a dedicated tool. |
| 18 | **Ping / health check** | `GET /api/v2/ping/` | No way to verify AWX connectivity without making a resource-specific call. | Add `awx-ping` tool or enhance `awx-debug-env` with a connectivity check. |

## Summary

| Priority | Open Gaps |
|----------|-----------|
| **P0 (Critical)** | 3 |
| **P1 (High)** | 4 |
| **P2 (Medium)** | 4 |
| **P3 (Lower)** | 7 |
| **Total** | **18** |

## Coverage Statistics

| Metric | Value |
|--------|-------|
| Current tools | 22 |
| Documented gaps | 18 |
| Total AWX operations (est.) | 60+ |
| Estimated coverage | ~35% |

## Notes

- The `hello`, `awx-debug-env`, and `awx-configure` tools are infrastructure/utility tools, not mapped to AWX API operations.
- Integration tests (`tests/integration/`) exist for read-only and job lifecycle scenarios but are skipped by default (`skip` not `todo`).
- The `awx-get-resource` tool supports template, project, and inventory types but could be extended to support more resource types (credentials, organizations, etc.). Extension is recommended over creating individual getter tools.
- The plugin uses the AWX API v2 throughout. There is no v1 API coverage and none is planned.
