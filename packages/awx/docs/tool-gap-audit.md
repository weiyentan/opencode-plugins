# AWX Tool-Gap Audit

> Generated: 2026-07-01 | Issue: #109

## Purpose

This document maps all existing AWX plugin tools to their AWX API endpoints, identifies gaps in first-class tool coverage, and recommends high-value tools to close those gaps. This ensures subagents never need to write inline scripts that expose PAT tokens.

---

## Existing Tools

| # | Tool Name | AWX API Endpoint | HTTP Method | Category |
|---|---|---|---|---|
| 1 | `hello` | N/A | N/A | Scaffolding |
| 2 | `awx-sync-project` | `/api/v2/projects/{id}/update/` | POST | Project Operations |
| 3 | `awx-list-templates` | `/api/v2/job_templates/` | GET | Read (List) |
| 4 | `awx-list-projects` | `/api/v2/projects/` | GET | Read (List) |
| 5 | `awx-list-jobs` | `/api/v2/jobs/` | GET | Read (List) |
| 6 | `awx-launch-job` | `/api/v2/job_templates/{id}/launch/` | POST | Job Lifecycle |
| 7 | `awx-job-status` | `/api/v2/jobs/{id}/` | GET | Job Lifecycle |
| 8 | `awx-wait-job` | `/api/v2/jobs/{id}/` | GET | Job Lifecycle |
| 9 | `awx-get-job-events` | `/api/v2/jobs/{id}/job_events/` | GET | Job Lifecycle |
| 10 | `awx-get-resource` | Dispatched (template/project/inventory) | GET | Read (Detail) |
| 11 | `awx-create-project` | `/api/v2/projects/` | POST | CRUD |
| 12 | `awx-create-template` | `/api/v2/job_templates/` | POST | CRUD |
| 13 | `awx-create-inventory` | `/api/v2/inventories/` | POST | CRUD |
| 14 | `awx-update-project` | `/api/v2/projects/{id}/` | PATCH | CRUD |
| 15 | `awx-update-template` | `/api/v2/job_templates/{id}/` | PATCH | CRUD |
| 16 | `awx-update-inventory` | `/api/v2/inventories/{id}/` | PATCH | CRUD |
| 17 | `awx-delete-project` | `/api/v2/projects/{id}/` | DELETE | CRUD |
| 18 | `awx-delete-template` | `/api/v2/job_templates/{id}/` | DELETE | CRUD |
| 19 | `awx-delete-inventory` | `/api/v2/inventories/{id}/` | DELETE | CRUD |
| 20 | `awx-attach-credential` | `/api/v2/job_templates/{id}/credentials/` | POST | Credential Operations |
| 21 | `awx-debug-env` | N/A | N/A | Diagnostics |
| 22 | `awx-configure` | N/A | N/A | Configuration |

**Total: 22 tools** (20 API tools + 2 utility tools)

---

## Coverage by Resource Type

| Resource Type | List | Get | Create | Update | Delete | Lifecycle |
|---|---|---|---|---|---|---|
| **Job Templates** | ✅ | ✅ (via awx-get-resource) | ✅ | ✅ | ✅ | ✅ (launch) |
| **Projects** | ✅ | ✅ (via awx-get-resource) | ✅ | ✅ | ✅ | ✅ (sync) |
| **Inventories** | ❌ | ✅ (via awx-get-resource) | ✅ | ✅ | ✅ | ❌ |
| **Jobs** | ✅ | ✅ | N/A | N/A | N/A | ❌ (cancel/relaunch) |
| **Credentials** | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| **Organizations** | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| **Inventory Sources** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (sync) |
| **Hosts** | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| **Groups** | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| **Workflow Templates** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (launch) |
| **Schedules** | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| **Credential Types** | ❌ | ❌ | N/A | N/A | N/A | N/A |
| **Settings** | N/A | ❌ | N/A | ❌ | N/A | N/A |
| **Notification Templates** | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| **Users / Teams** | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| **Instance Groups** | ❌ | ❌ | N/A | N/A | N/A | N/A |

---

## Tool Gaps (High Priority)

These are gaps that subagents commonly encounter and currently require inline scripting.

### 1. Organization Management (5 tools)

