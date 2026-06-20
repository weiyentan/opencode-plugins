# OpenCode Plugins — Domain Glossary

## Core Concepts

| Term | Definition |
|------|-----------|
| **Plugin** | An OpenCode server extension that registers tools and auth hooks. Lives in the `packages/` workspace. |
| **Tool** | A registered function callable by the OpenCode agent. Maps to an AWX REST API operation. |
| **Auth hook** | OpenCode's mechanism for storing and injecting credentials (e.g., bearer tokens) into plugin requests. |
| **Agent-side polling** | Pattern where a tool returns immediately (e.g., job ID) and the agent calls a status tool in a loop, rather than blocking the plugin process. |

## AWX Plugin Domain

| Term | Definition |
|------|-----------|
| **Bearer token** | A Personal Access Token (PAT) from AAP used in `Authorization: Bearer <token>` header. Validated via spike against `aap.tanscloud-internal.com`. |
| **Output contract** | The structured response shape returned by job-related tools, matching `awx_job_detail.py` v1.0 schema. Top-level fields: `schema_version` ("1.0"), `job` (core metadata), `related` (resolved names — not URLs), `host_status_counts` (not `host_summary`), `derived` (boolean flags — not `extra_vars_summary`), `warnings`, `errors`. Optional: `stdout`, `raw_events`. |
| **Extra-var transformations** | Business logic converting SSH→HTTPS URLs, inferring git branches, and validating required vars. Lives in the plugin's `transforms.ts` module (not in skills). |
| **Plugin server function** | Entry point for a server-side plugin. Receives `PluginInput` (`client`, `project`, `directory`, `worktree`, `serverUrl`, `$` shell) and returns `Hooks` (including `auth`, `tool`, `event`, etc.). |
| **Tool function** | `tool({ description, args: zodSchema, execute })` from `@opencode-ai/plugin/tool`. Returns `ToolResult` (`string` or `{ output, metadata? }`). Context includes `abort: AbortSignal` for timeouts. |
| **Auth hook (API type)** | Auth method with `type: "api"` and `authorize()` returning `{ type: "success", key }`. Used for bearer token / PAT storage. |
| **Phase 0** | Pre-implementation spike phase: auth verification, contract alignment, plugin API discovery, tool-action mapping table. |
| **Tool-action mapping table** | A complete accounting of all 22 `awx-helper.ps1` actions and their plugin tool replacement (or documented gap). |
| **Middleware pipeline** | The request-processing chain in `client.ts`: abort signal → timeout → circuit breaker gate → `fetch` → retry/backoff. No third-party HTTP dependencies; uses native `fetch` and `AbortSignal`. |
| **Circuit breaker** | Per-tool resilience pattern in `client.ts`. States: CLOSED (normal), OPEN (reject fast after N consecutive failures), HALF-OPEN (probe after cooldown). Default trip: 5 consecutive errors, cooldown: 30s. |
| **Metrics store** | File-backed per-tool counters in `metrics.ts` (call count, error count, latency, token expiry, PowerShell fallback). Survives plugin reloads via atomic JSON writes. |

## Infrastructure

| Term | Definition |
|------|-----------|
| **AAP** | Ansible Automation Platform at `https://aap.tanscloud-internal.com`. Runs AWX 21.0.0+ (AAP 2.3+). |
