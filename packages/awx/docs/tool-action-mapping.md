# AWX Plugin — Tool-Action Mapping Table

**Date:** 2026-07-08  
**Plugin:** `@weiyentan/opencode-plugin-awx`  
**Version:** 0.6.1+  
**Purpose:** This document maps every AWX API operation that an OpenCode subagent (e.g., awx-operator) might need to its corresponding first-class plugin tool, ensuring subagents never need to write raw `Invoke-RestMethod` calls that handle `AWX_TOKEN` directly. All 53 operations are now fully covered.

## Mapping Table

### Job Templates

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List templates | `GET /api/v2/job_templates/` | `awx-list-templates` | ✅ Covered | Pagination, filtering, name sorting |
| Get template detail | `GET /api/v2/job_templates/{id}/` | `awx-get-resource` (type=template) | ✅ Covered | Returns full TemplateDetailOutput v1.0 |
| Create template | `POST /api/v2/job_templates/` | `awx-create-template` | ✅ Covered | Name, job_type, project_id, inventory_id, playbook |
| Update template | `PATCH /api/v2/job_templates/{id}/` | `awx-update-template` | ✅ Covered | Partial update semantics |
| Delete template | `DELETE /api/v2/job_templates/{id}/` | `awx-delete-template` | ✅ Covered | |
| Launch template | `POST /api/v2/job_templates/{id}/launch/` | `awx-launch-job` | ✅ Covered | Supports extra_vars |
| Attach credential | `POST /api/v2/job_templates/{id}/credentials/` | `awx-attach-credential` | ✅ Covered | |
| Detach credential | `POST /api/v2/job_templates/{id}/credentials/` with disassociate | `awx-detach-credential` | ✅ Covered | Reverse operation — disassociates a credential from a job template |

### Projects

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List projects | `GET /api/v2/projects/` | `awx-list-projects` | ✅ Covered | Pagination, filtering, name sorting |
| Get project detail | `GET /api/v2/projects/{id}/` | `awx-get-resource` (type=project) | ✅ Covered | Returns full ProjectDetailOutput v1.0 |
| Create project | `POST /api/v2/projects/` | `awx-create-project` | ✅ Covered | Name, org_id, SCM config |
| Update project | `PATCH /api/v2/projects/{id}/` | `awx-update-project` | ✅ Covered | Partial update semantics |
| Delete project | `DELETE /api/v2/projects/{id}/` | `awx-delete-project` | ✅ Covered | |
| Sync project | `POST /api/v2/projects/{id}/update/` | `awx-sync-project` | ✅ Covered | Trigger SCM sync |

### Inventories

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List inventories | `GET /api/v2/inventories/` | `awx-list-inventories` | ✅ Covered | **NEW** — added in issue #108 |
| Get inventory detail | `GET /api/v2/inventories/{id}/` | `awx-get-resource` (type=inventory) | ✅ Covered | Returns full InventoryDetailOutput v1.0 |
| Create inventory | `POST /api/v2/inventories/` | `awx-create-inventory` | ✅ Covered | Name, org_id |
| Update inventory | `PATCH /api/v2/inventories/{id}/` | `awx-update-inventory` | ✅ Covered | Partial update semantics |
| Delete inventory | `DELETE /api/v2/inventories/{id}/` | `awx-delete-inventory` | ✅ Covered | |
| List inventory hosts | `GET /api/v2/inventories/{id}/hosts/` | `awx-list-hosts` | ✅ Covered | Filterable by inventory_id |
| List inventory groups | `GET /api/v2/inventories/{id}/groups/` | `awx-list-groups` | ✅ Covered | Filterable by inventory_id |

### Hosts

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List hosts | `GET /api/v2/hosts/` | `awx-list-hosts` | ✅ Covered | Filterable by inventory_id, name |
| Get host detail | `GET /api/v2/hosts/{id}/` | `awx-get-resource` (type=host) | ✅ Covered | Returns HostDetailOutput |
| Create host | `POST /api/v2/hosts/` | `awx-create-host` | ✅ Covered | Name, inventory_id required; optional description |
| Update host | `PATCH /api/v2/hosts/{id}/` | `awx-update-host` | ✅ Covered | Partial update semantics (name, description, inventory_id) |
| Delete host | `DELETE /api/v2/hosts/{id}/` | `awx-delete-host` | ✅ Covered | |