Organizations are the top-level container in AWX. Without organization tools, subagents cannot resolve org IDs or manage org resources.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-organizations` | `/api/v2/organizations/` | GET |
| `awx-create-organization` | `/api/v2/organizations/` | POST |
| `awx-get-organization` | `/api/v2/organizations/{id}/` | GET |
| `awx-update-organization` | `/api/v2/organizations/{id}/` | PATCH |
| `awx-delete-organization` | `/api/v2/organizations/{id}/` | DELETE |

### 2. Credential Management (5 tools + 2 attachment tools)

Credentials are the most common gap. Agents frequently need to list credentials to find IDs, create new credentials, or manage credential associations with templates.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-credentials` | `/api/v2/credentials/` | GET |
| `awx-create-credential` | `/api/v2/credentials/` | POST |
| `awx-get-credential` | `/api/v2/credentials/{id}/` | GET |
| `awx-update-credential` | `/api/v2/credentials/{id}/` | PATCH |
| `awx-delete-credential` | `/api/v2/credentials/{id}/` | DELETE |
| `awx-attach-credential` | `/api/v2/job_templates/{id}/credentials/` | POST ✅ (implemented #109) |
| `awx-detach-credential` | `/api/v2/job_templates/{id}/credentials/` (disassociate) | POST |

### 3. Inventory Source Management (2 tools)

Inventory sources sync external data into AWX inventories. Agents setting up inventories need these.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-inventory-sources` | `/api/v2/inventories/{id}/inventory_sources/` | GET |
| `awx-sync-inventory-source` | `/api/v2/inventory_sources/{id}/update/` | POST |

### 4. Host Management (5 tools)

Hosts are the managed nodes in AWX. Common operations include listing hosts, adding new hosts, and managing host variables.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-hosts` | `/api/v2/hosts/` | GET |
| `awx-create-host` | `/api/v2/hosts/` | POST |
| `awx-get-host` | `/api/v2/hosts/{id}/` | GET |
| `awx-update-host` | `/api/v2/hosts/{id}/` | PATCH |
| `awx-delete-host` | `/api/v2/hosts/{id}/` | DELETE |

### 5. Workflow Job Templates (2 tools)

Workflow templates orchestrate multiple job templates. Required for complex automation pipelines.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-workflow-templates` | `/api/v2/workflow_job_templates/` | GET |
| `awx-launch-workflow` | `/api/v2/workflow_job_templates/{id}/launch/` | POST |

### 6. Job Control (2 tools)

Operations on running jobs — cancellation and relaunch are common needs.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-cancel-job` | `/api/v2/jobs/{id}/cancel/` | POST |
| `awx-relaunch-job` | `/api/v2/jobs/{id}/relaunch/` | POST |

### 7. Credential Types (2 tools)

Reference data needed when creating credentials (machine, scm, vault, etc.).

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-credential-types` | `/api/v2/credential_types/` | GET |
| `awx-get-credential-type` | `/api/v2/credential_types/{id}/` | GET |

### 8. Settings (2 tools)

Read/modify AWX system settings. Useful for automation that configures AWX itself.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-get-settings` | `/api/v2/settings/all/` | GET |
| `awx-update-setting` | `/api/v2/settings/{category}/` | PATCH |

### 9. Schedule Management (3 tools)

Scheduled runs of job templates. Agents need to list, create, and delete schedules.

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-schedules` | Uses related link from template or project | GET |
| `awx-create-schedule` | `/api/v2/schedules/` | POST |
| `awx-delete-schedule` | `/api/v2/schedules/{id}/` | DELETE |

### 10. Misc High-Value Tools (4 tools)

| Tool | Endpoint | Method |
|---|---|---|
| `awx-list-inventories` | `/api/v2/inventories/` | GET |
| `awx-list-users` | `/api/v2/users/` | GET |
| `awx-list-instance-groups` | `/api/v2/instance_groups/` | GET |
| `awx-list-activity-stream` | `/api/v2/activity_stream/` | GET |

---

## Summary

| Category | Existing | Gaps | Recommended |
|---|---|---|---|
| Template Lifecycle | 6 | 0 | — |
| Project Lifecycle | 5 | 0 | — |
| Job Lifecycle | 4 | 2 | awx-cancel-job, awx-relaunch-job |
| Inventory CRUD | 3 | 1 | awx-list-inventories |
| Organization CRUD | 0 | 5 | Full CRUD set |
| Credential CRUD | 1 | 6 | Full CRUD + detach |
| Host CRUD | 0 | 5 | Full CRUD set |
| Credential Types | 0 | 2 | List + Get |
| Inventory Sources | 0 | 2 | List + Sync |
| Workflow Templates | 0 | 2 | List + Launch |
| Schedules | 0 | 3 | List + Create + Delete |
| Settings | 0 | 2 | Get + Update |
| Users & Groups | 0 | 2 | List users, List instance groups |
| Activity | 0 | 1 | Activity stream |
| **Totals** | **20 API tools** | **33 gaps** | **32 new tools** |

**Conclusion:** The AWX plugin currently covers ~38% of the most commonly used AWX API surface. Implementing the 32 recommended tools would bring coverage to ~85%+ and eliminate the need for subagents to write inline PAT-exposing scripts for all common AWX operations.
