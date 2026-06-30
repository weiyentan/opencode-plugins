# AWX Plugin Architecture

## Overview

The AWX plugin (`@weiyentan/opencode-plugin-awx`) is an [OpenCode](https://opencode.ai/) server plugin that provides native tool access to [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). It registers 20+ tools covering job templates, projects, inventories, job lifecycle operations, and more.

This document describes the plugin's internal architecture, data flow, and key design patterns. It is intended for both developers and AI agents working with the codebase.

> **Related resources:**
> - [Plugin README](../README.md) — Setup, testing, tool reference, and CI requirements
> - [Architecture Decision Records](../../../docs/adr/) — Design rationale for auth (ADR 0001), output contracts (ADR 0002), resilience (ADR 0003), agent-side polling (ADR 0004), extra-vars (ADR 0005), and error taxonomy (ADR 0006)
> - [Domain Glossary](../../../CONTEXT.md) — Core terminology (Plugin, Tool, Auth hook, Middleware pipeline, Circuit breaker, etc.)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenCode Plugin Server                      │
│  (loads plugin via opencode.jsonc → imports AwxPlugin symbol)    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWX Plugin (src/index.ts)                     │
│                                                                  │
│  ┌─────────────┐   ┌──────────────┐   ┌─────────────────────┐   │
│  │ Auth Hook   │   │ MetricsStore │   │ Tool Registration   │   │
│  │ (src/auth)  │   │ (src/metrics)│   │ (20 tools)          │   │
│  └──────┬──────┘   └──────┬───────┘   └──────────┬──────────┘   │
│         │                 │                       │              │
│         │                 │                       │              │
│         └──────┬──────────┴──────────┬────────────┘              │
│                │                     │                           │
│                ▼                     ▼                           │
│         ┌──────────────┐   ┌──────────────────┐                 │
│         │ Auth Hook    │   │ getAwxClient()   │                 │
│         │ (api type)   │   │ 3-tier fallback  │                 │
│         │ Bearer token │   │ chain for token  │                 │
│         └──────────────┘   └────────┬─────────┘                 │
│                                     │                           │
│                                     ▼                           │
│                          ┌──────────────────────┐               │
│                          │   AwxClient          │               │
│                          │   (src/client.ts)    │               │
│                          │   Middleware Pipeline │               │
│                          └──────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
              ┌───────────────────────┐
              │  AWX / AAP REST API   │
              │  (example.com)        │
              └───────────────────────┘
```

### Data Flow for a Typical Tool Call

```
Agent Code                        Plugin Server                  AWX API
    │                                   │                          │
    │ 1. Call awx-list-templates        │                          │
    │──────────────────────────────────►│                          │
    │                                   │                          │
    │ 2. Plugin receives AbortSignal    │                          │
    │    resolves token via 3-tier      │                          │
    │    fallback chain                 │                          │
    │                                   │                          │
    │ 3. createClient(url, token)       │                          │
    │    → middleware pipeline          │                          │
    │                                   │                          │
    │ 4. Circuit breaker (tryAcquire)   │                          │
    │    → CLOSED (pass)                │                          │
    │                                   │                          │
    │ 5. Combined abort+timeout signal  │                          │
    │                                   │                          │
    │ 6. GET /api/v2/job_templates/     │                          │
    │    (with Bearer token)            │─────────────────────────►│
    │                                   │                          │
    │ 7. 200 OK + JSON response         │                          │
    │◄──────────────────────────────────│◄─────────────────────────│
    │                                   │                          │
    │ 8. Pretty-print as Markdown table │                          │
    │    Record metrics (call+latency)  │                          │
    │                                   │                          │
    │ 9. Return { output, metadata }    │                          │
    │◄──────────────────────────────────│                          │
```

---

## 1. Plugin Entry Point (`src/index.ts`)

**File:** `src/index.ts`

The entry point is the `server()` async function, which is exported as `AwxPlugin` (both named and default export). It receives `PluginInput` and returns `Hooks` containing the auth hook, tools, and dispose lifecycle hook.

### Plugin Lifecycle

```
Plugin load
    │
    ├── 1. Create auth hook (createAwxAuthHook)
    │       ← registers type: "api" provider for bearer token
    │
    ├── 2. Create MetricsStore, load persisted counters from disk
    │       ← starts periodic persistence interval (30s)
    │
    ├── 3. Create lazy AwxClient resolver (getAwxClient)
    │       ← NOT created yet — created on first tool call
    │
    ├── 4. Init-time token validation
    │       ← If AWX_BASE_URL is set and token available:
    │          GET /api/v2/me/ with 10s timeout
    │          Logs success or error (non-fatal)
    │
    ├── 5. Return Hooks { auth, dispose, tool: { ... } }
    │
    └── 6. On dispose → flush metrics to disk
```

### Key Patterns

**Lazy client creation (`getAwxClient`):**

```typescript
async function getAwxClient(): Promise<AwxClient> {
  // Tier 1: customConfig (set via awx-configure tool)
  // Tier 2: getSecret (server-injected, if available)
  // Tier 3: process.env.AWX_TOKEN
  const token = getCustomConfig()?.token
    ?? await input.client.getSecret?.("awx")
    ?? process.env.AWX_TOKEN;

  const resolvedBaseUrl = getCustomConfig()?.baseUrl
    ?? process.env.AWX_BASE_URL;

  // Cache client instance, re-create if token/URL changes
  if (!cachedClient || cachedToken !== token || cachedBaseUrl !== resolvedBaseUrl) {
    cachedClient = createClient(resolvedBaseUrl, token, { metricsStore });
  }
  return cachedClient;
}
```

**3-tier auth fallback chain** (see `src/runtime-config.ts` and `CONTEXT.md`):
1. **customConfig** — Module-level config set via the `awx-configure` tool (survives within a session)
2. **getSecret** — Server-injected credential retrieval (if the SDK ever provides it)
3. **process.env.AWX_TOKEN** — Environment variable fallback for quick bootstrap

**Tool registration pattern — every tool follows this structure:**

```typescript
"awx-example-tool": tool({
  description: "...",
  args: { /* Zod schema for args */ },
  async execute(args, context) {
    // 1. Respect abort signal
    if (context.abort?.aborted) {
      return { output: "Request was aborted." };
    }

    // 2. Get the AWX client (resolves auth + creates if needed)
    let awxClient;
    try {
      awxClient = await getAwxClient();
    } catch (err) {
      return { output: err.message };
    }

    // 3. Execute business logic via the client or helper modules
    try {
      const result = await someHelper(awxClient, args, context.abort);
      return { output: JSON.stringify(result), metadata: result };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return { output: "Request was aborted." };
      }
      return { output: `Error: ${err.message}` };
    }
  },
}),
```

**Key helper functions in index.ts:**

| Function | Purpose |
|---|---|
| `formatErrorResponse()` | Maps HTTP status codes (404, 401, 403) to user-facing error messages |
| `wrapMutationResult()` | Wraps CRUD operation results into the `ResourceMutationOutput` envelope |
| `buildPipeTable()` | Renders arrays of items into Markdown pipe-delimited tables |
| `formatResourceOutput()` | Formats resource detail (template/project/inventory) as human-readable strings |

---

## 2. Auth Hook (`src/auth.ts`)

**File:** `src/auth.ts`

Implements OpenCode's `type: "api"` auth hook pattern for bearer token / PAT authentication.

### Auth Flow

```
OpenCode prompts user for PAT
    │
    ▼
