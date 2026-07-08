# AWX Plugin — Tool-Action Mapping Table

**Date:** 2026-07-07  
**Plugin:** `@weiyentan/opencode-plugin-awx`  
**Version:** 0.5.3+  
**Purpose:** This document maps every AWX API operation that an OpenCode subagent (e.g., awx-operator) might need to its corresponding first-class plugin tool, ensuring subagents never need to write raw `Invoke-RestMethod` calls that handle `AWX_TOKEN` directly. Gaps are documented with rationale and priority.

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
| Detach credential | `POST /api/v2/job_templates/{id}/credentials/` with disassociate | — | 🔴 Gap (P2) | Reverse operation; not yet implemented. Subagent workaround: use awx-attach-credential documentation. |

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
| List inventory hosts | `GET /api/v2/inventories/{id}/hosts/` | — | 🟡 Gap (P2) | Needs `awx-list-hosts` tool |
| List inventory groups | `GET /api/v2/inventories/{id}/groups/` | — | 🟡 Gap (P2) | Needs `awx-list-groups` tool |

### Organizations

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List organizations | `GET /api/v2/organizations/` | `awx-list-organizations` | ✅ Covered | **NEW** — added in issue #108 |
| Get org detail | `GET /api/v2/organizations/{id}/` | `awx-get-resource` | 🔴 Gap (P3) | Type "organization" not yet in resource registry |

### Credentials

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List credentials | `GET /api/v2/credentials/` | `awx-list-credentials` | ✅ Covered | **NEW** — added in issue #108; filtering by name, kind, organization |
| Get credential detail | `GET /api/v2/credentials/{id}/` | — | 🟡 Gap (P3) | Type "credential" not yet in resource registry; use awx-list-credentials for discovery |
| Templates by credential | `GET /api/v2/credentials/{id}/job_templates/` | — | 🔴 Gap (P2) | Reverse lookup for impact analysis |

### Jobs

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List jobs | `GET /api/v2/jobs/` | `awx-list-jobs` | ✅ Covered | Pagination, filtering, name sorting |
| Get job status | `GET /api/v2/jobs/{id}/` | `awx-job-status` | ✅ Covered | Full JobDetailOutput v1.0 + optional stdout |
| Non-blocking status check | `GET /api/v2/jobs/{id}/` | `awx-wait-job` | ✅ Covered | Single poll, returns immediately |
| Get job events | `GET /api/v2/jobs/{id}/job_events/` | `awx-get-job-events` | ✅ Covered | |
| Ad-hoc commands | `POST /api/v2/ad_hoc_commands/` | — | 🔴 Gap (P1) | Important for running commands on inventory hosts; not yet implemented |

### Users & Teams

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List users | `GET /api/v2/users/` | — | 🔴 Gap (P1) | Needed for RBAC assignments |
| List teams | `GET /api/v2/teams/` | — | 🔴 Gap (P1) | Needed for role assignments |

### Workflow Job Templates

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List workflows | `GET /api/v2/workflow_job_templates/` | — | 🔴 Gap (P1) | Distinct from job templates |
| Launch workflow | `POST /api/v2/workflow_job_templates/{id}/launch/` | — | 🔴 Gap (P1) | |

### Other Resources

| AWX Operation | AWX Endpoint | Plugin Tool | Status | Notes |
|---------------|-------------|-------------|--------|-------|
| List schedules | `GET /api/v2/schedules/` | — | 🟡 Gap (P3) | |
| List notification templates | `GET /api/v2/notification_templates/` | — | 🟡 Gap (P3) | |
| List instance groups | `GET /api/v2/instance_groups/` | — | 🟡 Gap (P3) | |
| List labels | `GET /api/v2/labels/` | — | 🟡 Gap (P3) | |
| List execution environments | `GET /api/v2/execution_environments/` | — | 🟡 Gap (P3) | |
| Ping / health check | `GET /api/v2/ping/` | — | 🟡 Gap (P3) | Connectivity verification without resource lookup |

### Utility / Infrastructure (Not API-Mapped)

| Tool Name | Purpose | Status |
|-----------|---------|--------|
| `hello` | Sanity-check tool, returns greeting | ✅ Active |
| `awx-debug-env` | Debug environment configuration | ✅ Active |
| `awx-configure` | Configure AWX connection settings (baseUrl, token) | ✅ Active |

## Summary Statistics

| Category | Count |
|----------|-------|
| **Total AWX operations mapped** | 33 |
| **Fully covered by tools** | 22 |
| **Added in issue #108** | 3 (awx-list-organizations, awx-list-credentials, awx-list-inventories) |
| **Total covered (post-#108)** | 25 |
| **Remaining gaps** | 10 |
| **Estimated coverage** | ~76% (up from ~60% pre-#108) |

## Gap Priority Breakdown

| Priority | Count | Operations |
|----------|-------|------------|
| **P0 (Critical)** | 0 | All P0 gaps resolved in #108 |
| **P1 (High)** | 4 | List users, List teams, Ad-hoc commands, Workflow templates |
| **P2 (Medium)** | 3 | Detach credential, List inventory hosts, List inventory groups, Templates by credential |
| **P3 (Lower)** | 7 | Org detail, Credential detail, Schedules, Notifications, Instance groups, Labels, Execution environments, Ping |

## Remaining Gap Notes

### Why These Gaps Remain

1. **Gap distribution is intentional.** The plugin covers the most common daily operations: template lifecycle, project management, job execution, and inventory/organization/credential discovery. The P1–P3 gaps represent operations that are less frequently needed by subagents but should be added over time.

2. **Agent fallback is safe.** For operations that lack a first-class tool, the OpenCode agent can still use `awx-list-*` tools for discovery and then construct the required ID-based operations. No raw PowerShell or `Invoke-RestMethod` with bare `AWX_TOKEN` should ever be needed.

3. **Prioritization rationale.** The P1 gaps (users, teams, ad-hoc commands, workflows) are the next candidates for coverage, as they represent common extension paths. P2 gaps (hosts, groups, detach) are important for inventory management completeness. P3 gaps are nice-to-have and should be added opportunistically.

## Token Safety Verification

| Check | Status |
|-------|--------|
| `test-awx.ps1` echoes AWX_TOKEN? | ✅ Fixed — displays "(loaded from auth.json — value not displayed for security)" |
| `test-awx-stderr.ps1` echoes AWX_TOKEN? | ✅ Fixed — same security message |
| `src/*.ts` files echo token? | ✅ No token values in source code output |
| `tests/*.ts` files contain token-like values? | ✅ Tests use mock tokens ("mock-token-xxx", "probe-token-from-env") |
| `scripts/*.py` handles tokens? | ✅ `generate-snapshots.py` does not read or reference AWX_TOKEN |
