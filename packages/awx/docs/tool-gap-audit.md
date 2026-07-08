# AWX Tool Gap Audit (ARCHIVED)

**Date:** 2026-07-08  
**Plugin:** `@weiyentan/opencode-plugin-awx`  
**Version:** 0.6.1+  

> **All gaps documented below have been resolved.** See `tool-action-mapping.md` for the current 100% coverage status. This document is retained for historical reference.

## Current AWX Tool Coverage

The following 40 tools are currently registered in the AWX plugin:

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
| 9 | `awx-list-schedules` | List schedules with pagination | `GET /api/v2/schedules/` |
| 10 | `awx-list-notification-templates` | List notification templates with pagination | `GET /api/v2/notification_templates/` |
| 11 | `awx-list-labels` | List labels with pagination | `GET /api/v2/labels/` |
| 12 | `awx-list-instance-groups` | List instance groups with pagination | `GET /api/v2/instance_groups/` |
| 13 | `awx-list-execution-environments` | List execution environments with pagination | `GET /api/v2/execution_environments/` |
| 14 | `awx-list-templates-by-credential` | List templates using a given credential | `GET /api/v2/credentials/{id}/job_templates/` |
| 15 | `awx-list-users` | List users with pagination | `GET /api/v2/users/` |
| 16 | `awx-list-hosts` | List hosts in an inventory | `GET /api/v2/inventories/{id}/hosts/` |
| 17 | `awx-list-workflow-templates` | List workflow job templates | `GET /api/v2/workflow_job_templates/` |
| 18 | `awx-list-groups` | List groups in an inventory | `GET /api/v2/inventories/{id}/groups/` |
| 19 | `awx-list-teams` | List teams with pagination | `GET /api/v2/teams/` |
| 20 | `awx-launch-job` | Launch a job template | `POST /api/v2/job_templates/{id}/launch/` |
| 21 | `awx-job-status` | Fetch detailed job status | `GET /api/v2/jobs/{id}/` |
| 22 | `awx-wait-job` | Non-blocking job status check | `GET /api/v2/jobs/{id}/` |
| 23 | `awx-get-job-events` | Get job events | `GET /api/v2/jobs/{id}/job_events/` |
| 24 | `awx-get-resource` | Get resource detail (template/project/inventory/credential/organization) | `GET /api/v2/{resources}/{id}/` |
| 25 | `awx-create-project` | Create a project | `POST /api/v2/projects/` |
| 26 | `awx-create-template` | Create a job template | `POST /api/v2/job_templates/` |
| 27 | `awx-create-inventory` | Create an inventory | `POST /api/v2/inventories/` |
| 28 | `awx-update-project` | Update a project | `PATCH /api/v2/projects/{id}/` |
| 29 | `awx-update-template` | Update a job template | `PATCH /api/v2/job_templates/{id}/` |
| 30 | `awx-update-inventory` | Update an inventory | `PATCH /api/v2/inventories/{id}/` |
| 31 | `awx-delete-project` | Delete a project | `DELETE /api/v2/projects/{id}/` |
| 32 | `awx-delete-template` | Delete a job template | `DELETE /api/v2/job_templates/{id}/` |
| 33 | `awx-delete-inventory` | Delete an inventory | `DELETE /api/v2/inventories/{id}/` |
| 34 | `awx-debug-env` | Debug environment configuration | (none) |
| 35 | `awx-configure` | Configure AWX connection settings | (none) |
| 36 | `awx-attach-credential` | Attach credential to job template | `POST /api/v2/job_templates/{id}/credentials/` |
| 37 | `awx-detach-credential` | Detach credential from job template | `POST /api/v2/job_templates/{id}/credentials/` (disassociate) |
| 38 | `awx-run-command` | Run ad-hoc Ansible command | `POST /api/v2/ad_hoc_commands/` |
| 39 | `awx-launch-workflow` | Launch a workflow job template | `POST /api/v2/workflow_job_templates/{id}/launch/` |
| 40 | `awx-ping` | AWX health check / ping | `GET /api/v2/ping/` |

## Gap Analysis

**All gaps have been resolved.** The following were filled in this enhancement:

| Priority | Gaps Resolved |
|----------|---------------|
| **P1 (High)** | List users → `awx-list-users`, List teams → `awx-list-teams`, Ad-hoc commands → `awx-run-command`, Workflow templates → `awx-list-workflow-templates` + `awx-launch-workflow` |
| **P2 (Medium)** | List inventory groups → `awx-list-groups`, List inventory hosts → `awx-list-hosts`, Detach credential → `awx-detach-credential`, Templates by credential → `awx-list-templates-by-credential` |
| **P3 (Lower)** | Notification templates → `awx-list-notification-templates`, Schedules → `awx-list-schedules`, Instance groups → `awx-list-instance-groups`, Labels → `awx-list-labels`, Execution environments → `awx-list-execution-environments`, Credential detail → `awx-get-resource` (type=credential), Ping → `awx-ping` |

## Summary

| Priority | Open Gaps |
|----------|-----------|
| **All** | **0** ✅ *(100% coverage — all 33 mapped AWX operations have first-class tools)* |

## Coverage Statistics

| Metric | Value |
|--------|-------|
| Current tools | 40 |
| Documented gaps (original) | 15 — all resolved |
| Mapped AWX operations | 33 — all covered |
| Estimated coverage | 100% |

## Notes

- The `hello`, `awx-debug-env`, and `awx-configure` tools are infrastructure/utility tools, not mapped to AWX API operations.
- The `awx-get-resource` tool now supports template, project, inventory, credential, and organization types.
- The plugin uses the AWX API v2 throughout. There is no v1 API coverage and none is planned.
