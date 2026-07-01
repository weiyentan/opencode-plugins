# AWX Tool-Gap Audit

> **Date:** 2026-07-01
> **Audit:** Comprehensive comparison of the existing AWX plugin tool surface against the AWX REST API v2 surface.

## 1. Existing Tool Coverage

| Tool Name | AWX Endpoint | HTTP Method | Category |
|-----------|-------------|-------------|----------|
| `awx-list-templates` | `/api/v2/job_templates/` | GET | Read |
| `awx-list-projects` | `/api/v2/projects/` | GET | Read |
| `awx-list-jobs` | `/api/v2/jobs/` | GET | Read |
| `awx-launch-job` | `/api/v2/job_templates/{id}/launch/` | POST | Action |
| `awx-job-status` | `/api/v2/jobs/{id}/` | GET | Read |
| `awx-wait-job` | `/api/v2/jobs/{id}/` | GET | Read |
| `awx-get-job-events` | `/api/v2/jobs/{id}/job_events/` | GET | Read |
| `awx-get-resource` | `/api/v2/{projects,job_templates,inventories}/{id}/` | GET | Read |
| `awx-sync-project` | `/api/v2/projects/{id}/update/` | POST | Action |
| `awx-create-project` | `/api/v2/projects/` | POST | Create |
| `awx-update-project` | `/api/v2/projects/{id}/` | PATCH | Update |
| `awx-delete-project` | `/api/v2/projects/{id}/` | DELETE | Delete |
| `awx-create-template` | `/api/v2/job_templates/` | POST | Create |
| `awx-update-template` | `/api/v2/job_templates/{id}/` | PATCH | Update |
| `awx-delete-template` | `/api/v2/job_templates/{id}/` | DELETE | Delete |
| `awx-create-inventory` | `/api/v2/inventories/` | POST | Create |
| `awx-update-inventory` | `/api/v2/inventories/{id}/` | PATCH | Update |
| `awx-delete-inventory` | `/api/v2/inventories/{id}/` | DELETE | Delete |
| `awx-attach-credential` | `/api/v2/job_templates/{id}/credentials/` | POST | Action |
| `awx-configure` | (internal — no AWX API call) | — | Config |
| `awx-debug-env` | (internal — no AWX API call) | — | Debug |
| `hello` | (internal — no AWX API call) | — | Debug |

**Count:** 22 tools (19 AWX-facing, 3 internal).

### Coverage by Category

| Category | Count | Tools |
|----------|-------|-------|
| **Read (list)** | 3 | list-templates, list-projects, list-jobs |
| **Read (detail)** | 4 | job-status, wait-job, get-job-events, get-resource |
| **Create** | 3 | create-project, create-template, create-inventory |
| **Update** | 3 | update-project, update-template, update-inventory |
| **Delete** | 3 | delete-project, delete-template, delete-inventory |
| **Action** | 3 | launch-job, sync-project, attach-credential |
| **Config/Debug** | 3 | configure, debug-env, hello |

### What's Missing

The AWX API v2 surface exposes dozens of endpoints. Our current tool surface covers approximately **8 out of 25+ resource families**. Key absent categories:

- **Organizations** — no tools at all
- **Users / Teams / Roles** — no tools at all
- **Credentials** (full CRUD) — no tools at all (only attach-credential exists)
- **Inventories / Groups / Hosts** — partial (only inventory CRUD, no groups or hosts)
- **Job Templates** — partial (CRUD + launch, no survey, no notification, no labels)
- **Workflows** — no tools at all
- **Schedules** — no tools at all
- **Notifications** — no tools at all
- **Instance Groups / Execution Environments** — no tools at all
- **Settings / Config** — no tools at all
- **Inventory Source / Updates** — no tools at all
- **Ad-hoc Commands** — no tools at all

---

## 2. Gap Recommendations

Recommendations are ordered by expected utility for agent automation workflows.

### Tier 1: High-Priority Gaps (Job Running & Resource Management)

#### 1. `awx-list-credentials`
- **Endpoint:** `GET /api/v2/credentials/`
- **Rationale:** Agents need to discover credential IDs before using `awx-attach-credential` or setting up job templates. Critical dependency for credential management workflows.
- **Priority:** High

#### 2. `awx-list-inventories`
- **Endpoint:** `GET /api/v2/inventories/`
- **Rationale:** Existing `awx-get-resource` only fetches a single inventory by ID. A listing tool is needed for discovery. Complementary to `awx-create-inventory`.
- **Priority:** High

#### 3. `awx-list-organizations`
- **Endpoint:** `GET /api/v2/organizations/`
- **Rationale:** Every CRUD tool (project, template, inventory) requires `organization_id`. Agents currently have no way to discover organization IDs without scripting.
- **Priority:** High

#### 4. `awx-get-credential`
- **Endpoint:** `GET /api/v2/credentials/{id}/`
- **Rationale:** Fetches credential details (type, inputs, vault ID) for inspection and verification before attaching to templates.
- **Priority:** High

#### 5. `awx-list-workflow-job-templates`
- **Endpoint:** `GET /api/v2/workflow_job_templates/`
- **Rationale:** Workflows are a first-class AWX concept. Agents need to discover and interact with workflow templates, which are entirely uncovered.
- **Priority:** High

### Tier 2: Medium-Priority Gaps (Workflow & Automation)