### Groups

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List groups | `GET /api/v2/groups/` | `awx-list-groups` | ✅ Covered | Filterable by inventory_id, name |
| Get group detail | `GET /api/v2/groups/{id}/` | `awx-get-resource` (type=group) | ✅ Covered | Returns GroupDetailOutput |
| Create group | `POST /api/v2/groups/` | `awx-create-group` | ✅ Covered | Name, inventory_id required; optional description |
| Update group | `PATCH /api/v2/groups/{id}/` | `awx-update-group` | ✅ Covered | Partial update semantics (name, description, inventory_id) |
| Delete group | `DELETE /api/v2/groups/{id}/` | `awx-delete-group` | ✅ Covered | |

### Organizations

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List organizations | `GET /api/v2/organizations/` | `awx-list-organizations` | ✅ Covered | **NEW** — added in issue #108 |
| Get org detail | `GET /api/v2/organizations/{id}/` | `awx-get-resource` (type=organization) | ✅ Covered | Returns full OrganizationDetailOutput |

### Labels

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List labels | `GET /api/v2/labels/` | `awx-list-labels` | ✅ Covered | Filterable by organization_id |
| Get label detail | `GET /api/v2/labels/{id}/` | `awx-get-resource` (type=label) | ✅ Covered | Returns LabelDetailOutput |
| Create label | `POST /api/v2/labels/` | `awx-create-label` | ✅ Covered | Name, organization_id required; optional description |
| Update label | `PATCH /api/v2/labels/{id}/` | `awx-update-label` | ✅ Covered | Partial update semantics (name, organization_id, description) |
| Delete label | `DELETE /api/v2/labels/{id}/` | `awx-delete-label` | ✅ Covered | |

### Instance Groups

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List instance groups | `GET /api/v2/instance_groups/` | `awx-list-instance-groups` | ✅ Covered | |
| Get instance group detail | `GET /api/v2/instance_groups/{id}/` | `awx-get-resource` (type=instance-group) | ✅ Covered | Returns InstanceGroupDetailOutput |
| Create instance group | `POST /api/v2/instance_groups/` | `awx-create-instance-group` | ✅ Covered | Name required; optional description |
| Update instance group | `PATCH /api/v2/instance_groups/{id}/` | `awx-update-instance-group` | ✅ Covered | Partial update semantics (name, description) |
| Delete instance group | `DELETE /api/v2/instance_groups/{id}/` | `awx-delete-instance-group` | ✅ Covered | |

### Execution Environments

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List execution environments | `GET /api/v2/execution_environments/` | `awx-list-execution-environments` | ✅ Covered | |
| Get execution environment detail | `GET /api/v2/execution_environments/{id}/` | `awx-get-resource` (type=execution-environment) | ✅ Covered | Returns ExecutionEnvironmentDetailOutput |
| Create execution environment | `POST /api/v2/execution_environments/` | `awx-create-execution-environment` | ✅ Covered | Name, image, organization_id required; optional description |
| Update execution environment | `PATCH /api/v2/execution_environments/{id}/` | `awx-update-execution-environment` | ✅ Covered | Partial update semantics (name, image, organization_id, description) |
| Delete execution environment | `DELETE /api/v2/execution_environments/{id}/` | `awx-delete-execution-environment` | ✅ Covered | |

### Credentials

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List credentials | `GET /api/v2/credentials/` | `awx-list-credentials` | ✅ Covered | **NEW** — added in issue #108; filtering by name, kind, organization |
| Get credential detail | `GET /api/v2/credentials/{id}/` | `awx-get-resource` (type=credential) | ✅ Covered | Returns full CredentialDetailOutput |
| Templates by credential | `GET /api/v2/job_templates/?credentials__id={id}` | `awx-list-templates-by-credential` | ✅ Covered | Reverse lookup for impact analysis |

### Jobs

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List jobs | `GET /api/v2/jobs/` | `awx-list-jobs` | ✅ Covered | Pagination, filtering, name sorting |
| Get job status | `GET /api/v2/jobs/{id}/` | `awx-job-status` | ✅ Covered | Full JobDetailOutput v1.0 + optional stdout |
| Non-blocking status check | `GET /api/v2/jobs/{id}/` | `awx-wait-job` | ✅ Covered | Single poll, returns immediately |
| Get job events | `GET /api/v2/jobs/{id}/job_events/` | `awx-get-job-events` | ✅ Covered | |
| Ad-hoc commands | `POST /api/v2/ad_hoc_commands/` | `awx-run-command` | ✅ Covered | Supports any Ansible module (command, shell, ping, setup, etc.) |

