# AWX Tool-Gap Audit

**Date:** 2026-07-01
**Scope:** `packages/awx/` plugin
**Goal:** Identify gaps between available AWX REST API operations and the plugin's tool coverage, and recommend additions.

---

## Current Tool Coverage (18 tools)

| Tool | Endpoint / Action | Status |
|---|---|---|
| `hello` | — | Sanity check |
| `awx-sync-project` | POST /api/v2/projects/{id}/update/ | Done |
| `awx-list-templates` | GET /api/v2/job_templates/ | Done |
| `awx-list-projects` | GET /api/v2/projects/ | Done |
| `awx-list-jobs` | GET /api/v2/jobs/ | Done |
| `awx-launch-job` | POST /api/v2/job_templates/{id}/launch/ | Done |
| `awx-job-status` | GET /api/v2/jobs/{id}/ | Done |
| `awx-wait-job` | GET /api/v2/jobs/{id}/ (non-blocking) | Done |
| `awx-get-job-events` | GET /api/v2/jobs/{id}/job_events/ | Done |
| `awx-get-resource` | GET /api/v2/{type}/{id}/ | Done |
| `awx-attach-credential` | POST /api/v2/job_templates/{id}/credentials/ | Done |
| `awx-create-project` | POST /api/v2/projects/ | Done |
| `awx-update-project` | PATCH /api/v2/projects/{id}/ | Done |
| `awx-delete-project` | DELETE /api/v2/projects/{id}/ | Done |
| `awx-create-template` | POST /api/v2/job_templates/ | Done |
| `awx-update-template` | PATCH /api/v2/job_templates/{id}/ | Done |
| `awx-delete-template` | DELETE /api/v2/job_templates/{id}/ | Done |
| `awx-create-inventory` | POST /api/v2/inventories/ | Done |
| `awx-update-inventory` | PATCH /api/v2/inventories/{id}/ | Done |
| `awx-delete-inventory` | DELETE /api/v2/inventories/{id}/ | Done |
| `awx-debug-env` | N/A (env vars) | Done |
| `awx-configure` | N/A (custom config) | Done |

---

## Gap Categories

### P1 — Blocking (needed for basic AWX workflows)

These gaps prevent common AWX automation workflows from being fully automated through the plugin alone.

| # | Operation | Endpoint | Reason for Gap |
|---|---|---|---|
| 1 | **List credentials** | GET /api/v2/credentials/ | Agents cannot discover credential IDs needed for `awx-attach-credential`. Must have a way to list/search credentials. |
| 2 | **Get credential detail** | GET /api/v2/credentials/{id}/ | After attaching, agents need to verify credential properties (type, inputs). |
| 3 | **List organizations** | GET /api/v2/organizations/ | CRUD tools (create-project, create-inventory) require organization_id, but agents have no way to resolve org names to IDs. |
| 4 | **List inventories** | GET /api/v2/inventories/ | Agents need to discover inventory IDs for `awx-create-template` and `awx-update-template`. |

### P2 — High Value (enables new automation patterns)

These gaps block common automation patterns and require workarounds today.

| # | Operation | Endpoint | Reason for Gap |
|---|---|---|---|
| 5 | **Cancel job** | POST /api/v2/jobs/{id}/cancel/ | Agents can launch jobs but cannot cancel orphaned or misconfigured jobs. Critical for error recovery. |
| 6 | **List inventory hosts** | GET /api/v2/inventories/{id}/hosts/ | After inventory creation, agents need to verify or report host membership. |
| 7 | **List credential types** | GET /api/v2/credential_types/ | Agents need to know available credential types when creating or attaching credentials. |
| 8 | **Create credential** | POST /api/v2/credentials/ | Full credential lifecycle (create → attach → launch) is not possible without credential creation. |
| 9 | **List users** | GET /api/v2/users/ | Basic RBAC discovery — agents need to resolve user IDs for permissions workflows. |
| 10 | **List teams** | GET /api/v2/teams/ | Similar to users — needed for team-based credential and permission assignment. |

### P3 — Nice to Have (rounds out CRUD coverage)

These gaps are less critical but would make the plugin a complete AWX management interface.