authorize(inputs) → { type: "success", key: token.trim() }
    │
    ▼
Token stored by OpenCode server
    │
    ▼ (on next plugin load)
Init-time validation via GET /api/v2/me/ (10s timeout)
    │
    ├── 200 OK → Token valid, log success
    ├── 401 → Token invalid/expired → log error with renewal URL
    ├── 403 → Insufficient permissions → log error
    ├── Network error → Log connectivity error
    └── No token stored → Plugin loads gracefully, user prompted on first tool use
```

### Key Components

- **`validateToken(baseUrl, token, signal)`** — Makes GET request to `api/v2/me/` and returns structured `AuthValidationResult` with `valid`, `error`, and `status` fields.
- **`createAwxAuthHook()`** — Returns the auth hook config with `provider: "awx"` and a single API method. The `authorize()` function validates the input (rejects empty/whitespace tokens) and returns the token as the `key`.

### Error Messages

All validation errors are user-actionable — they include the URL for generating a new PAT, instructions for checking permissions, or guidance for verifying the AAP base URL.

---

## 3. HTTP Client Middleware (`src/client.ts`)

**File:** `src/client.ts`

The HTTP client is a middleware pipeline that composes five concerns:

```
signal → timeout → breaker gate → fetch → retry/backoff
```

### Pipeline Stages

1. **Signal combination** — The tool's `context.abort` signal and an internal timeout signal are combined using `anyAbortSignal()`. On Node 20+, this uses native `AbortSignal.any()`. On Node 18, it falls back to manual event wiring.

2. **Timeout** — `createTimeoutSignal(ms)` creates an `AbortSignal` that fires after the configured timeout (default: 30s). Uses `setTimeout` + `AbortController` for Node 18 compatibility and vitest fake-timer support.

3. **Circuit breaker gate** — Before each request attempt, the circuit breaker's `tryAcquire()` is checked. If the breaker is OPEN, a synthetic 503 response is returned immediately without making a network request.

4. **Native `fetch`** — Makes the actual HTTP request with `Authorization: Bearer <token>` header and caller-supplied headers merged in.

5. **Response handling with retry/backoff**:

| Status | Behavior |
|--------|----------|
| 2xx | Success — reset breaker, return immediately |
| 4xx (400-499) | Client error — return immediately, do NOT retry, do NOT trip breaker (401 records token expiry event) |
| 5xx (500-599) | Server error — record failure, retry with exponential backoff |
| Network error | Record failure, retry with exponential backoff |
| AbortError | Throw immediately — no retry |

### Circuit Breaker

**States:** `CLOSED` (normal) → `OPEN` (tripped) → `HALF-OPEN` (probe)

| State | Request Handling |
|---|---|
| CLOSED | Requests pass through normally |
| OPEN | Requests rejected immediately (return 503) until cooldown (30s) elapses |
| HALF-OPEN | One probe request is allowed; success → CLOSED, failure → OPEN again |

- **Trip threshold:** 5 consecutive errors (default)
- **Cooldown:** 30 seconds (default)
- **Scope:** Per-tool (each tool name gets its own breaker instance)

### Retry/Backoff Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxRetries` | 3 | Maximum retry attempts (4 total requests) |
| `BACKOFF_BASE_MS` | 1000 | Base delay in milliseconds |
| `BACKOFF_MULTIPLIER` | 2 | Exponential multiplier |
| `JITTER_RATIO` | 0.5 | Random jitter: 0-50% of calculated delay |