#### 6. `awx-launch-workflow-job-template`
- **Endpoint:** `POST /api/v2/workflow_job_templates/{id}/launch/`
- **Rationale:** Natural parallel to `awx-launch-job` but for workflow templates. Required for any workflow-based automation.
- **Priority:** Medium

#### 7. `awx-list-schedules`
- **Endpoint:** `GET /api/v2/schedules/` (or per-resource like `/api/v2/job_templates/{id}/schedules/`)
- **Rationale:** Agents need to inspect scheduled jobs for diagnostics and audit. No schedule visibility exists in the current tool surface.
- **Priority:** Medium

#### 8. `awx-create-schedule`
- **Endpoint:** `POST /api/v2/job_templates/{id}/schedules/`
- **Rationale:** Allow agents to set up recurring job execution without manual AWX UI interaction.
- **Priority:** Medium

#### 9. `awx-list-users`
- **Endpoint:** `GET /api/v2/users/`
- **Rationale:** User discovery for permissions audit and team management. Currently no user/team/role tools exist.
- **Priority:** Medium

#### 10. `awx-list-hosts`
- **Endpoint:** `GET /api/v2/inventories/{id}/hosts/`
- **Rationale:** Host discovery within an inventory. Needed for any inventory management or ad-hoc command workflows.
- **Priority:** Medium

#### 11. `awx-list-application`
- **Endpoint:** `GET /api/v2/applications/`
- **Rationale:** OAuth2 application discovery for token management automation.
- **Priority:** Medium

### Tier 3: Lower-Priority Gaps (Management & Admin)

#### 12. `awx-cancel-job`
- **Endpoint:** `POST /api/v2/jobs/{id}/cancel/`
- **Rationale:** Allow agents to cancel long-running or stuck jobs. Currently agents have no way to stop a job once launched. Works as a complement to `awx-launch-job` / `awx-job-status`.
- **Priority:** Medium

#### 13. `awx-list-instance-groups`
- **Endpoint:** `GET /api/v2/instance_groups/`
- **Rationale:** Instance group discovery for capacity planning and execution environment placement. Important for clusters.
- **Priority:** Low

#### 14. `awx-list-execution-environments`
- **Endpoint:** `GET /api/v2/execution_environments/`
- **Rationale:** Execution environment discovery for job template configuration (the `execution_environment` field). Needed when creating/updating templates with custom EEs.
- **Priority:** Low

#### 15. `awx-get-job-stdout`
- **Endpoint:** `GET /api/v2/jobs/{id}/stdout/?format=txt`
- **Rationale:** The `awx-job-status` tool optionally includes stdout, but a dedicated stdout-fetch tool would be more bandwidth-efficient for large outputs. Allows agents to fetch output on demand without bloating the status response.
- **Priority:** Low

#### 16. `awx-list-notification-templates`
- **Endpoint:** `GET /api/v2/notification_templates/`
- **Rationale:** Notification template discovery for hooking job templates to alerting channels (email, Slack, webhook).
- **Priority:** Low

#### 17. `awx-update-inventory-source`
- **Endpoint:** `POST /api/v2/inventory_sources/{id}/update/`
- **Rationale:** Parallel to `awx-sync-project` but for inventory sources. Trigger SCM-based inventory updates on demand.
- **Priority:** Low

#### 18. `awx-get-dashboard`
- **Endpoint:** `GET /api/v2/dashboard/`
- **Rationale:** Agent-facing dashboard for health checks and cluster status overview. Useful for initial connection verification beyond just `/api/v2/me/`.
- **Priority:** Low

---

## 3. Coverage Summary

| Resource Domain | Existing Tools | Gap Tools Recommended | Status |
|----------------|---------------|----------------------|--------|
| **Job Templates** | list, get, create, update, delete, launch, attach-credential | survey, notification, schedule | Partial |
| **Jobs** | status, wait, events | cancel, stdout | Partial |
| **Projects** | list, get, create, update, delete, sync | — | Complete |
| **Inventories** | get, create, update, delete | list, hosts, sources | Partial |
| **Credentials** | attach-credential (only) | list, get, create, update, delete | Minimal |
| **Organizations** | — | list, get | None |
| **Users / Teams** | — | list, get | None |
| **Workflows** | — | list, launch | None |
| **Schedules** | — | list, create | None |
| **Notifications** | — | list templates | None |
| **Infrastructure** | — | instance-groups, execution-environments | None |
| **Config / Debug** | configure, debug-env | — | Complete |

**Total existing tools:** 19 AWX-facing tools  
**Total gap recommendations:** 18 new tools  
**Coverage rate:** ~19 of ~37 recommended tool endpoints covered (~51%)

---

## 4. Recommended Trajectory

| Phase | Focus | Tools to Add | Cumulative Coverage |
|-------|-------|-------------|-------------------|
| **Phase 1** (immediate) | Resource discovery | list-credentials, list-inventories, list-organizations, get-credential | 23 tools |
| **Phase 2** (next) | Workflow automation | list-workflow-job-templates, launch-workflow-job-template, cancel-job, list-schedules, create-schedule | 28 tools |
| **Phase 3** (near-term) | Admin & management | list-users, list-hosts, list-application, list-execution-environments, list-instance-groups | 33 tools |
| **Phase 4** (future) | Full coverage | get-job-stdout, list-notification-templates, update-inventory-source, get-dashboard | 37 tools |
