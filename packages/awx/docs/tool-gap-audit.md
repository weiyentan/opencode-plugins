# AWX Plugin — Tool Coverage Audit

> Combining audits from issue #108 (PAT leakage risk) and issue #109 (tool-gap coverage).

## Purpose

This document identifies gaps in the AWX plugin's tool coverage. When a needed AWX API operation lacks a first-class tool, the OpenCode agent falls back to writing inline PowerShell scripts that embed the bearer token in plain text — exposing the PAT to the agent's output stream, conversation history, and any inadvertent copy-paste. Each gap listed below represents a PAT leakage risk.

## Severity

| Tier | Criteria |
|------|----------|
| **HIGH** | Agent **will** write inline scripts; PAT exposure is highly probable. |
| **MEDIUM** | Agent **may** write inline scripts; PAT exposure depends on workflow. |
| **LOW** | Inline scripts are unlikely or the operation is rarely needed. |

---

## Existing Tools (22 tools)

| # | Tool Name | AWX API Endpoint | HTTP Method | Category |
|---|---|---|---|---|
| 1 | `hello` | N/A | N/A | Scaffolding |
| 2 | `awx-debug-env` | N/A | N/A | Diagnostics |
| 3 | `awx-configure` | N/A | N/A | Configuration |
| 4 | `awx-list-templates` | `/api/v2/job_templates/` | GET | Read (List) |
| 5 | `awx-list-projects` | `/api/v2/projects/` | GET | Read (List) |
| 6 | `awx-list-jobs` | `/api/v2/jobs/` | GET | Read (List) |
| 7 | `awx-get-resource` | Dispatched (template/project/inventory) | GET | Read (Detail) |
| 8 | `awx-launch-job` | `/api/v2/job_templates/{id}/launch/` | POST | Job Lifecycle |
| 9 | `awx-job-status` | `/api/v2/jobs/{id}/` | GET | Job Lifecycle |
| 10 | `awx-wait-job` | `/api/v2/jobs/{id}/` | GET | Job Lifecycle |
| 11 | `awx-get-job-events` | `/api/v2/jobs/{id}/job_events/` | GET | Job Lifecycle |
| 12 | `awx-sync-project` | `/api/v2/projects/{id}/update/` | POST | Project Operations |
| 13 | `awx-create-project` | `/api/v2/projects/` | POST | CRUD |
| 14 | `awx-create-template` | `/api/v2/job_templates/` | POST | CRUD |
| 15 | `awx-create-inventory` | `/api/v2/inventories/` | POST | CRUD |
| 16 | `awx-update-project` | `/api/v2/projects/{id}/` | PATCH | CRUD |
| 17 | `awx-update-template` | `/api/v2/job_templates/{id}/` | PATCH | CRUD |
| 18 | `awx-update-inventory` | `/api/v2/inventories/{id}/` | PATCH | CRUD |
| 19 | `awx-delete-project` | `/api/v2/projects/{id}/` | DELETE | CRUD |
| 20 | `awx-delete-template` | `/api/v2/job_templates/{id}/` | DELETE | CRUD |
| 21 | `awx-delete-inventory` | `/api/v2/inventories/{id}/` | DELETE | CRUD |
| 22 | `awx-attach-credential` | `/api/v2/job_templates/{id}/credentials/` | POST | Credential Operations |

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

## Gap Audit: Uncovered Operations (21 gaps)

### Gap 1 — List Credentials
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/credentials/` |
| **Severity** | **HIGH** |
| **Rationale** | Agents need credential IDs to use `awx-attach-credential`. Without a list tool, the agent writes `Invoke-RestMethod -Headers @{Authorization="Bearer $PAT"} https://example.com/api/v2/credentials/` — exposing the PAT. |
| **Suggested tool** | `awx-list-credentials` — paginated list of credentials with type, name, organization. |