Backoff formula: `base * multiplier^attempt + random(0, jitter * calculated)`

| Attempt | Delay |
|---------|-------|
| 0 | 1000ms + 0-500ms jitter |
| 1 | 2000ms + 0-1000ms jitter |
| 2 | 4000ms + 0-2000ms jitter |

### Key Utilities

- **`calcBackoff(attempt)`** — Pure function calculating exponential backoff with jitter.
- **`sleepWithAbort(ms, signal)`** — Sleep function that resolves on timeout but aborts immediately if the signal fires (supported via `addEventListener("abort", ...)`).
- **`createTimeoutSignal(ms)`** — Creates a controllable timeout signal (Node 18 compatible).
- **`anyAbortSignal(signals)`** — Combines multiple signals into one (Node 18 compatible fallback).

### AwxClient Interface

```typescript
interface AwxClient {
  request(
    toolName: string,     // Per-tool circuit breaker identifier
    path: string,          // API path (e.g., "/api/v2/job_templates/")
    init?: RequestInit,    // Fetch options (method, body, headers)
    abortSignal?: AbortSignal  // ToolContext.abort for cancellation
  ): Promise<Response>;
}
```

---

## 4. Metrics Lifecycle (`src/metrics.ts`)

**File:** `src/metrics.ts`

Provides structured per-tool counters with file-backed durability for operational visibility.

### Counter Types

| Counter | Description |
|---------|-------------|
| `callCount` | Total number of tool invocations |
| `errorCount` | Total number of errors (HTTP + network) |
| `totalLatencyMs` | Accumulated round-trip latency |
| `tokenExpiryEvents` | 401 Unauthorized responses (token expiry detection) |
| `psFallbackCount` | PowerShell fallback invocations (deprecation monitoring) |