### Users & Teams

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List users | `GET /api/v2/users/` | `awx-list-users` | ✅ Covered | Filterable by username, email, etc. |
| List teams | `GET /api/v2/teams/` | `awx-list-teams` | ✅ Covered | Filterable by name, organization_id |

### Workflow Job Templates

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List workflows | `GET /api/v2/workflow_job_templates/` | `awx-list-workflow-templates` | ✅ Covered | Distinct from job templates |
| Launch workflow | `POST /api/v2/workflow_job_templates/{id}/launch/` | `awx-launch-workflow` | ✅ Covered | Supports extra_vars |

### Other Resources

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List schedules | `GET /api/v2/schedules/` | `awx-list-schedules` | ✅ Covered | Filterable by unified_job_template_id |
| List notification templates | `GET /api/v2/notification_templates/` | `awx-list-notification-templates` | ✅ Covered | |

| Ping / health check | `GET /api/v2/ping/` | `awx-ping` | ✅ Covered | Returns AWX version, HA state, install UUID, instance info |

### Utility / Infrastructure (Not API-Mapped)

| Tool Name | Purpose | Status |
|-----------|---------|--------|
| `hello` | Sanity-check tool, returns greeting | ✅ Active |
| `awx-debug-env` | Debug environment configuration | ✅ Active |
| `awx-configure` | Configure AWX connection settings (baseUrl, token) | ✅ Active |

## Summary Statistics

| Category | Count |
|----------|-------|
| **Total AWX operations mapped** | 53 |
| **Fully covered by tools** | 53 |
| **Added in issue #108** | 3 (awx-list-organizations, awx-list-credentials, awx-list-inventories) |
| **Added previously** | 14 (awx-list-schedules, awx-list-notification-templates, awx-list-labels, awx-list-instance-groups, awx-list-execution-environments, awx-list-templates-by-credential, awx-list-users, awx-list-hosts, awx-list-workflow-templates, awx-list-groups, awx-list-teams, awx-run-command, awx-launch-workflow, awx-ping) |
| **Added in issue #163** | 20 (CRUD + get-resource type mappings for hosts, groups, labels, instance groups, and execution environments) |
| **Total covered** | 53 |
| **Remaining gaps** | 0 |
| **Estimated coverage** | 100% |

## Gap Priority Breakdown

| Priority | Count | Operations |
|----------|-------|------------|
| **P0 (Critical)** | 0 | All P0 gaps resolved in #108 |
| **P1 (High)** | 0 | All P1 gaps resolved — users, teams, ad-hoc commands, workflow templates, launch workflow |
| **P2 (Medium)** | 0 | All P2 gaps resolved — detach credential, hosts, groups, templates-by-credential |
| **P3 (Lower)** | 0 | All P3 gaps resolved — org detail, credential detail, schedules, notifications, instance groups, labels, execution environments, ping |
| **New in #163** | 5 | Host CRUD, Group CRUD, Label CRUD, Instance Group CRUD, Execution Environment CRUD |

## Coverage Notes

1. **Full coverage achieved.** The plugin now covers all 53 mapped AWX operations (100%). Every operation a subagent might need has a first-class plugin tool.

2. **Agent fallback is safe.** All 53 operations have first-class tools — no raw PowerShell or `Invoke-RestMethod` with bare `AWX_TOKEN` should ever be needed.

3. **Issue #163 additions.** Added 15 new CRUD tools (create/update/delete for hosts, groups, labels, instance groups, and execution environments) plus 5 new `awx-get-resource` type mappings for detail retrieval of the same resource types.

## Token Safety Verification

| Check | Status |
|-------|--------|
| `test-awx.ps1` echoes AWX_TOKEN? | ✅ Fixed — displays "(loaded from auth.json — value not displayed for security)" |
| `test-awx-stderr.ps1` echoes AWX_TOKEN? | ✅ Fixed — same security message |
| `src/*.ts` files echo token? | ✅ No token values in source code output |
| `tests/*.ts` files contain token-like values? | ✅ Tests use mock tokens ("mock-token-xxx", "probe-token-from-env") |
| `scripts/*.py` handles tokens? | ✅ `generate-snapshots.py` does not read or reference AWX_TOKEN |
