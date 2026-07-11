# ADR 0010: CRUD Registry and Resource Mutation Envelope

**Status:** Accepted  
**Date:** 2026-07-12

## Context

The AWX plugin needs to create, update, and delete AWX resources (job templates, projects, inventories, hosts, groups, labels, credentials, organizations, users, teams, schedules, notification templates, instance groups, execution environments, and workflow templates — 15 resource types in total). Each resource type maps to different AWX API endpoints and HTTP methods:

| Operation | HTTP Method | Endpoint Pattern |
|-----------|-------------|------------------|
| Create    | POST        | `/api/v2/{resource}s/` |
| Update    | PATCH       | `/api/v2/{resource}s/{id}/` |
| Delete    | DELETE      | `/api/v2/{resource}s/{id}/` |

Beyond the endpoint differences, each resource type has a unique response shape, requiring per-type mapping logic (extracting `summary_fields`, computing derived flags, etc.). The existing `get-resource.ts` already defines per-type mapper functions (`mapTemplate`, `mapProject`, `mapInventory`, etc.) and their associated TypeScript contracts.

Two approaches were considered: hardcoding per-resource tools with inline HTTP calls, or building a registry + dispatch pattern that reuses the existing mappers.

## Decision

**Use a static registry (`CRUD_REGISTRY`) with a single dispatch function (`executeCrud()`) and a tool-layer factory (`createCrudTools()`).** All CRUD results are wrapped in a standard `ResourceMutationOutput` envelope.

### Architecture

```
Tool Layer (tools/crud.ts)
  └─ createCrudTools() — factory registering 15 OpenCode tools
       │  each tool builds args, calls executeCrud(), wraps via wrapMutationResult()
       ▼
Dispatch Layer (crud.ts)
  └─ executeCrud() — generic dispatch function
       │  looks up CRUD_REGISTRY[resource][action]
       │  substitutes {id} if required
       │  calls client.request() through middleware pipeline
       │  maps response via entry.mapper(raw)
       ▼
Registry Layer (crud.ts)
  └─ CRUD_REGISTRY: Record<CrudResourceType, CrudEntry>
       │  each entry has:
       │    endpoint: { create: CrudEndpoint, update: CrudEndpoint, delete: CrudEndpoint }
       │    mapper: (raw) => output
       ▼
Mapper Layer (mappers/map-*.ts)
  └─ Reused from get-resource.ts pattern
       │  pure functions transforming raw API JSON → typed contract
       ▼
Middleware Layer (client.ts)
  └─ HTTP middleware pipeline: abort signal → timeout → circuit breaker → fetch → retry/backoff
```

### CRUD_REGISTRY

A static `Record<CrudResourceType, CrudEntry>` mapping 15 resource type strings to endpoint configs and shared mapper functions:

```typescript
type CrudResourceType =
  | "template" | "project" | "inventory" | "user" | "team"
  | "schedule" | "notification_template" | "host" | "group"
  | "label" | "instance-group" | "execution-environment"
  | "credential" | "organization" | "workflow_template";

interface CrudEndpoint {
  path: string;       // AWX API path, may contain {id} placeholder
  method: "POST" | "PATCH" | "DELETE";
  requiresId: boolean;
}

interface CrudEntry<T = unknown> {
  endpoint: Record<CrudAction, CrudEndpoint>;
  mapper: (raw: unknown) => T;
}
```

### executeCrud() dispatch function

- Looks up `CRUD_REGISTRY[resource]` — throws if unsupported type
- Looks up `entry.endpoint[action]` — throws if unsupported action
- Substitutes `{id}` if `requiresId` is true
- Builds HTTP `RequestInit` with method, headers, and body (for create/update)
- Calls `client.request()` through the middleware pipeline
- For delete: returns `{ action: "deleted", resource_type, id, data: null }` (no response body)
- For create/update: parses response JSON, calls `entry.mapper(raw)`, returns structured result

### ResourceMutationOutput envelope

All CRUD results are wrapped in a standard envelope:

```typescript
interface ResourceMutationOutput {
  schema_version: "1.0";
  action: "created" | "updated" | "deleted";
  resource_type: CrudResourceType;
  id: number;
  data: unknown | null;  // mapped detail for create/update, null for delete
  warnings: string[];
  errors: string[];
}
```

The `wrapMutationResult()` utility in `utils.ts` converts the internal `CrudResult` (with nested mapper output) into this flat envelope by extracting the inner `data` payload.

### createCrudTools() factory

A single factory function `createCrudTools(getAwxClient)` that registers 15 individual OpenCode tools (e.g., `awx-create-project`, `awx-update-template`, `awx-delete-inventory`, `awx-create-host`, etc.). Each tool:

1. Resolves the AWX client via `getAwxClient()`
2. Builds the request body from typed Zod args
3. Calls `executeCrud()` with the appropriate resource type and action
4. Wraps the result via `wrapMutationResult()`
5. Returns a human-readable output string + structured metadata

This contrasts with the get-resource pattern which uses a single `awx-get-resource` tool. The CRUD pattern uses 15 separate tools because each mutation has distinct required/optional args that benefit from per-tool Zod schemas with targeted descriptions.

### Adding a new CRUD resource

1. Define a contract in `contracts/<resource>-detail.ts`
2. Write a mapper in `mappers/map-<resource>.ts`
3. Register it in `CRUD_REGISTRY` with endpoints and mapper reference
4. Optionally add the type to the `CrudResourceType` union
5. Optionally add a new tool in `tools/crud.ts` via `createCrudTools()`

## Consequences

- **Positive**: Adding a new resource type requires no changes to the dispatch logic — just a contract, mapper, registry entry, and optionally a tool.
- **Positive**: Mappers are reused between the read (get-resource) and write (CRUD) paths, ensuring consistent output shape regardless of how a resource is fetched.
- **Positive**: Error handling is centralized in `executeCrud()` — unknown types, missing IDs, and API errors all produce consistent, informative errors.
- **Positive**: The `ResourceMutationOutput` envelope gives agents a predictable structure to parse regardless of which resource was mutated.
- **Positive**: Per-tool Zod schemas provide type-safe, documented args for each mutation (e.g., `awx-create-template` requires `name`, `job_type`, `project_id`, `inventory_id`, `playbook`; `awx-update-host` accepts optional `name`, `description`, `inventory_id`).
- **Negative**: 15 tools is a large surface area — the factory function is verbose (~1400 lines), though structurally repetitive.
- **Negative**: Adding a tool for each new resource type requires tool registration boilerplate beyond just the registry entry.

## Alternatives Considered

1. **Per-resource hardcoded HTTP calls** — Each tool would inline its own `fetch()` call, URL construction, and response parsing. Rejected due to massive duplication across 15 resources × 3 actions = 45 operation implementations.

2. **Dynamic ORM-like abstraction** — A generic `awx-mutate-resource` tool accepting `{ type, action, body }` that builds the endpoint dynamically from a naming convention. Rejected because it provides no arg-level validation or documentation (the agent would need to know raw API shapes and which fields go where).

3. **Single tool with discriminated union args** — One `awx-mutate-resource` tool with a Zod discriminated union keyed by `{ type, action }`. Rejected because the Zod union would be unwieldy (15 × 3 = 45 variants) and the tool description would be too long for the agent to parse effectively.