### Durability Model

```
Plugin Load                    Plugin Runtime              Plugin Dispose
    │                              │                           │
    ▼                              ▼                           ▼
MetricsStore.load()          MetricsStore.recordCall()    persistence.clear()
(merge disk → memory)        MetricsStore.recordError()   (final persist + stop interval)
    │                              │
    ▼                              ▼
.metrics/metrics.json    setupMetricsPersistence(30s)
(read at startup)        (periodic atomic writes)
```

**Key properties:**
- **Atomic writes:** Data is written to a `.tmp` file first, then renamed over the target — preventing corruption on partial writes.
- **Additive merge on load:** `Math.max(inMemory, onDisk)` ensures counters never decrease, preventing race conditions during concurrent persist windows.
- **Missing file on load:** Treated as a fresh start (no error — counters start at zero).
- **Dynamic imports:** Uses dynamic `import("fs/promises")` and `import("path")` to keep the module dependency-free at the type level.

### Lifecycle Integration

The metrics lifecycle is wired in `index.ts`:

```typescript
// 1. Create store and load persisted counters
const metricsStore = new MetricsStore();
await metricsStore.load();

// 2. Start periodic persistence (every 30s)
const persistence = setupMetricsPersistence(metricsStore, 30_000, onError);

// 3. Return dispose hook to flush + stop interval
return {
  // ...
  dispose: async () => {
    await persistence.clear();
  },
};
```

Metrics are recorded in `client.ts` at the pipeline boundary:

```typescript
const start = Date.now();
try {
  const response = await fetch(url, fetchInit);
  // ... response handling ...
} finally {
  metrics.recordCall(toolName, Date.now() - start);
  if (recordedError) metrics.recordError(toolName);
}
```

---

## 5. Output Contracts (`src/contracts/`)

The plugin uses schema-driven output contracts to ensure consistent response shapes across all tools.

### Contract Enumeration

| File | Contract Interface | Purpose |
|------|--------------------|---------|
| `contracts/job-detail.ts` | `JobDetailOutput` | Structured job detail matching `awx_job_detail.py` v1.0 — used by `awx-job-status`, `awx-wait-job` |
| `contracts/resource-mutation.ts` | `ResourceMutationOutput` | Generic mutation envelope — used by all create/update/delete tools |
| `contracts/template-detail.ts` | `TemplateDetailOutput` | Template detail with resolved related names |
| `contracts/project-detail.ts` | `ProjectDetailOutput` | Project detail with SCM fields |
| `contracts/inventory-detail.ts` | `InventoryDetailOutput` | Inventory detail with host/group counts |
| `contracts/sync-project.ts` | `SyncProjectOutput` | Project sync operation result |

### JobDetailOutput v1.0 (Canonical)

The most important contract. Every job-related tool returns output matching this shape:

```typescript
interface JobDetailOutput {
  schema_version: "1.0";
  job: JobCore;                  // id, name, status, timestamps, extra_vars, etc.
  related: Related;              // resolved names (not URLs): inventory_name, project_name, etc.
  host_status_counts: HostStatusCounts;  // ok, failed, skipped, changed, unreachable
  derived: Derived;              // is_successful, is_failed, has_unreachable_hosts
  warnings: string[];
  errors: string[];
  stdout?: string;               // Optional full job console output
  raw_events?: unknown[];        // Optional raw AWX job events
}
```

**Key naming conventions:**
- Use `host_status_counts` — NOT `host_summary`
- Use `derived` — NOT `extra_vars_summary`
- `related` fields are resolved names, not raw URLs
- `job.extra_vars` is parsed from AWX API JSON string into `Record<string, unknown>`

### ResourceMutationOutput (Generic Mutation Envelope)

All create/update/delete tools return this shape:

```typescript
interface ResourceMutationOutput {
  schema_version: "1.0";
  action: "created" | "updated" | "deleted";
  resource_type: "template" | "project" | "inventory";
  id: number;
  data: TemplateDetailOutput | ProjectDetailOutput | InventoryDetailOutput | null;
  warnings?: string[];
  errors?: string[];
}
```

The `resource-mutation.ts` contract also uses Zod schemas for runtime validation (`ResourceMutationOutputSchema`).

