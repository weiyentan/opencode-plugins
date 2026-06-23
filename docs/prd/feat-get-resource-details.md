# AWX Plugin — Generalized Resource Detail Getter (awx-get-resource)

## Problem Statement

The AWX OpenCode plugin currently exposes only one individual resource detail getter: `awx-job-status`, which fetches job details from `GET /api/v2/jobs/<id>/`. There is no way for an agent to fetch individual details for other core AWX resource types — job templates, projects, or inventories — without resorting to list-and-filter workarounds or delegating to the deprecated `awx-helper.ps1` PowerShell script.

The legacy `awx-helper.ps1` had dedicated `get-template`, `get-project`, `get-inventory`, `get-credential`, `get-organization`, and `get-host` actions, none of which have plugin replacements. Council gap documents identified `get-template` as the highest-priority pain point: when an agent needs to inspect a specific template's configuration (playbook path, verbosity, associated inventory), it must list all templates and manually correlate, which is brittle and wasteful.

Without individual getters, the agent cannot answer targeted questions like "What playbook does template 12 use?" or "What is the SCM URL for project 8?" without fetching and filtering entire collections — increasing latency, API load, and token usage.

## Solution

Add a single generalized tool `awx-get-resource` that accepts a `type` discriminator and numeric `id`, fetches the corresponding AWX API endpoint, maps the raw JSON through a type-specific pure function, and returns a structured output envelope. The tool supports three resource types in v1: **template**, **project**, and **inventory**.

The architecture follows the established three-layer pattern from `awx-job-status`:
1. **Tool registration** in `index.ts` — one new tool registration
2. **Shared orchestrator** (`get-resource.ts`) — API path construction via a type→endpoint registry, `client.request()`, and dispatch to the correct per-resource mapper
3. **Per-resource mappers** (`mappers/map-template.ts`, `mappers/map-project.ts`, `mappers/map-inventory.ts`) — pure functions mapping raw API JSON → structured output
4. **Structured contracts** (`contracts/template-detail.ts`, `contracts/project-detail.ts`, `contracts/inventory-detail.ts`) — TypeScript interfaces defining the output shape per resource

This eliminates the shell-script dependency for individual resource inspection and fills the highest-priority gap in the Tool-Action Mapping Table.

## User Stories

1. As an operator debugging a job template, I want to fetch a single template's configuration by ID (playbook path, verbosity, inventory association, job type), so that I can diagnose why a launch is failing without listing all templates.

2. As an operator inspecting a project, I want to fetch a single project's details by ID (SCM type, SCM URL, SCM branch, status, organization), so that I can verify the project is configured correctly.

3. As an operator auditing inventory sources, I want to fetch a single inventory's details by ID (host count, group count, kind, variables), so that I can quickly assess inventory health without listing everything.

4. As an agent implementing a workflow, I want a single tool that handles multiple resource types via a `type` discriminator, so that I don't need to memorise separate tools for each resource.

5. As a plugin maintainer, I want per-resource mappers to be pure functions with no side effects, so that they are trivially unit-testable and independent of the HTTP layer.

6. As a developer extending the plugin, I want a clear registry pattern for adding new resource types, so that adding `credential` or `host` in a future iteration requires minimal boilerplate.

7. As a reviewer, I want each resource type to have an explicit TypeScript contract interface, so that the output shape is documented, typed, and versionable.

## Implementation Decisions

### Module Structure

```
packages/awx/src/
├── index.ts                              ← Tool registration (1 new tool: awx-get-resource)
├── get-resource.ts                       ← NEW: Shared orchestrator + type→endpoint registry
├── client.ts                             ← No change
├── contracts/
│   ├── job-detail.ts                     ← Existing
│   ├── sync-project.ts                   ← Existing
│   ├── template-detail.ts                ← NEW
│   ├── project-detail.ts                 ← NEW
│   └── inventory-detail.ts               ← NEW
└── mappers/
    ├── map-template.ts                   ← NEW
    ├── map-project.ts                    ← NEW
    └── map-inventory.ts                  ← NEW
```

### Tool Interface