| # | Operation | Endpoint | Reason for Gap |
|---|---|---|---|
| 11 | **Update credential** | PATCH /api/v2/credentials/{id}/ | Complete credential CRUD lifecycle. |
| 12 | **Delete credential** | DELETE /api/v2/credentials/{id}/ | Complete credential CRUD lifecycle. |
| 13 | **Detach credential** | POST /api/v2/job_templates/{id}/credentials/ (DELETE) | Symmetry with `awx-attach-credential`. AWX uses POST to attach, DELETE to detach (specific sub-URL). |
| 14 | **List job template credentials** | GET /api/v2/job_templates/{id}/credentials/ | Agents need to verify which credentials are already attached before attaching. |
| 15 | **List schedule** | GET /api/v2/job_templates/{id}/schedules/ | Agents managing template schedules need to discover existing schedules. |
| 16 | **Create schedule** | POST /api/v2/job_templates/{id}/schedules/ | Agents need to create scheduled job runs. |
| 17 | **List inventory groups** | GET /api/v2/inventories/{id}/groups/ | Post-creation inventory verification and group management. |
| 18 | **Ad-hoc command** | POST /api/v2/jobs/ (ad_hoc) | Running ad-hoc commands is a core AWX feature not covered by any tool. |
| 19 | **List notification templates** | GET /api/v2/notification_templates/ | Agents need to discover notification templates for job template configuration. |
| 20 | **Get instance info** | GET /api/v2/ping/ | Health-check / connectivity verification beyond what `awx-debug-env` provides. |

---

## Detected Anti-Patterns

1. **Credential ID hard-coding via `awx-configure`:** The `awx-configure` tool accepts a PAT token as a plain string argument. Subagents invoking this tool may inadvertently leak the token into conversation history or logs if the agent prints the tool output verbatim. Consider accepting the token through a dedicated auth flow or masked input only.

2. **No bulk/batch operations:** All tools operate on single resources. For workflows that require attaching multiple credentials to a template, the agent must loop — increasing latency and tool calls.

3. **No idempotency helper:** `awx-attach-credential` will return HTTP 409 if the credential is already attached. There's no "ensure attached" pattern — the agent must first list credentials, check membership, and conditionally attach. A `awx-ensure-credential` tool that handles this transparently would reduce agent complexity.

---

## Recommended Remediation Order

| Order | Gap | Tool Name | Effort | Impact |
|---|---|---|---|---|
| 1 | List credentials | `awx-list-credentials` | Small | Unlocks credential discovery |
| 2 | List organizations | `awx-list-organizations` | Small | Unlocks CRUD tools requiring org_id |
| 3 | List inventories | `awx-list-inventories` | Small | Symmetry with existing list tools |
| 4 | Cancel job | `awx-cancel-job` | Small | Error recovery for launched jobs |
| 5 | List credential types | `awx-list-credential-types` | Small | Supports credential creation flow |
| 6 | Create credential | `awx-create-credential` | Medium | Full credential lifecycle |
| 7 | Get credential detail | `awx-get-credential` | Small | Post-attach verification |
| 8 | List job template credentials | `awx-list-template-credentials` | Small | Pre-attach verification |
| 9 | List users | `awx-list-users` | Small | RBAC discovery |
| 10 | List teams | `awx-list-teams` | Small | Team-based credential assignment |
| 11 | Detach credential | `awx-detach-credential` | Small | Symmetry with attach |
| 12 | Update credential | `awx-update-credential` | Medium | Complete credential CRUD |
| 13 | Delete credential | `awx-delete-credential` | Medium | Complete credential CRUD |
| 14 | List schedules | `awx-list-schedules` | Small | Schedule discovery |
| 15 | Create schedule | `awx-create-schedule` | Medium | Schedule management |
| 16 | Instance info / ping | `awx-ping` | Small | Health check |
| 17 | List hosts | `awx-list-hosts` | Medium | Inventory verification |
| 18 | List groups | `awx-list-groups` | Small | Group discovery |
| 19 | List notification templates | `awx-list-notification-templates` | Small | Notification configuration |
| 20 | Ad-hoc command | `awx-adhoc-command` | Large | Core AWX feature |
| 21 | Ensure credential attached | `awx-ensure-credential` | Medium | Idempotent credential attachment |

---

## Summary

- **18 tools currently registered** (including `awx-attach-credential`)
- **20 gap operations identified** (4 P1, 6 P2, 10 P3)
- **21 recommended tools** including an `awx-ensure-credential` idempotency helper
- **1 anti-pattern** flagged in current `awx-configure` tool for PAT token handling
