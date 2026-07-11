# ADR 0011: Three-Layer Resource Detail Pattern (Contract → Mapper → Registry+Dispatch)

**Status:** Accepted  
**Date:** 2026-07-12

## Context

The AWX plugin needs to fetch individual resource details from AAP — job templates, projects, inventories, credentials, organizations, hosts, groups, labels, instance groups, execution environments, users, teams, schedules, and notification templates (14 resource types). Each resource:

- Lives at a different AWX API endpoint (e.g., `/api/v2/job_templates/{id}/`, `/api/v2/projects/{id}/`)
- Returns a different JSON shape from the AWX API
- Requires extracting related names from `summary_fields` (resolved names, not raw IDs)
- Requires computing derived boolean flags
- Needs to produce a consistent envelope for the agent to consume

Additionally, the CRUD mutation system (ADR 0010) needs to reuse the same mapping logic when returning resource detail for create/update operations.

Two approaches were considered: ad-hoc per-resource fetch-and-parse functions, or a layered pattern separating concerns (contract definition, mapping logic, and dispatch orchestration).

## Decision

**Use a three-layer architecture** (Contract → Mapper → Registry+Dispatch) with an optional fourth layer (Formatter) for human-readable display.

### Layer 1 — Contract (`packages/awx/src/contracts/*.ts`)

TypeScript interfaces defining the canonical output shape for each resource type. Every contract follows the same envelope:

```typescript
interface ResourceDetailOutput {
  schema_version: "1.0";
  resource_type: string;  // e.g., "template", "project"
  id: number;
  data: ResourceData;     // per-type data interface
}
```

18 contract files exist, covering the following resource types plus supporting contracts:

| Contract File | Resource/Schema |
|---------------|-----------------|
| `template-detail.ts` | Job template detail + `TemplateData` interface |
| `project-detail.ts` | Project detail |
| `inventory-detail.ts` | Inventory detail |
| `credential-detail.ts` | Credential detail |
| `organization-detail.ts` | Organization detail |
| `host-detail.ts` | Host detail |
| `group-detail.ts` | Group detail |
| `label-detail.ts` | Label detail |
| `instance-group-detail.ts` | Instance group detail |
| `execution-environment-detail.ts` | Execution environment detail |
| `user-detail.ts` | User detail |
| `team-detail.ts` | Team detail |
| `schedule-detail.ts` | Schedule detail |
| `notification-template-detail.ts` | Notification template detail |
| `workflow-template-detail.ts` | Workflow template detail |
| `job-detail.ts` | Job detail (for job-status/wait-job) |
| `resource-mutation.ts` | Mutation output envelope (CRUD) |
| `sync-project.ts` | Project sync output |

Each contract has a Zod schema for runtime validation plus an inferred TypeScript type. The envelope fields (`schema_version`, `resource_type`, `id`, `data`) are consistent across all contracts.

### Layer 2 — Mapper (`packages/awx/src/mappers/map-*.ts`)

Pure functions that transform raw AWX API JSON into the typed contracts. Each mapper:

1. **Validates** the raw input (throws if missing required fields like `id`)
2. **Extracts** related names from `summary_fields` (e.g., `sf.inventory?.name` → `inventory_name`)
3. **Computes** derived flags or reshapes nested data
4. **Returns** the typed contract envelope

Example transformation in `mapTemplate()`:

```
Raw AWX API response →
  - Extracts inventory_name, project_name, organization_name from summary_fields
  - Extracts labels from summary_fields.labels.results
  - Maps credentials from summary_fields.credentials (handles array vs. {results: [...]} formats)
  - Coerces next_schedule from object to string name
  - Applies defaults for optional fields (?? false, ?? "")
  - Returns { schema_version: "1.0", resource_type: "template", id, data }
```

Mapper functions are **pure** — no side effects, no HTTP calls, no client state. This makes them safely reusable across the read path (`getResource`) and the write path (`executeCrud` in CRUD).

15 mapper files exist, one per resource type.

### Layer 3 — Registry + Dispatch (`packages/awx/src/get-resource.ts`)

A static `RESOURCE_REGISTRY` mapping resource type strings to `{ path, mapper }` entries, and a single `getResource()` dispatch function:

```typescript
const RESOURCE_REGISTRY: Record<ResourceType, ResourceEntry> = {
  template:   { path: "/api/v2/job_templates/{id}/",         mapper: mapTemplate },
  project:    { path: "/api/v2/projects/{id}/",              mapper: mapProject },
  inventory:  { path: "/api/v2/inventories/{id}/",           mapper: mapInventory },
  // ... 11 more entries
};
```