### Gap 2 — Get Credential Detail
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/credentials/{id}/` |
| **Severity** | **HIGH** |
| **Rationale** | To choose the right credential, the agent needs to see credential type, inputs, and associated org. Inline `Invoke-RestMethod` exposes the PAT. |
| **Suggested tool** | `awx-get-credential` — or extend `awx-get-resource` to support `type: "credential"`. |

### Gap 3 — Detach Credential from Template
| Field | Value |
|-------|-------|
| **Endpoint** | `POST /api/v2/job_templates/{id}/credentials/` (with `disassociate: true`) |
| **Severity** | **HIGH** |
| **Rationale** | The symmetric opposite of `awx-attach-credential`. Agents need to remove mismatched credentials. The most direct PAT exposure risk — the same endpoint, just a different body. |
| **Suggested tool** | `awx-detach-credential` — accepts `template_id` and `credential_id`. |

### Gap 4 — Cancel a Running Job
| Field | Value |
|-------|-------|
| **Endpoint** | `POST /api/v2/jobs/{id}/cancel/` |
| **Severity** | **HIGH** |
| **Rationale** | When a job runs too long or the agent session is interrupted, the agent needs to cancel it. Currently requires a raw POST with the PAT in headers. |
| **Suggested tool** | `awx-cancel-job` — thin proxy for the cancel endpoint. |

### Gap 5 — Relaunch a Job
| Field | Value |
|-------|-------|
| **Endpoint** | `POST /api/v2/jobs/{id}/relaunch/` |
| **Severity** | **MEDIUM** |
| **Rationale** | Relaunching a failed job with the same parameters is a common admin workflow. Agents currently write raw POSTs. |
| **Suggested tool** | `awx-relaunch-job` — thin proxy, optionally with overridden extra_vars. |

### Gap 6 — List Inventories
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/inventories/` |
| **Severity** | **HIGH** |
| **Rationale** | `awx-get-resource` handles individual inventory lookups, but agents need to discover inventory IDs for template creation. The lack of a list tool forces raw GETs with PAT in headers. |
| **Suggested tool** | `awx-list-inventories` — paginated list, filtered by organization. |

### Gap 7 — List Organizations
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/organizations/` |
| **Severity** | **HIGH** |
| **Rationale** | Every create operation requires an `organization_id`. Without a list tool, agents must resolve org IDs by name using raw API calls → PAT leakage. |
| **Suggested tool** | `awx-list-organizations` — paginated, with name filtering. |

### Gap 8 — List Credential Types
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/credential_types/` |
| **Severity** | **MEDIUM** |
| **Rationale** | When creating credentials, agents need to know valid credential types (Machine, Source Control, Vault, etc.). Without a list tool, they query the API directly. |
| **Suggested tool** | `awx-list-credential-types` — simple paginated list. |

### Gap 9 — List Instance Groups
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/instance_groups/` |
| **Severity** | **LOW** |
| **Rationale** | Instance group assignment is rare in agent workflows, but when required, forces a raw GET. |
| **Suggested tool** | `awx-list-instance-groups` — paginated list. |

### Gap 10 — Workflow Job Template CRUD
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/workflow_job_templates/`, `GET /api/v2/workflow_job_templates/{id}/` |
| **Severity** | **MEDIUM** |
| **Rationale** | Workflow templates are used for complex automation. Listing and inspecting them requires raw API calls exposing the PAT. |
| **Suggested tool** | `awx-list-workflow-templates` — paginated, with detail view. |

### Gap 11 — Launch Workflow Job
| Field | Value |
|-------|-------|
| **Endpoint** | `POST /api/v2/workflow_job_templates/{id}/launch/` |
| **Severity** | **MEDIUM** |
| **Rationale** | Workflow launching is a natural extension of job launching. Currently requires raw POST with PAT. |
| **Suggested tool** | `awx-launch-workflow` — same pattern as `awx-launch-job`. |

### Gap 12 — List Inventory Hosts
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/inventories/{id}/hosts/` |
| **Severity** | **MEDIUM** |
| **Rationale** | Agents configuring targets need to enumerate hosts. Currently requires `Invoke-RestMethod` with the PAT in the auth header. |
| **Suggested tool** | `awx-list-hosts` — paginated, filtered by inventory ID. |

### Gap 13 — List Inventory Groups
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/inventories/{id}/groups/` |
| **Severity** | **LOW** |
| **Rationale** | Group enumeration is less common but still forces a raw GET when needed. |
| **Suggested tool** | `awx-list-groups` — paginated, filtered by inventory ID. |