- **Tool name:** `awx-get-resource`
- **Arguments:**
  - `type` (string, required) — Resource type discriminator. One of: `"template"`, `"project"`, `"inventory"`
  - `id` (number, required, positive integer) — The AWX numeric ID of the resource
- **Returns:** A structured output envelope (see Output Envelope below)
- **Error handling:** Follows the existing pattern — abort signal check at top of `execute()`, lazy `getAwxClient()` resolution, try/catch returning user-facing error messages. For unknown resource types, returns an actionable error message listing supported types.

### Shared Orchestrator (`get-resource.ts`)

The `getResource()` function is the central dispatcher:

```typescript
const RESOURCE_ENDPOINTS = {
  template: "/api/v2/job_templates/",
  project: "/api/v2/projects/",
  inventory: "/api/v2/inventories/",
} as const;

async function getResource(
  client: AwxClient,
  type: ResourceType,
  id: number,
  abortSignal?: AbortSignal,
  toolName?: string,
): Promise<ResourceOutput>;
```

- Looks up the endpoint path from the registry
- Calls `client.request(toolName, path, undefined, abortSignal)`
- If response is not OK, throws with status + body context (same pattern as `job-status.ts`)
- Parses JSON, dispatches to the correct mapper based on `type`
- Returns the structured output envelope

### Per-Resource Mappers

Each mapper is a pure function that takes the raw AWX API JSON response and returns a typed, structured output. Mappers resolve `summary_fields` into human-readable names (mirroring the pattern used in `mapAwxJobToContract` for `related` fields).

**`map-template.ts` — maps from `GET /api/v2/job_templates/<id>/`:**
- `id`, `name`, `description`, `job_type` (run/check/scan)
- `inventory` → resolved name (from `summary_fields.inventory.name`)
- `project` → resolved name (from `summary_fields.project.name`)
- `playbook`, `verbosity`
- `ask_variables_on_launch`, `ask_inventory_on_launch`, `ask_limit_on_launch`
- `last_job_run` (timestamp string), `status`, `next_schedule`
- `related.inventory_name`, `related.project_name`, `related.organization_name`
- `summary_fields.labels.results[]` → `label_names: string[]`

**`map-project.ts` — maps from `GET /api/v2/projects/<id>/`:**
- `id`, `name`, `scm_type`, `scm_url`, `scm_branch`
- `status` (e.g., "never updated", "ok", "failed")
- `last_updated` (timestamp string)
- `organization_name` (resolved from `summary_fields.organization.name`)

**`map-inventory.ts` — maps from `GET /api/v2/inventories/<id>/`:**
- `id`, `name`, `description`
- `kind` (e.g., `""` for normal, `"smart"` for smart inventory)
- `organization_name` (resolved from `summary_fields.organization.name`)
- `host_count`, `total_groups`, `has_inventory_sources`, `total_inventory_sources`
- `variables` (raw JSON string, included only if non-empty)

### Output Envelope

Every resource type returns a consistent top-level envelope:

```typescript
interface ResourceOutput {
  schema_version: "1.0";
  resource_type: "template" | "project" | "inventory";
  id: number;
  data: Record<string, unknown>;   // type-specific mapped fields
  related?: Record<string, string>; // resolved names (optional, type-dependent)
}
```

This is intentionally lighter than the `JobDetailOutput` contract — no `host_status_counts` or `derived` booleans since those are job-specific concepts.

### Client / Middleware Pipeline

No changes to `client.ts`. The new tool reuses the existing `AwxClient.request()` method with its full middleware pipeline (abort signal → timeout → circuit breaker gate → fetch → retry/backoff) and the shared `MetricsStore` for per-tool call/error/latency accounting.

### Tool Registration in `index.ts`

The tool is registered alongside existing tools in the `server()` function's `tool` hooks object. It follows the same pattern: `tool({ description, args, execute })` with abort signal respect, lazy client resolution via `getAwxClient()`, and try/catch returning user-facing error messages.

### Deferred Refactoring

The existing `awx-sync-project` tool inlines its own project-fetching logic (`GET /api/v2/projects/<id>/` inside its execute handler). A future refactoring could make `awx-sync-project` delegate to the project mapper, but this is **out of scope for v1** to avoid scope creep.