`getResource()` performs the full orchestration:

1. Looks up `RESOURCE_REGISTRY[type]` — throws if unsupported
2. Substitutes `{id}` in the path
3. Calls `client.request()` through the middleware pipeline (abort signal, timeout, circuit breaker, retry/backoff)
4. Parses the JSON response
5. Delegates to `entry.mapper(raw)` for type-specific transformation
6. Returns the typed `ResourceDetailOutput`

This is a **single dispatch function** for all read operations, unlike CRUD which uses multiple tools.

### Tool Factory (`packages/awx/src/tools/get-resource.ts`)

`createGetResourceTool()` registers a single `awx-get-resource` tool accepting `{ type, id }`:

```typescript
tool({
  description: "Get individual resource detail from AWX...",
  args: {
    type: z.enum([...14 resource types...]),
    id: z.number().int().positive(),
  },
  async execute(args, context) {
    const result = await getResource(client, args.type, args.id, context.abort);
    return {
      output: formatResourceOutput(result),
      metadata: result,
    };
  },
});
```

This contrasts with the CRUD tool layer (ADR 0010), which registers 15 separate tools. The read path uses a single tool because all reads share the same arg shape (`{ type, id }`), whereas each CRUD mutation has distinct required/optional args.

### Layer 4 — Formatter (`packages/awx/src/utils.ts`, optional)

`formatResourceOutput()` is effectively a fourth layer — a display dispatcher that switches on `result.resource_type` to produce a human-readable Markdown-formatted multi-line string. Each resource type gets a tailored display showing its most relevant fields:

- Templates show: name, job_type, playbook, status, inventory/project names, credentials, extra_vars, timeout, tags
- Projects show: SCM type/URL/branch, status, credential, organization
- Inventories show: kind, host_count, groups, organization
- Users show: full name, email, superuser status, organization

The formatter is optional — the structured `metadata` (full contract output) is always returned alongside the display string.

### Cross-system reuse

The CRUD system (ADR 0010) directly reuses Layer 2 (mappers) from this pattern. When `executeCrud()` performs a create or update, it calls `entry.mapper(raw)` — the same mapper function used by `getResource()`. This guarantees that a resource looks identical whether fetched via `awx-get-resource` or returned as `data` in a `ResourceMutationOutput`:

```
awx-get-resource({ type: "template", id: 7 })
  → getResource() → mapTemplate(raw)
  → { schema_version, resource_type, id, data }

awx-create-template({ name, project_id, ... })
  → executeCrud() → mapTemplate(raw)
  → wrapMutationResult() → { schema_version, action, resource_type, id, data }
```

The `wrapMutationResult()` function in `utils.ts` is the bridge: it unwraps the nested `data` from the mapper envelope so CRUD consumers access fields directly via `result.data.name` rather than `result.data.data.name`.

## Consequences

- **Positive**: Clear separation of concerns — contracts define the "what", mappers define the "how", registry defines the "where", dispatch orchestrates the "when".
- **Positive**: Mappers are pure functions, trivially unit-testable without HTTP fixtures.
- **Positive**: Mapper reuse between read and write paths guarantees consistent output — no divergence between what `awx-get-resource` returns and what a create/update tool returns.
- **Positive**: Adding a new resource type requires only 3 files (contract, mapper, registry entry) plus a tool if desired — the dispatch and middleware are unchanged.
- **Positive**: The formatter layer keeps display logic out of the mapper and contract layers, letting them focus on data shape.
- **Negative**: 3–4 files per resource type is higher up-front overhead than a monolithic fetch-and-return approach.
- **Negative**: The formatter in `utils.ts` is a growing switch statement — adding new resource types requires editing it to get good display output.
- **Negative**: The `wrapMutationResult()` bridge is a subtle detail that newcomers must understand; there is a risk of double-nesting if not applied correctly.

## Alternatives Considered

1. **Per-resource fetch functions** — One function per resource type (e.g., `getTemplate(id)`, `getProject(id)`) each containing its own `fetch()` call, path construction, and response parsing. Rejected due to massive duplication of orchestration logic (error handling, path substitution, abort signal wiring).

2. **Generic `getResource()` with inline parsing** — A single dispatch function that switches on type and parses responses inline. Rejected because the mapper logic for each type is 30–80 lines — the function would become a 1000+ line monolith with no separation between endpoint wiring and data transformation.

3. **Code-generated contracts** — Generate TypeScript contracts and mappers from AWX API schema. Rejected for v1: the API schema is large and unstable; manual contracts are precise and auditable. May revisit in v2 if resource types grow significantly.
