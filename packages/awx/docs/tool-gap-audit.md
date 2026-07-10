# AWX Plugin Tool Gap Audit

> **Generated:** 2026-07-01 for issue #108  
> **Scope:** Audit all existing AWX plugin tools against the AWX REST API surface and identify coverage gaps.  
> **Out of Scope:** Sandboxed API proxy (separate issue). This audit documents tool-level coverage only.

---

## Existing Tools (33 + hello)

| # | Tool | HTTP Method | Endpoint | Coverage |
|---|------|-------------|----------|----------|
| — | `hello` | — | — | Sanity-check tracer, not an AWX operation. |
| 1 | `awx-sync-project` | POST | `/api/v2/projects/{id}/update/` | Project SCM sync — covered. |
| 2 | `awx-list-templates` | GET | `/api/v2/job_templates/` | Template listing with pagination — covered. |
| 3 | `awx-list-projects` | GET | `/api/v2/projects/` | Project listing with pagination — covered. |
| 4 | `awx-list-jobs` | GET | `/api/v2/jobs/` | Job listing with pagination — covered. |
| 5 | `awx-launch-job` | POST | `/api/v2/job_templates/{id}/launch/` | Job launch with extra vars — covered. |
| 6 | `awx-job-status` | GET | `/api/v2/jobs/{id}/` | Job detail + optional stdout — covered. |
| 7 | `awx-wait-job` | GET | `/api/v2/jobs/{id}/` | Non-blocking status check (same endpoint) — covered. |
| 8 | `awx-get-job-events` | GET | `/api/v2/jobs/{id}/job_events/` | Job event log — covered. |
| 9 | `awx-get-resource` | GET | `/api/v2/{type}/{id}/` | Generic detail for template, project, inventory, user, team, schedule, notification_template — covered. |
| 10 | `awx-create-project` | POST | `/api/v2/projects/` | Project creation — covered. |
| 11 | `awx-create-template` | POST | `/api/v2/job_templates/` | Template creation — covered. |
| 12 | `awx-create-inventory` | POST | `/api/v2/inventories/` | Inventory creation — covered. |
| 13 | `awx-update-project` | PATCH | `/api/v2/projects/{id}/` | Project update — covered. |
| 14 | `awx-update-template` | PATCH | `/api/v2/job_templates/{id}/` | Template update — covered. |
| 15 | `awx-update-inventory` | PATCH | `/api/v2/inventories/{id}/` | Inventory update — covered. |
| 16 | `awx-delete-project` | DELETE | `/api/v2/projects/{id}/` | Project deletion — covered. |
| 17 | `awx-delete-template` | DELETE | `/api/v2/job_templates/{id}/` | Template deletion — covered. |
| 18 | `awx-delete-inventory` | DELETE | `/api/v2/inventories/{id}/` | Inventory deletion — covered. |
| 19 | `awx-debug-env` | — | — | Environment diagnostic — covered. |
| 20 | `awx-configure` | — | — | Runtime auth/baseUrl config — covered. |
| 21 | `awx-attach-credential` | POST | `/api/v2/job_templates/{id}/credentials/` | Credential attachment — covered. |
| 22 | `awx-create-user` | POST | `/api/v2/users/` | User creation — covered. |
| 23 | `awx-update-user` | PATCH | `/api/v2/users/{id}/` | User update — covered. |
| 24 | `awx-delete-user` | DELETE | `/api/v2/users/{id}/` | User deletion — covered. |
| 25 | `awx-create-team` | POST | `/api/v2/teams/` | Team creation — covered. |
| 26 | `awx-update-team` | PATCH | `/api/v2/teams/{id}/` | Team update — covered. |
| 27 | `awx-delete-team` | DELETE | `/api/v2/teams/{id}/` | Team deletion — covered. |
| 28 | `awx-create-schedule` | POST | `/api/v2/schedules/` | Schedule creation — covered. |
| 29 | `awx-update-schedule` | PATCH | `/api/v2/schedules/{id}/` | Schedule update — covered. |
| 30 | `awx-delete-schedule` | DELETE | `/api/v2/schedules/{id}/` | Schedule deletion — covered. |
| 31 | `awx-create-notification-template` | POST | `/api/v2/notification_templates/` | Notification template creation — covered. |
| 32 | `awx-update-notification-template` | PATCH | `/api/v2/notification_templates/{id}/` | Notification template update — covered. |
| 33 | `awx-delete-notification-template` | DELETE | `/api/v2/notification_templates/{id}/` | Notification template deletion — covered. |

**Total:** 34 tools (1 hello + 33 AWX operations). All are registered in `src/index.ts` via the `tool({})` pattern.

---

## AWX API Coverage Summary

| Resource | List | Detail | Create | Update | Delete | Other |
|----------|------|--------|--------|--------|--------|-------|
| Job Templates | ✅ | ✅ (via get-resource) | ✅ | ✅ | ✅ | Launch ✅, Attach credential ✅ |
| Projects | ✅ | ✅ (via get-resource) | ✅ | ✅ | ✅ | Sync ✅ |
| Inventories | ❌ | ✅ (via get-resource) | ✅ | ✅ | ✅ | — |
| Jobs | ✅ | ✅ | — | — | ❌ | Events ✅, Wait ✅ |
| Credentials | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Organizations | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Users | ❌ | ✅ (via get-resource) | ✅ | ✅ | ✅ | — |
| Teams | ❌ | ✅ (via get-resource) | ✅ | ✅ | ✅ | — |
| Inventory Sources | ❌ | ❌ | ❌ | ❌ | ❌ | Sync ❌ |
| Workflow JTs | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Schedules | ❌ | ✅ (via get-resource) | ✅ | ✅ | ✅ | — |
| Surveys | ❌ | ❌ | ❌ | ❌ | ❌ | Launch with survey ❌ |
| Notification Templates | ❌ | ✅ (via get-resource) | ✅ | ✅ | ✅ | — |
| Instance Groups | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Labels | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Hosts | ❌ | ❌ | ❌ | ❌ | ❌ | — |
| Groups | ❌ | ❌ | ❌ | ❌ | ❌ | — |