## Testing Decisions

### What makes a good test

- **Mapper unit tests** verify that given a known raw API JSON fixture, the mapper produces the expected structured output. These are pure functions — no mocks, no HTTP, no side effects. Prior art: `job-status.test.ts` which tests `mapAwxJobToContract()` with inline fixture data.
- **Shared helper tests** (`get-resource.test.ts`) mock `client.request()` to verify registry dispatch, correct endpoint construction, error propagation (404, 401, network errors), and unknown type handling.
- **Contract validation tests** verify that mapper output conforms to the TypeScript contract interface at runtime (e.g., required fields are present, types are correct). Prior art: `contract.test.ts` which uses runtime checks.
- **No integration tests** against a live AAP for v1 (can be added as a follow-up when infrastructure CI is available).

### Modules to Test

| Test file | What it tests | Prior art |
|-----------|---------------|-----------|
| `tests/mappers/map-template.test.ts` | `mapTemplateToContract()` with raw API fixture | `tests/job-status.test.ts` |
| `tests/mappers/map-project.test.ts` | `mapProjectToContract()` with raw API fixture | `tests/job-status.test.ts` |
| `tests/mappers/map-inventory.test.ts` | `mapInventoryToContract()` with raw API fixture | `tests/job-status.test.ts` |
| `tests/get-resource.test.ts` | `getResource()` dispatcher, registry, errors | `tests/job-status.test.ts`, `tests/sync-project.test.ts` |
| `tests/contracts/resource-contracts.test.ts` | Runtime contract validation for all three resource output types | `tests/contract.test.ts` |

### Fixture Strategy

Test fixtures are inline objects representing the relevant subset of AWX API JSON responses (mirroring how `job-status.test.ts` defines its `mockRawAwxJob` fixture). If the fixture grows large, extract to `tests/fixtures/` directory following existing conventions.

### Running Tests

```bash
cd packages/awx
npm test          # vitest — runs all unit tests
npm run lint      # tsc --noEmit — type checking
```

## Out of Scope

- **Additional resource types**: Credentials, organizations, hosts, and other AWX resource types are explicitly deferred.
- **Generic pass-through mode**: No raw JSON / un-mapped output mode. Every resource type has a structured contract.
- **Refactoring `awx-sync-project`**: The existing `awx-sync-project` tool inlines its own project fetch. Reusing the project mapper from `awx-sync-project` is deferred to a separate issue.
- **Integration tests against live AAP**: v1 is unit-test only. Integration tests require AAP CI infrastructure.
- **List operations**: This PRD covers only individual resource detail getters. List operations (`awx-list-templates`, `awx-list-projects`) already exist.
- **Output contract version negotiation**: The `schema_version` is always `"1.0"` for v1. No version negotiation or migration logic.
- **Caching**: No client-side caching of resource details. Every call fetches fresh from AWX.
- **Bulk operations**: No batch fetch or multi-ID support. Single resource per call.

## Further Notes

### Tool-Action Mapping Table Gap Closure

This PRD closes the three highest-priority gaps in the Tool-Action Mapping Table:

| `awx-helper.ps1` action | Plugin replacement | Status |
|-------------------------|-------------------|--------|
| `get-template` | `awx-get-resource` with `type: "template"` | **v1** |
| `get-project` | `awx-get-resource` with `type: "project"` | **v1** |
| `get-inventory` | `awx-get-resource` with `type: "inventory"` | **v1** |
| `get-credential` | `awx-get-resource` with `type: "credential"` | Deferred |
| `get-organization` | `awx-get-resource` with `type: "organization"` | Deferred |
| `get-host` | `awx-get-resource` with `type: "host"` | Deferred |

### Distinguished from `awx-job-status`

The `awx-job-status` tool has a richer output contract (`JobDetailOutput`) with `host_status_counts`, `derived` booleans, and optional `stdout`/`raw_events`. The new `awx-get-resource` tool uses a lighter envelope because templates, projects, and inventories lack job-specific concepts like host results and derived flags. The two tools coexist as sibling tools serving different use cases.
