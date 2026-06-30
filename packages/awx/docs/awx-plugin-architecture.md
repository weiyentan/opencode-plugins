# AWX Plugin Architecture Guide

> **Package:** `@weiyentan/opencode-plugin-awx` at `packages/awx/`  
> **Version:** 1.0  
> **Audience:** Plugin developers, maintainers, and code reviewers

This document explains the internal architecture of the AWX OpenCode plugin. It describes
how the plugin is loaded, how it authenticates against Ansible Automation Platform (AAP),
how it manages HTTP resilience, how operational metrics are tracked, and how it transforms
raw API responses into structured contracts.

---

## Table of Contents

1. [Plugin Entry Point and Server Function Lifecycle](#1-plugin-entry-point-and-server-function-lifecycle)
2. [Auth Hook — Bearer Token PAT Flow](#2-auth-hook--bearer-token-pat-flow)
3. [HTTP Client Middleware Pipeline](#3-http-client-middleware-pipeline)
4. [Metrics Lifecycle](#4-metrics-lifecycle)
5. [Output Contracts](#5-output-contracts)
6. [Mapper Functions](#6-mapper-functions)
7. [Tool Registration Patterns](#7-tool-registration-patterns)
8. [Architecture Decision Records](#8-architecture-decision-records)
9. [Domain Glossary Cross-Reference](#9-domain-glossary-cross-reference)

---

## 1. Plugin Entry Point and Server Function Lifecycle

**Source:** `src/index.ts` — the single entry point for the plugin.

### Plugin Registration

The AWX plugin is registered as a string-only entry in the OpenCode server configuration
(`opencode.jsonc`):

```jsonc
{ "plugin": ["@weiyentan/opencode-plugin-awx"] }
```

The `package.json` `main` field points to the compiled `dist/index.js` output. The
OpenCode server imports this module when the plugin is loaded.

### The `server()` Function

The plugin exports a `server` function (the **plugin server function**) that receives
`PluginInput` and returns `Hooks`:

```typescript
async function server(input: PluginInput): Promise<Hooks>
```

**`PluginInput`** provides:
- `client` — The `OpencodeClient` instance (with sub-clients: `app`, `config`, `session`,
  `auth`, `file`, `tool`, etc.)
- `serverUrl` — The parsed URL of the OpenCode server
- `project`, `directory`, `worktree` — Workspace information
- `$` — A shell command executor

**The lifecycle, in order:**

1. **Auth hook creation** — `createAwxAuthHook()` registers the `type: "api"` bearer
   token auth hook before any other setup. This ensures the credential system is ready.

2. **Metrics store initialization** — A `MetricsStore` instance is created and persisted
   counters are loaded from disk. Periodic persistence (every 30 seconds) is started
   via `setupMetricsPersistence()`.

3. **Lazy AWX client** — The `getAwxClient()` closure is defined but does **not** create
   the HTTP client yet. The client is created on the first tool invocation, using a
   3-tier token resolution chain:
   - **Tier 1:** Module-level `customConfig` (set via the `awx-configure` tool)
   - **Tier 2:** `input.client.getSecret?.("awx")` (server-injected secret, if available)
   - **Tier 3:** `process.env.AWX_TOKEN` (environment variable fallback)

4. **Init-time token validation** — If `AWX_BASE_URL` is configured at load time, the
   plugin makes a `GET /api/v2/me/` request with a 10-second timeout to validate the
   stored PAT. Validation failures are logged as errors, but the plugin continues loading
   so the user can re-authenticate.

5. **Hooks returned** — The function returns:
   - `auth` — The auth hook configuration
   - `tool` — A record of all registered tool functions (20+ tools)
   - `dispose` — A cleanup function that flushes metrics to disk

### Dispose Hook

```typescript
dispose: async () => {
  await persistence.clear();
}
```

When the plugin is unloaded or hot-reloaded, the dispose hook stops the metrics
persistence interval and performs a final `persist()` to ensure all in-memory counters
are written to disk.

### Configuration Sources

| Source | What | Priority |
|--------|------|----------|
| `awx-configure` tool | `baseUrl`, `token` | Highest (module-level) |
| `input.client.getSecret?.("awx")` | Token only | Medium |
| `process.env.AWX_BASE_URL` | Base URL | Medium |
| `process.env.AWX_TOKEN` | Token | Lowest (fallback) |

---

## 2. Auth Hook — Bearer Token PAT Flow

**Source:** `src/auth.ts`

### Overview

The AWX plugin authenticates against AAP using **Personal Access Tokens (PATs)** sent as
`Authorization: Bearer <token>` headers. This follows the OpenCode `type: "api"` auth
hook pattern.

### Auth Hook Factory

```typescript
function createAwxAuthHook(): { provider: string; methods: AuthMethod[] }
```

Returns an auth hook configuration with:
- **`provider: "awx"`** — Links the credential provider to the AWX plugin
- **`type: "api"`** — Standard OpenCode pattern for non-rotating, user-provided tokens
- **`label: "AWX Bearer Token"`** — User-facing label in the credential prompt
- **`prompts`** — A text prompt asking the user to enter their PAT

### Authorization Flow

1. **First use:** OpenCode prompts the user for a PAT via the auth hook text prompt.
2. **`authorize(inputs)`:** The function receives `inputs.token` (the PAT entered by
   the user). If the token is empty or whitespace-only, it returns `{ type: "failed" }`.
   Otherwise, it returns `{ type: "success", key: token.trim() }`.
3. **Credential storage:** OpenCode securely stores the returned `key` and injects it
   into the plugin's credential retrieval path.

### Init-Time Token Validation

On every plugin load (when `AWX_BASE_URL` is configured):

```typescript
const result = await validateToken(baseUrl, storedKey, signal);
```

The `validateToken()` function sends `GET /api/v2/me/` with the bearer token. Possible
outcomes:

| HTTP Status | Result | User Message |
|-------------|--------|-------------|
| 200 | `{ valid: true }` | Token is active |
| 401 | `{ valid: false, error: "..." }` | Token expired or invalid |
| 403 | `{ valid: false, error: "..." }` | Token lacks permissions |
| Other 4xx/5xx | `{ valid: false, error: "..." }` | AAP unreachable or unexpected error |
| Network error / timeout | `{ valid: false, error: "..." }` | AAP unreachable |

The timeout for init-time validation is 10 seconds (`createTimeoutSignal(10_000)`).

### Error Messages

All auth errors are designed to be **user-actionable** — they tell the operator exactly
what to do (e.g., "Generate a new Personal Access Token at ...").

### References

- ADR 0001: Bearer Token Authentication for AWX Plugin

---

## 3. HTTP Client Middleware Pipeline

**Source:** `src/client.ts`

### Pipeline Architecture

The HTTP client composes five middleware concerns into a single request pipeline:

```
Signal → Timeout → Breaker Gate → Fetch → Retry/Backoff
```

### Client Factory

```typescript
function createClient(
  baseUrl: string,
  token: string,
  opts?: ClientOptions
): AwxClient
```

Returns an `AwxClient` with a single `request()` method that runs every HTTP call
through the pipeline.

### Pipeline Stages

#### Stage 1: Signal Combination

The tool context's `AbortSignal` (from `ToolContext.abort`) and a timeout signal are
combined into a single signal using `anyAbortSignal()`. If either signal fires, the
request is cancelled immediately.

- **Node 20+:** Uses native `AbortSignal.any()`
- **Node 18:** Falls back to manual event wiring

#### Stage 2: Timeout

```typescript
const { signal, clear } = createTimeoutSignal(timeoutMs);
```

The timeout is implemented via `setTimeout` + `AbortController` (not
`AbortSignal.timeout()`) for Node 18 compatibility and vitest fake timer support.
Default timeout: 30 seconds.

#### Stage 3: Circuit Breaker Gate

A per-tool circuit breaker prevents cascading failures when AAP is unreachable.

| State | Behavior |
|-------|----------|
| **CLOSED** | Normal operation — requests pass through |
| **OPEN** | Requests are rejected immediately with a 503 `CIRCUIT_OPEN` response. Transition after **5** consecutive failures. Cooldown: **30 seconds** |
| **HALF-OPEN** | After cooldown elapses, one probe request is allowed. Success → CLOSED. Failure → OPEN again |

The breaker is checked **before every retry attempt**, not just the first request.

#### Stage 4: Native Fetch

Uses the global `fetch()` API — no third-party HTTP dependencies. The `Authorization:
Bearer <token>` header is injected automatically. Caller-supplied headers are merged
(caller wins on conflict).

#### Stage 5: Retry / Exponential Backoff

| Parameter | Value |
|-----------|-------|
| Max retries | **3** (4 total attempts) |
| Base backoff | **1,000 ms** |
| Multiplier | **2×** (exponential) |
| Jitter | **0–50%** of calculated delay |

```
Attempt 0: 1,000ms + jitter
Attempt 1: 2,000ms + jitter
Attempt 2: 4,000ms + jitter
```

**Retry rules:**
- **2xx:** Success — return immediately, reset circuit breaker
- **4xx:** Client error — do NOT retry (except 404/401/403 which return immediately)
- **5xx:** Server error — retry with backoff if attempts remain
- **Network error / abort:** AbortError propagates immediately; network errors retry
- **401:** Also records a token expiry event via metrics

### Configurable Options

```typescript
interface ClientOptions {
  timeoutMs?: number;                  // default: 30_000
  maxRetries?: number;                 // default: 3
  circuitBreakerThreshold?: number;    // default: 5
  circuitBreakerCooldownMs?: number;   // default: 30_000
  metricsStore?: MetricsStore;         // shared or new
}
```

### References

- ADR 0003: Plugin API Surface Discovery (Node 18 compatibility)
- ADR 0006: Connection Resilience Parameters

---

## 4. Metrics Lifecycle

**Source:** `src/metrics.ts`

### Overview

Per-tool counters provide operational visibility and support the Phase 2→3 deprecation
gate (zero PowerShell fallback calls for 14 consecutive days).

### Metric Counters

Each tool tracks:

```typescript
interface ToolMetrics {
  callCount: number;           // Total tool invocations
  errorCount: number;          // Total errors (HTTP, network, etc.)
  totalLatencyMs: number;      // Accumulated round-trip latency
  tokenExpiryEvents: number;   // 401 Unauthorized responses
  psFallbackCount: number;     // PowerShell fallback invocations
}
```

### Durability Model

Counters are **file-backed** to survive plugin reloads:

1. **File format:** JSON at `.metrics/metrics.json` (relative to the working directory)
2. **Atomic writes:** Data is written to a `.tmp` file first, then renamed over the
   target — preventing corruption on partial writes
3. **Merge-on-load:** On `load()`, disk values are merged with in-memory counters using
   `Math.max()` — counters never decrease
4. **Missing file:** Treated as a fresh start (no error thrown)

### Integration Points

Metrics hook into the client pipeline at two places:

```typescript
// In client.ts request() — pipeline boundary:
const start = Date.now();
try {
  const response = await fetch(url, fetchInit);
  // On success:
  metrics.recordCall(toolName, Date.now() - start);
  return response;
} catch (err) {
  // On failure:
  metrics.recordError(toolName);
  metrics.recordTokenExpiry(toolName); // if 401
  throw err;
}
```

### Lifecycle in the Plugin

```
Plugin Load
  ├── MetricsStore created
  ├── metricsStore.load()       ← restores persisted counters
  ├── setupMetricsPersistence() ← starts interval (30s)
  │
  └── Plugin Dispose
      └── persistence.clear()  ← stops interval + final persist()
```

The `setupMetricsPersistence()` helper:

```typescript
function setupMetricsPersistence(
  store: MetricsStore,
  intervalMs: number = 30_000,
  onError?: (err: unknown) => void
): { clear: () => Promise<void> }
```

Uses a serialized persist queue (`persistQueue = Promise.resolve()`) to ensure
concurrent persist calls are sequenced, not parallel.

---

## 5. Output Contracts

**Source:** `src/contracts/`

### Design Philosophy

All tool outputs follow **schema-driven v1.0 contracts** that mirror the exact shape of
the Python `awx_job_detail.py` output. Every contract includes a `schema_version` field
(set to `"1.0"`) for future-proofing.

### Job Detail Contract (`JobDetailOutput`)

```typescript
interface JobDetailOutput {
  schema_version: "1.0";
  job: JobCore;                    // Core job metadata
  related: Related;                // Resolved names (not URLs)
  host_status_counts: HostStatusCounts;  // NOT "host_summary"
  derived: Derived;                // Boolean flags (NOT "extra_vars_summary")
  warnings: string[];
  errors: string[];
  stdout?: string;                 // Optional full job stdout
  raw_events?: unknown[];          // Optional raw events
}
```

**Key naming conventions:**
- `host_status_counts` — NOT `host_summary`
- `derived` — NOT `extra_vars_summary`
- `related` fields are **resolved names** (e.g., `inventory_name`, `project_name`),
  not raw URLs
- `job.limit` is the AWX job limit (host pattern), not a pagination value

### Resource Detail Contracts

| Contract | Source | Resource Types |
|----------|--------|----------------|
| `TemplateDetailOutput` | `contracts/template-detail.ts` | template |
| `ProjectDetailOutput` | `contracts/project-detail.ts` | project |
| `InventoryDetailOutput` | `contracts/inventory-detail.ts` | inventory |

These share a common envelope:

```typescript
interface *DetailOutput {
  schema_version: "1.0";
  resource_type: "template" | "project" | "inventory";
  id: number;
  data: *Data;  // Type-specific payload
}
```

### Resource Mutation Contract (`ResourceMutationOutput`)

Generic envelope for all CRUD operations (create, update, delete):

```typescript
interface ResourceMutationOutput {
  schema_version: "1.0";
  action: "created" | "updated" | "deleted";
  resource_type: "template" | "project" | "inventory";
  id: number;
  data: *Data | null;   // Full detail for create/update; null for delete
  warnings?: string[];
  errors?: string[];
}
```

### Contract Tests

Contract tests in `tests/contract.test.ts` validate that TypeScript interfaces match the
Python `awx_job_detail.py` v1.0 schema using snapshot-based validation:
- Fixture JSON files in `tests/fixtures/` represent pre-baked snapshots
- Tests parse each fixture through the Zod schema and assert structural correctness
- No live Python subprocess is executed

### References

- ADR 0002: Output Contract Alignment with `awx_job_detail.py`

---

## 6. Mapper Functions

**Source:** `src/mappers/` and `src/job-status.ts`

### Role of Mappers

Mapper functions are **pure transformations** that convert raw AWX API responses into
structured contract types. They:
- Extract resolved names from `summary_fields` (not raw IDs)
- Rename fields to match contract conventions (e.g., `failures` → `failed`)
- Compute derived values (e.g., `is_successful` booleans)
- Defensively handle null/missing fields

### Resource Mappers

Each resource type has a dedicated mapper:

| Mapper | Source | Transforms | Output |
|--------|--------|------------|--------|
| `mapTemplate` | `mappers/map-template.ts` | Raw job template API → `TemplateDetailOutput` |
| `mapProject` | `mappers/map-project.ts` | Raw project API → `ProjectDetailOutput` |
| `mapInventory` | `mappers/map-inventory.ts` | Raw inventory API → `InventoryDetailOutput` |

**Example — `mapTemplate()`:**

```typescript
function mapTemplate(raw: unknown): TemplateDetailOutput {
  const t = raw as RawAwxTemplate;
  const sf = t.summary_fields ?? {};
  return {
    schema_version: "1.0",
    resource_type: "template",
    id: t.id ?? 0,
    data: {
      id: t.id,
      name: t.name,
      inventory_name: sf.inventory?.name ?? "",
      project_name: sf.project?.name ?? "",
      // ... more fields
    },
  };
}
```

### Job Status Mapper (`mapAwxJobToContract`)

Located in `src/job-status.ts`, this is a standalone function (not part of the
`mappers/` directory) that transforms raw AWX job API responses into the
`JobDetailOutput` contract. Key transformations:

- **`host_status_counts`**: Maps from AWX `host_summary` (renames `failures` → `failed`)
- **`related`**: Extracts resolved names from `summary_fields`
- **`derived`**: Computes `is_successful`, `is_failed`, `has_unreachable_hosts` from the
  job `status` and `host_summary`
- **`job.extra_vars`**: Parses from JSON string to `Record<string, unknown>` (if valid);
  omitted if parsing fails (AWX may return YAML)

### Dispatch Pattern

Both `get-resource.ts` and `crud.ts` use a **registry + dispatch** pattern:

```typescript
const RESOURCE_REGISTRY = {
  template: { path: "/api/v2/job_templates/{id}/", mapper: mapTemplate },
  project:  { path: "/api/v2/projects/{id}/",        mapper: mapProject },
  inventory:{ path: "/api/v2/inventories/{id}/",     mapper: mapInventory },
};
```

The `getResource()` orchestrator:
1. Looks up the endpoint + mapper from the registry
2. Makes the HTTP request via the client
3. Passes the response through the mapper
4. Returns the structured output

The `executeCrud()` dispatcher similarly maps `{ resource, action }` pairs to the
correct endpoint and mapper.

---

## 7. Tool Registration Patterns

**Source:** `src/index.ts`

### Tool Factory

Every tool is registered using the `tool()` function from `@opencode-ai/plugin/tool`:

```typescript
import { tool } from "@opencode-ai/plugin";
const z = tool.schema;

"awx-list-templates": tool({
  description: "...",
  args: {
    pageSize: z.number().int().min(1).max(200).optional().describe("..."),
    // ... more args via Zod schemas
  },
  async execute(args, context) {
    // 1. Respect abort signal
    // 2. Get or create the AWX client (lazy)
    // 3. Delegate to the orchestrator function
    // 4. Return { output, metadata? }
  },
}),
```

### Common Tool Pattern

Every tool follows the same structure:

```typescript
execute(args, context) {
  // Step 1: Respect abort signal
  if (context.abort?.aborted) {
    return { output: "Request was aborted." };
  }

  // Step 2: Get AWX client (lazy — created on first use)
  let awxClient;
  try {
    awxClient = await getAwxClient();
  } catch (err) {
    return { output: err.message };  // Graceful auth error
  }

  // Step 3: Delegate to orchestrator
  try {
    const result = await someOrchestrator(awxClient, args, context.abort);
    return { output: "...", metadata: result };
  } catch (err) {
    return { output: `error: ${err.message}` };
  }
}
```

### Tool Categories

| Category | Tools | Pattern |
|----------|-------|---------|
| **Scaffolding** | `hello` | Simple greeting — no client needed |
| **List** | `awx-list-templates`, `awx-list-projects`, `awx-list-jobs` | Paginated list with `−-filter` support, returns Markdown table |
| **Detail** | `awx-get-resource` | Single resource by type + ID, returns structured envelope |
| **Lifecycle** | `awx-launch-job`, `awx-job-status`, `awx-wait-job`, `awx-get-job-events` | Job lifecycle, agent-side polling pattern |
| **Action** | `awx-sync-project` | Triggers SCM sync, returns project update ID |
| **CRUD** | `awx-create-*`, `awx-update-*`, `awx-delete-*` (9 tools) | Create/update/delete via the CRUD registry |
| **Configuration** | `awx-configure`, `awx-debug-env` | Plugin configuration and diagnostics |

### Agent-Side Polling Pattern

Job lifecycle tools use an **agent-side polling** pattern (see ADR 0004):

- `awx-launch-job` returns immediately with a job ID (no blocking)
- `awx-job-status` / `awx-wait-job` return the current status
- The agent (not the plugin) loops to poll for completion
- No tool blocks waiting for job completion

### Error Handling Strategy

- **Abort signal checked** at the top of every `execute()` function
- **Client creation errors** caught with a user-facing message (no raw stack traces)
- **API errors** caught and returned gracefully — never thrown from `execute()`
- **Error metadata** includes `schema_version` for contract consistency

### Complete Tool Inventory

As of this writing, the AWX plugin registers 20+ tools:

| Tool Name | Source Function | Output Format |
|-----------|----------------|---------------|
| `hello` | Inline | Text |
| `awx-list-templates` | `listTemplates()` | Markdown table + metadata |
| `awx-list-projects` | `listProjects()` | Markdown table + metadata |
| `awx-list-jobs` | `listJobs()` | Markdown table + metadata |
| `awx-launch-job` | `launchJob()` | Raw JSON |
| `awx-job-status` | `fetchJobStatus()` | `JobDetailOutput` JSON |
| `awx-wait-job` | `fetchJobStatus()` | `JobDetailOutput` JSON |
| `awx-get-job-events` | Inline | Text + metadata |
| `awx-sync-project` | Inline | Text + metadata |
| `awx-get-resource` | `getResource()` | Structured envelope |
| `awx-configure` | Inline | Text confirmation |
| `awx-debug-env` | Inline | JSON string |
| `awx-create-project` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-create-template` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-create-inventory` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-update-project` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-update-template` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-update-inventory` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-delete-project` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-delete-template` | `executeCrud()` | `ResourceMutationOutput` |
| `awx-delete-inventory` | `executeCrud()` | `ResourceMutationOutput` |

---

## 8. Architecture Decision Records

The following ADRs document the design rationale behind the AWX plugin architecture.
They are located in the monorepo at `docs/adr/`.

| ADR | Title | Relevant To |
|-----|-------|-------------|
| [ADR 0001](../../../docs/adr/0001-bearer-token-auth-model.md) | Bearer Token Authentication for AWX Plugin | Auth hook, PAT flow |
| [ADR 0002](../../../docs/adr/0002-output-contract-alignment.md) | Output Contract Alignment with `awx_job_detail.py` | Output contracts, field naming |
| [ADR 0003](../../../docs/adr/0003-plugin-api-surface-discovery.md) | Plugin API Surface Discovery | Plugin entry point, Node 18 compat |
| [ADR 0004](../../../docs/adr/0004-non-blocking-awx-wait-job.md) | Agent-Side Polling (Non-Blocking `awx-wait-job`) | Tool registration, polling pattern |
| [ADR 0005](../../../docs/adr/0005-extra-var-transformations-in-plugin.md) | Extra-Variable Transforms (Superseded) | Historical — transforms removed |
| [ADR 0006](../../../docs/adr/0006-connection-resilience-parameters.md) | Connection Resilience Parameters | Retry/backoff, circuit breaker, timeout |
| [ADR 0007](../../../docs/adr/0007-plugin-entry-point-export-hygiene.md) | Plugin Entry Point Export Hygiene | Server function signature |

---

## 9. Domain Glossary Cross-Reference

The project-wide domain glossary in `CONTEXT.md` defines key terms used throughout the
AWX plugin. Here is how those terms map to the architecture:

| Term (from CONTEXT.md) | Architecture Relevance |
|------------------------|----------------------|
| **Plugin** | The entire `packages/awx/` package, registered via `@weiyentan/opencode-plugin-awx` |
| **Tool** | Each function in the `tool` record returned by `server()` |
| **Auth hook** | The `type: "api"` auth hook created by `createAwxAuthHook()` |
| **Agent-side polling** | Pattern used by `awx-launch-job` / `awx-job-status` / `awx-wait-job` trio |
| **Bearer token** | The PAT stored via the auth hook and injected as `Authorization: Bearer` |
| **Output contract** | `JobDetailOutput` (v1.0) and other typed contracts in `src/contracts/` |
| **Extra-var transformations** | Historical — `awx-launch-job` now passes extra_vars verbatim |
| **Plugin server function** | The `server()` function exported from `src/index.ts` |
| **Middleware pipeline** | The 5-stage pipeline in `src/client.ts` (signal/timeout/breaker/fetch/retry) |
| **Circuit breaker** | `CircuitBreaker` class in `src/client.ts` — per-tool states: CLOSED, OPEN, HALF-OPEN |
| **Metrics store** | `MetricsStore` class in `src/metrics.ts` — file-backed per-tool counters |

---

## Summary Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      OpenCode Server                                 │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  AWX Plugin (packages/awx/)                                  │   │
│  │                                                              │   │
│  │  server(PluginInput) → Hooks                                 │   │
│  │    ├── auth: createAwxAuthHook()                             │   │
│  │    ├── tool: {                                                │   │
│  │    │     hello, awx-list-*, awx-launch-job,                   │   │
│  │    │     awx-job-status, awx-wait-job, awx-create-*,          │   │
│  │    │     awx-update-*, awx-delete-*, ...                     │   │
│  │    │   }                                                      │   │
│  │    └── dispose: persistence.clear()                           │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │
│  │  │  getAwxClient() — Lazy 3-tier token resolution     │     │   │
│  │  │  1. customConfig (awx-configure)                    │     │   │
│  │  │  2. getSecret?.("awx")                              │     │   │
│  │  │  3. process.env.AWX_TOKEN                           │     │   │
│  │  └──────────────┬──────────────────────────────────────┘     │   │
│  │                 ↓                                            │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │
│  │  │  createClient(baseUrl, token) → AwxClient           │     │   │
│  │  │                                                     │     │   │
│  │  │  request(toolName, path, init, signal) → Response  │     │   │
│  │  │    ├── Signal combine (abort + timeout)             │     │   │
│  │  │    ├── Circuit breaker gate                         │     │   │
│  │  │    ├── fetch(url, { headers, signal })              │     │   │
│  │  │    ├── Retry loop (3 attempts, exp. backoff)        │     │   │
│  │  │    └── Metrics (recordCall, recordError, ...)       │     │   │
│  │  └─────────────────────────────────────────────────────┘     │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │
│  │  │  Orchestrators (get-resource.ts, crud.ts)           │     │   │
│  │  │    ├── Registry: type → { endpoint, mapper }        │     │   │
│  │  │    └── Dispatch: HTTP → mapper → output             │     │   │
│  │  └─────────────────────────────────────────────────────┘     │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │
│  │  │  Mappers (src/mappers/*.ts, src/job-status.ts)     │     │   │
│  │  │    Pure functions: raw API → structured contract    │     │   │
│  │  └─────────────────────────────────────────────────────┘     │   │
│  │                                                              │   │
│  │  ┌─────────────────────────────────────────────────────┐     │   │
│  │  │  Metrics (src/metrics.ts)                           │     │   │
│  │  │    MetricsStore (in-memory)                         │     │   │
│  │  │      ↕ load/persist                                  │     │   │
│  │  │    .metrics/metrics.json (file-backed)               │     │   │
│  │  └─────────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```