---

## 6. Mapper Functions (`src/mappers/`)

Mapper functions are pure functions that transform raw AWX API responses into the structured contract formats.

### Mapper Enumeration

| File | Function | Input | Output |
|------|----------|-------|--------|
| `mappers/map-template.ts` | `mapTemplate(raw)` | Raw JSON from `GET /api/v2/job_templates/{id}/` | `TemplateDetailOutput` |
| `mappers/map-project.ts` | `mapProject(raw)` | Raw JSON from `GET /api/v2/projects/{id}/` | `ProjectDetailOutput` |
| `mappers/map-inventory.ts` | `mapInventory(raw)` | Raw JSON from `GET /api/v2/inventories/{id}/` | `InventoryDetailOutput` |

### Key Transformations

All mappers perform these transformations:

1. **Related name resolution** — Extract names from AWX's `summary_fields` (e.g., `summary_fields.inventory.name`) rather than returning raw IDs or URLs.
2. **Null safety** — Use `??` with sensible defaults (`""`, `0`, `false`, `null`) for every field.
3. **Envelope wrapping** — Output is wrapped in `{ schema_version: "1.0", resource_type, id, data }`.

### Example: mapTemplate

```typescript
export function mapTemplate(raw: unknown): TemplateDetailOutput {
  // Validate input
  if (!raw || typeof raw !== "object" || !("id" in raw)) {
    throw new Error("Invalid raw response");
  }

  const t = raw as RawAwxTemplate;
  const data: TemplateData = {
    id: t.id,
    name: t.name ?? "",
    // ... resolved names from summary_fields ...
    inventory_name: sf.inventory?.name ?? "",
    project_name: sf.project?.name ?? "",
    // ... etc ...
    labels: sf.labels?.results?.map(l => l.name).filter(Boolean) ?? [],
  };

  return { schema_version: "1.0", resource_type: "template", id: t.id, data };
}
```

### Integration Pattern

Mappers are consumed by both `get-resource.ts` (for individual resource fetches) and `crud.ts` (for create/update responses):

```typescript
// In get-resource.ts → RESOURCE_REGISTRY
const RESOURCE_REGISTRY = {
  template: { path: "/api/v2/job_templates/{id}/", mapper: mapTemplate },
  project:  { path: "/api/v2/projects/{id}/", mapper: mapProject },
  inventory:{ path: "/api/v2/inventories/{id}/", mapper: mapInventory },
};

// Usage
const raw = await response.json();
return entry.mapper(raw) as ResourceDetailOutput;
```

### Registry Pattern

Both `get-resource.ts` and `crud.ts` use a **registry pattern** — a statically-defined mapping from type strings to endpoints and mappers. This makes it straightforward to add new resource types:

1. Define a contract in `contracts/<resource>-detail.ts`
2. Write a mapper in `mappers/map-<resource>.ts`
3. Register it in `RESOURCE_REGISTRY` (get-resource.ts) and `CRUD_REGISTRY` (crud.ts)
4. Add the type to the tool's Zod schema

---

## 7. Tool Registration Pattern

All tools are registered as a flat object in the `tool` property of the `Hooks` return value.

### Complete Tool Inventory

| Tool Name | Module | Category | Output Format |
|-----------|--------|----------|---------------|
| `hello` | index.ts inline | Scaffolding | Plain text |
| `awx-list-templates` | `list-templates.ts` | Read | Markdown table |
| `awx-list-projects` | `list-projects.ts` | Read | Markdown table |
| `awx-list-jobs` | `list-jobs.ts` | Read | Markdown table |
| `awx-launch-job` | `launch.ts` | Job Lifecycle | Raw JSON |
| `awx-job-status` | `job-status.ts` | Job Lifecycle | `JobDetailOutput` JSON |
| `awx-wait-job` | `job-status.ts` | Job Lifecycle | `JobDetailOutput` JSON |
| `awx-get-job-events` | index.ts inline | Job Lifecycle | Structured metadata |
| `awx-sync-project` | index.ts inline | Project | Plain text + metadata |
| `awx-get-resource` | `get-resource.ts` | Read | Structured summary |
| `awx-create-project` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-create-template` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-create-inventory` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-update-project` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-update-template` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-update-inventory` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-delete-project` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-delete-template` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-delete-inventory` | `crud.ts` | Mutation | `ResourceMutationOutput` |
| `awx-debug-env` | index.ts inline | Debug | JSON |
| `awx-configure` | index.ts inline | Setup | Plain text |