### Gap 14 — Get Job Template Survey
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/job_templates/{id}/survey_spec/` |
| **Severity** | **MEDIUM** |
| **Rationale** | Survey-enabled templates require the agent to know what questions to answer. Without a survey tool, the agent fetches the survey spec via raw GET → PAT exposure. |
| **Suggested tool** | `awx-get-survey` — returns survey_spec JSON. |

### Gap 15 — Create Credential
| Field | Value |
|-------|-------|
| **Endpoint** | `POST /api/v2/credentials/` |
| **Severity** | **MEDIUM** |
| **Rationale** | Agents that provision new AWX resources may need to create credentials. The create operation carries sensitive input data (keys, passwords) that must never appear in tool output. This is a security-sensitive gap. |
| **Suggested tool** | `awx-create-credential` — thin proxy. Tool output must NOT echo credential inputs. |

### Gap 16 — Get Project Update Status
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/project_updates/{id}/` |
| **Severity** | **MEDIUM** |
| **Rationale** | After `awx-sync-project` returns a `project_update_id`, the agent needs to check whether the sync succeeded or failed. No tool exists, so agents poll via raw GET. |
| **Suggested tool** | `awx-project-update-status` — returns status, stdout, and elapsed time. |

### Gap 17 — List Labels
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/labels/` |
| **Severity** | **LOW** |
| **Rationale** | Label assignment is optional metadata. Rare enough that PAT exposure risk is low, but listing labels is a natural query. |
| **Suggested tool** | `awx-list-labels` — paginated, filtered by organization. |

### Gap 18 — Get Activity Stream
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/activity_stream/` |
| **Severity** | **LOW** |
| **Rationale** | Activity stream is useful for auditing what changed and when. Rare agent workflows but forces raw GET when needed. |
| **Suggested tool** | `awx-list-activity` — paginated with time-range and resource-type filters. |

### Gap 19 — List Job Template Access List
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/job_templates/{id}/access_list/` |
| **Severity** | **LOW** |
| **Rationale** | Permission audits on templates. Rarely needed by agents, but exposed when it is. |
| **Suggested tool** | `awx-get-access-list` — return who has access to a template. |

### Gap 20 — List Execution Environments
| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/v2/execution_environments/` |
| **Severity** | **LOW** |
| **Rationale** | Execution environment selection matters for AWX 21+, but agents rarely need to list them. |
| **Suggested tool** | `awx-list-execution-environments` — paginated list. |

### Gap 21 — Create Host in Inventory
| Field | Value |
|-------|-------|
| **Endpoint** | `POST /api/v2/inventories/{id}/hosts/` |
| **Severity** | **MEDIUM** |
| **Rationale** | Agent-driven host provisioning requires adding hosts to inventories. Raw POST with PAT in headers is the current path. |
| **Suggested tool** | `awx-create-host` — thin proxy for inventory host creation. |

---

## Summary

### PAT Exposure Risk Summary (from issue #108)

| Severity | Count | Urgency |
|----------|-------|---------|
| **HIGH** (PAT leakage highly probable) | 6 | Address first |
| **MEDIUM** (PAT leakage possible) | 9 | Short-term roadmap |
| **LOW** (rare exposure risk) | 6 | Nice-to-have |
| **TOTAL** | 21 | — |

### Tool Coverage Summary (from issue #109)

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

### Priority Implementation Order

1. `awx-list-credentials` — Prerequisite for using `awx-attach-credential` effectively
2. `awx-detach-credential` — Symmetric operation, same endpoint family
3. `awx-list-inventories` — Prerequisite for template creation
4. `awx-list-organizations` — Prerequisite for all create operations
5. `awx-cancel-job` — Safety-critical for long-running jobs
6. `awx-get-credential` — Needed to inspect credential details before attaching

---

*Combined from issue #108 ("Subagent inline scripts expose AWX PAT tokens in plain text") and issue #109 ("AWX tool-gap audit").*
