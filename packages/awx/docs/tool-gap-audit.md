# AWX Tool Gap Audit (ARCHIVED)

**Date:** 2026-07-09  
**Plugin:** `@weiyentan/opencode-plugin-awx`  
**Version:** 0.7.1+  

> **All gaps documented below have been resolved.** See `tool-action-mapping.md` for the current 100% coverage status. This document is retained for historical reference.

## Current AWX Tool Coverage

The following 60 tools are currently registered in the AWX plugin:

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
| 14 | `awx-list-templates-by-credential` | List templates using a given credential | `GET /api/v2/job_templates/?credentials__id={id}` |
| 15 | `awx-list-users` | List users with pagination | `GET /api/v2/users/` |
| 16 | `awx-list-hosts` | List hosts in an inventory | `GET /api/v2/inventories/{id}/hosts/` |
| 17 | `awx-list-workflow-templates` | List workflow job templates | `GET /api/v2/workflow_job_templates/` |
| 18 | `awx-list-groups` | List groups in an inventory | `GET /api/v2/inventories/{id}/groups/` |
| 19 | `awx-list-teams` | List teams with pagination | `GET /api/v2/teams/` |
| 20 | `awx-launch-job` | Launch a job template | `POST /api/v2/job_templates/{id}/launch/` |
| 21 | `awx-job-status` | Fetch detailed job status | `GET /api/v2/jobs/{id}/` |
| 22 | `awx-wait-job` | Non-blocking job status check | `GET /api/v2/jobs/{id}/` |
| 23 | `awx-get-job-events` | Get job events | `GET /api/v2/jobs/{id}/job_events/` |
| 24 | `awx-get-resource` | Get resource detail (template/project/inventory/credential/organization/host/group/label/instance-group/execution-environment/user/team/schedule/notification_template) | `GET /api/v2/{resources}/{id}/` |
| 25 | `awx-create-project` | Create a project | `POST /api/v2/projects/` |
| 26 | `awx-create-template` | Create a job template | `POST /api/v2/job_templates/` |
| 27 | `awx-create-inventory` | Create an inventory | `POST /api/v2/inventories/` |
| 28 | `awx-update-project` | Update a project | `PATCH /api/v2/projects/{id}/` |
| 29 | `awx-update-template` | Update a job template | `PATCH /api/v2/job_templates/{id}/` |
| 30 | `awx-update-inventory` | Update an inventory | `PATCH /api/v2/inventories/{id}/` |
| 31 | `awx-delete-project` | Delete a project | `DELETE /api/v2/projects/{id}/` |
| 32 | `awx-delete-template` | Delete a job template | `DELETE /api/v2/job_templates/{id}/` |
| 33 | `awx-delete-inventory` | Delete an inventory | `DELETE /api/v2/inventories/{id}/` |
| 34 | `awx-get-host` | Get host detail | `GET /api/v2/hosts/{id}/` |
| 35 | `awx-create-host` | Create a host | `POST /api/v2/hosts/` |
| 36 | `awx-update-host` | Update a host | `PATCH /api/v2/hosts/{id}/` |
| 37 | `awx-delete-host` | Delete a host | `DELETE /api/v2/hosts/{id}/` |
| 38 | `awx-get-group` | Get group detail | `GET /api/v2/groups/{id}/` |
| 39 | `awx-create-group` | Create a group | `POST /api/v2/groups/` |
| 40 | `awx-update-group` | Update a group | `PATCH /api/v2/groups/{id}/` |
| 41 | `awx-delete-group` | Delete a group | `DELETE /api/v2/groups/{id}/` |
| 42 | `awx-get-label` | Get label detail | `GET /api/v2/labels/{id}/` |
| 43 | `awx-create-label` | Create a label | `POST /api/v2/labels/` |
| 44 | `awx-update-label` | Update a label | `PATCH /api/v2/labels/{id}/` |
| 45 | `awx-delete-label` | Delete a label | `DELETE /api/v2/labels/{id}/` |
| 46 | `awx-get-instance-group` | Get instance group detail | `GET /api/v2/instance_groups/{id}/` |
| 47 | `awx-create-instance-group` | Create an instance group | `POST /api/v2/instance_groups/` |
| 48 | `awx-update-instance-group` | Update an instance group | `PATCH /api/v2/instance_groups/{id}/` |
| 49 | `awx-delete-instance-group` | Delete an instance group | `DELETE /api/v2/instance_groups/{id}/` |
| 50 | `awx-get-execution-environment` | Get execution environment detail | `GET /api/v2/execution_environments/{id}/` |
| 51 | `awx-create-execution-environment` | Create an execution environment | `POST /api/v2/execution_environments/` |
| 52 | `awx-update-execution-environment` | Update an execution environment | `PATCH /api/v2/execution_environments/{id}/` |
| 53 | `awx-delete-execution-environment` | Delete an execution environment | `DELETE /api/v2/execution_environments/{id}/` |
| 54 | `awx-debug-env` | Debug environment configuration | (none) |
| 55 | `awx-configure` | Configure AWX connection settings | (none) |
| 56 | `awx-attach-credential` | Attach credential to job template | `POST /api/v2/job_templates/{id}/credentials/` |
| 57 | `awx-detach-credential` | Detach credential from job template | `POST /api/v2/job_templates/{id}/credentials/` (disassociate) |
| 58 | `awx-run-command` | Run ad-hoc Ansible command | `POST /api/v2/ad_hoc_commands/` |
| 59 | `awx-launch-workflow` | Launch a workflow job template | `POST /api/v2/workflow_job_templates/{id}/launch/` |
| 60 | `awx-ping` | AWX health check / ping | `GET /api/v2/ping/` |

## Gap Analysis

**All gaps have been resolved.** The following were filled in past enhancements:

| Priority | Gaps Resolved |
|----------|---------------|
| **P1 (High)** | List users → `awx-list-users`, List teams → `awx-list-teams`, Ad-hoc commands → `awx-run-command`, Workflow templates → `awx-list-workflow-templates` + `awx-launch-workflow` |
| **P2 (Medium)** | List inventory groups → `awx-list-groups`, List inventory hosts → `awx-list-hosts`, Detach credential → `awx-detach-credential`, Templates by credential → `awx-list-templates-by-credential` |
| **P3 (Lower)** | Notification templates → `awx-list-notification-templates`, Schedules → `awx-list-schedules`, Instance groups → `awx-list-instance-groups`, Labels → `awx-list-labels`, Execution environments → `awx-list-execution-environments`, Credential detail → `awx-get-resource` (type=credential), Ping → `awx-ping` |

## Summary

| Priority | Open Gaps |
|----------|-----------|
| **All** | **0** ✅ *(100% coverage — all 53 mapped AWX operations have first-class tools)* |

## Coverage Statistics

| Metric | Value |
|--------|-------|
| Current tools | 60 |
| Documented gaps (original) | 15 — all resolved |
| Mapped AWX operations | 53 — all covered |
| Estimated coverage | 100% |

## Notes

- The `hello`, `awx-debug-env`, and `awx-configure` tools are infrastructure/utility tools, not mapped to AWX API operations.
- The `awx-get-resource` tool now supports template, project, inventory, credential, organization, host, group, label, instance-group, execution-environment, user, team, schedule, and notification_template types.
- The plugin uses the AWX API v2 throughout. There is no v1 API coverage and none is planned.