---

## High-Priority Gaps

These are the operations most likely needed by subagents and skills, ranked by estimated frequency in typical OpenCode usage:

### 1. Job Cancel (`POST /api/v2/jobs/{id}/cancel/`)
- **Risk without tool:** Agent runs a job, realizes it's wrong, but cannot cancel it — orphaned job consumes AAP resources.
- **Proposed tool:** `awx-cancel-job` — accepts `job_id`, calls POST cancel, returns status. Follows agent-side polling pattern (same as launch→wait).
- **Priority:** High — directly mitigates the "orphaned job" warning documented in `awx-wait-job`.

### 2. Credential List (`GET /api/v2/credentials/`)
- **Risk without tool:** Agent cannot discover available credential IDs to pass to `awx-attach-credential`, forcing inline scripts that expose tokens.
- **Proposed tool:** `awx-list-credentials` — paginated listing with ID, name, credential_type, and organization for each entry.
- **Priority:** High — completes the credential workflow initiated by issue #108.

### 3. Organization List (`GET /api/v2/organizations/`)
- **Risk without tool:** Agent cannot resolve organization IDs needed for `awx-create-project`, `awx-create-inventory`, etc.
- **Proposed tool:** `awx-list-organizations` — paginated listing with ID, name, description.
- **Priority:** High — prerequisite for any resource creation workflow.

### 4. Inventory List (`GET /api/v2/inventories/`)
- **Risk without tool:** Agent cannot discover available inventory IDs for `awx-create-template`.
- **Proposed tool:** `awx-list-inventories` — paginated listing with ID, name, kind, host_count.
- **Priority:** High — completing the triad of `list-templates`, `list-projects`, `list-inventories`.

---

## Medium-Priority Gaps

### 5. Workflow Job Template Operations
- `awx-list-workflows` (GET `/api/v2/workflow_job_templates/`)
- `awx-launch-workflow` (POST `/api/v2/workflow_job_templates/{id}/launch/`)
- CRUD operations mirroring template CRUD
- **Rationale:** Workflows are common in AAP for multi-step deployments. Without tools, complex orchestration requires manual scripting.

### 6. Job Relaunch (`POST /api/v2/jobs/{id}/relaunch/`)
- **Risk:** Agent cannot restart a failed job without rewriting all arguments.
- **Proposed tool:** `awx-relaunch-job` — accepts `job_id`, calls POST relaunch.

### 7. Inventory Source Sync (`POST /api/v2/inventory_sources/{id}/update/`)
- **Rationale:** Dynamic inventories that pull from cloud providers need periodic sync.
- **Proposed tool:** `awx-sync-inventory-source` — mirrors `awx-sync-project` pattern.

### 8. Schedule List (`GET /api/v2/schedules/`)
- **Risk without tool:** Agent cannot discover available schedule IDs for schedule management.
- **Proposed tool:** `awx-list-schedules` — paginated listing with ID, name, rrule, next_run, and associated unified job template.
- **Priority:** Medium — schedule create/update/delete already implemented; listing is the remaining gap.

---

## Low-Priority / Specialized Gaps

| Operation | Notes |
|-----------|-------|
| User / Team management | ✅ Implemented — create, update, delete, and detail via get-resource. List still needed. |
| Host CRUD | Can usually be managed via dynamic inventory sources. |
| Group CRUD | Same — inventory-driven patterns dominate. |
| Notification Templates | ✅ Implemented — create, update, delete, and detail via get-resource. List still needed. |
| Instance Groups | Cluster administration, out of scope for most agent workflows. |
| Labels | Can be piggybacked on create/update for resources that support them. |
| Survey management | Complex data model. A `awx-launch-with-survey` pattern may be simpler than full survey CRUD. |
| Ad Hoc Commands | AAA (`/api/v2/hosts/{id}/ad_hoc_commands/`). Very narrow use case. |

---

## Gap Count Summary

| Priority | Count | Examples |
|----------|-------|----------|
| High | 4 | job cancel, credential list, organization list, inventory list |
| Medium | 3 | workflow ops, job relaunch, inventory source sync |
| Low | 3+ | hosts, groups, instance groups, labels, surveys |
| **Total uncovered** | **10+** | |

---

## Notes

- **Credential attachment (issue #108)** fills a critical gap in the `Job Templates` row — previously `POST /api/v2/job_templates/{id}/credentials/` had no tool coverage. With `awx-attach-credential`, the most dangerous manual-inline-script pattern (which exposed PAT tokens) is eliminated.
- **The sandboxed API proxy** (separate concern, out of scope for this issue) would provide a general-purpose pass-through for any AWX endpoint. This would cover many of the low-priority gaps at the cost of losing structured tool contracts and input validation.
- **Distinguishing `awx-get-resource` from dedicated list tools:** `awx-get-resource` covers detail views for template/project/inventory but does not cover listing. Dedicated `awx-list-inventories` and `awx-list-organizations` tools are still needed for the agent to discover resource IDs.