### Common Tool Execution Pattern

Every tool follows this exact execution flow:

```
1. Check context.abort.aborted → return early if aborted
2. Call getAwxClient() → catch and return error message
3. Execute business logic (delegate to helper module or inline)
4. Catch AbortError → return "Request was aborted."
5. Catch other errors → return formatted error message
6. Format and return { output, metadata? }
```

### Agent-Side Polling Pattern

Job lifecycle tools use a non-blocking pattern (see ADR 0004):

- **`awx-launch-job`** — Returns immediately with the job ID (or thin proxy of the AWX API response)
- **`awx-job-status`** / **`awx-wait-job`** — Return the current job status without polling. The agent must loop to check for completion
- **`awx-get-job-events`** — Retrieves events (with optional filtering and pagination)

No tool blocks waiting for job completion, avoiding hangs in the agent's execution loop.

---

## Source File Map

```
packages/awx/src/
├── index.ts                  # Plugin entry point — Hooks factory
├── auth.ts                   # Bearer token auth hook + validation
├── client.ts                 # HTTP middleware pipeline + circuit breaker
├── metrics.ts                # Per-tool counters + file-backed persistence
├── runtime-config.ts         # Module-level config storage (awx-configure tool)
├── opencode-augment.d.ts     # TypeScript module augmentation for SDK types
├── node-shim.d.ts            # Minimal Node.js declarations (fs/promises, path)
├── list-templates.ts         # awx-list-templates business logic
├── list-projects.ts          # awx-list-projects business logic
├── list-jobs.ts              # awx-list-jobs business logic
├── launch.ts                 # awx-launch-job business logic
├── job-status.ts             # awx-job-status + awx-wait-job business logic
├── get-resource.ts           # awx-get-resource orchestration (registry + fetch + dispatch)
├── crud.ts                   # CRUD endpoint registry + dispatch
├── contracts/
│   ├── job-detail.ts         # JobDetailOutput v1.0 contract
│   ├── resource-mutation.ts  # ResourceMutationOutput contract (+ Zod schema)
│   ├── template-detail.ts    # TemplateDetailOutput contract
│   ├── project-detail.ts     # ProjectDetailOutput contract
│   ├── inventory-detail.ts   # InventoryDetailOutput contract
│   └── sync-project.ts       # SyncProjectOutput contract
└── mappers/
    ├── map-template.ts       # Raw API → TemplateDetailOutput
    ├── map-project.ts        # Raw API → ProjectDetailOutput
    └── map-inventory.ts      # Raw API → InventoryDetailOutput
```

---

## Design Decisions and ADRs

Key architecture decisions are recorded in `docs/adr/` (at the monorepo root):

| ADR | Title | Summary |
|-----|-------|---------|
| 0001 | [Bearer Token Auth Model](../../../docs/adr/0001-bearer-token-auth-model.md) | Why PAT was chosen over OAuth 2.0 / mutual TLS |
| 0002 | [Output Contract Alignment](../../../docs/adr/0002-output-contract-alignment.md) | Schema-driven output shapes matching Python `awx_job_detail.py` |
| 0003 | [Plugin API Surface Discovery](../../../docs/adr/0003-plugin-api-surface-discovery.md) | Tool-action mapping and surface design |
| 0004 | [Non-Blocking AWX Wait Job](../../../docs/adr/0004-non-blocking-awx-wait-job.md) | Agent-side polling pattern rationale |
| 0005 | [Extra-Var Transformations](../../../docs/adr/0005-extra-var-transformations-in-plugin.md) | Superseded — transforms removed; `awx-launch-job` now passes `extra_vars` verbatim |
| 0006 | [Connection Resilience Parameters](../../../docs/adr/0006-connection-resilience-parameters.md) | Retry, timeout, circuit breaker configuration |
| 0007 | [Plugin Entry Point Export Hygiene](../../../docs/adr/0007-plugin-entry-point-export-hygiene.md) | Named + default export convention |
