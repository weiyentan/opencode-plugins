# PRD: AWX CRUD Actions

## Problem Statement

The AWX plugin currently supports only a subset of resource lifecycle operations: listing (GET collection), reading detail (GET single), and action-based POST (launch job, sync project). Users cannot create, update, or delete AWX resources (templates, projects, inventories) through the plugin. This forces users to drop out of the OpenCode agent workflow and use the AWX web UI or CLI for basic resource management.

## Solution

Add nine new tools to the AWX plugin — create, update, and delete for three resource types (job templates, projects, inventories). These tools follow a hybrid architecture: dedicated agent-facing tool registrations for strong argument validation and discoverability, backed by a shared internal CRUD module that eliminates duplication.

## User Stories

1. As an OpenCode agent, I want to **create a job template** with a name, project, inventory, and playbook, so that I can define new automation workflows without leaving the agent session.
2. As an OpenCode agent, I want to **update a job template** by PATCHing specific fields (e.g., rename it, change the playbook, switch inventory), so that I can modify existing templates incrementally.
3. As an OpenCode agent, I want to **delete a job template** by ID, so that I can clean up deprecated or test templates.
4. As an OpenCode agent, I want to **create a project** with an SCM URL, branch, and name, so that I can register new source code repositories with AWX.
5. As an OpenCode agent, I want to **update a project** (e.g., change its SCM URL or branch), so that I can keep project definitions current.
6. As an OpenCode agent, I want to **delete a project** by ID, so that I can remove projects that are no longer needed.
7. As an OpenCode agent, I want to **create an inventory** with a name and organization, so that I can set up new host inventories.
8. As an OpenCode agent, I want to **update an inventory** (e.g., rename it or change its variables), so that I can adjust inventory definitions.
9. As an OpenCode agent, I want to **delete an inventory** by ID, so that I can remove obsolete inventories.
10. As a developer, I want the tools to surface AWX API errors verbatim, so that diagnostic information is not lost in translation.
11. As a developer, I want the internal CRUD logic to be unit-testable with mocks, so that we can validate endpoint construction and error wrapping without a live AWX instance.
12. As a developer, I want a regression test that catches accidental addition of non-Plugin exports to `src/index.ts`, so that the ADR 0007 loader crash does not reoccur.

## Implementation Decisions

### Tool Surface: 9 dedicated tools

| Tool | Resource | Action | HTTP Method |
|------|----------|--------|-------------|
| `awx-create-template` | Job Template | Create | POST `/job_templates/` |
| `awx-update-template` | Job Template | Update | PATCH `/job_templates/{id}/` |
| `awx-delete-template` | Job Template | Delete | DELETE `/job_templates/{id}/` |
| `awx-create-project` | Project | Create | POST `/projects/` |
| `awx-update-project` | Project | Update | PATCH `/projects/{id}/` |
| `awx-delete-project` | Project | Delete | DELETE `/projects/{id}/` |
| `awx-create-inventory` | Inventory | Create | POST `/inventories/` |
| `awx-update-inventory` | Inventory | Update | PATCH `/inventories/{id}/` |
| `awx-delete-inventory` | Inventory | Delete | DELETE `/inventories/{id}/` |

Each tool has its own Zod argument schema with resource-specific fields. The agent provides resolved related-resource IDs (e.g., `project_id`, `inventory_id` for templates) — no internal name-to-ID resolution.

### Internal Module: `crud.ts`

A shared internal module with a registry mapping `{ resource, action }` → `{ endpoint, method }`. Pattern follows the existing `get-resource.ts` generic dispatch. All nine tool stubs in `index.ts` delegate to this module.

```typescript
// Registry shape (not the exact code — encode the decision):
const REGISTRY = {
  template: {
    create: { method: "POST", path: () => "/job_templates/" },
    update: { method: "PATCH", path: (id) => `/job_templates/${id}/` },
    delete: { method: "DELETE", path: (id) => `/job_templates/${id}/` },
  },
  project:  { ... },
  inventory:{ ... },
};
```

### Output Contract: `resource-mutation.ts`

A single generic contract for all mutation tools:

```typescript
{
  schema_version: "1.0",
  action: "created" | "updated" | "deleted",
  resource_type: "template" | "project" | "inventory",
  id: number,
  data: object | null,   // full resource detail for create/update, null for delete
  warnings?: string[],
  errors?: string[],
}
```

For create and update responses, `data` reuses the existing mapper functions (`mapTemplateDetail`, `mapProjectDetail`, `mapInventoryDetail`) so that resolved resource names are returned to the agent.

### Error Handling

Errors from the AWX API are surfaced verbatim in the `errors` field of the output contract. The tools do **not** attempt to guard against constraint violations (e.g., deleting a project that has dependent job templates) — AWX's API already returns clear error messages for these cases.

### Export Hygiene Constraint

Per ADR 0007 (`docs/adr/0007-plugin-entry-point-export-hygiene.md`), the OpenCode plugin server crashes at startup if `src/index.ts` exports anything other than the `Plugin` function. The new tool registrations are defined inside the `tool: {}` return value of the server function — they are **not** module-level exports — so they pose no risk.

A regression test already exists at `tests/index.test.ts` line 783 (`"export surface contains only AwxPlugin and default"`) that dynamically imports the module and checks `Object.keys(importedModule)`. This test must be maintained and must pass after adding the nine new tool registrations.

## Testing Decisions

### What makes a good test
- Tests should verify external behavior, not implementation details of `crud.ts`
- Mock the HTTP layer so no live AWX is required
- Verify that the correct endpoint, HTTP method, and body are used for each resource/action combination

### Modules to test

| Module | Test Type | What to verify |
|--------|-----------|----------------|
| `crud.ts` | Unit (mocked HTTP) | Endpoint construction, method selection, request body passthrough, error wrapping |
| `resource-mutation.ts` contract | Unit | Envelope shape — `schema_version`, `action`, `resource_type`, `id`, `data`, `errors` |
| `src/index.ts` tool registration | Unit (via existing `index.test.ts`) | Each new tool is callable and returns expected envelope shape |
| `src/index.ts` export hygiene | Regression | Existing test at `tests/index.test.ts:783` verifies no non-Plugin exports leak out |

### Prior art
- `tests/get-resource-tool.test.ts` — tests the generic get-resource dispatch pattern with mocked HTTP; the new `crud.ts` tests follow this same approach
- `tests/index.test.ts` — tests tool registrations in the hooks return value; new tool registrations add test cases in the same describe block
- `tests/index.test.ts:777-785` — existing module export hygiene test that guards against ADR 0007 regression

## Out of Scope

- Other AWX resource types (credentials, organizations, users, hosts, inventory groups, schedules, notification templates, etc.)
- Integration tests against a live AWX instance
- Name-to-ID resolution inside tools (agent must provide resolved IDs)
- Bulk create/update/delete operations
- Soft-delete or restore operations
- Field-level validation beyond what the AWX API provides
- Changes to existing tools (`awx-launch-job`, `awx-get-resource`, list tools, etc.)

## Further Notes

- All nine tools are additive — zero existing tool contracts or behavior changes
- The module layout adds two files (`crud.ts`, `contracts/resource-mutation.ts`) and modifies one file (`index.ts`) with ~9 small tool stubs
- The `crud.ts` registry is easily extensible — adding a new resource type later requires one registry entry + three small tool stubs
