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
| **Bearer token** | A Personal Access Token (PAT) from AAP used in `Authorization: Bearer <token>` header. Validated via spike against `example.com`. |
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
| **AAP** | Ansible Automation Platform at `https://example.com`. Runs AWX 21.0.0+ (AAP 2.3+). |

## GitHub / GitLab Plugin Domain

### GitHub Plugin (@weiyentan/opencode-plugin-github)
An OpenCode plugin that exposes GitHub API capabilities as plugin tools. Uses REST for CRUD operations and GraphQL for rich context queries. Developer-facing toolset — optimized for the workflows a developer or AI agent does daily: browse issues, review PRs, search code, get context.

### GitLab Plugin (@weiyentan/opencode-plugin-gitlab)
An OpenCode plugin that exposes GitLab API capabilities as plugin tools. Follows the same architecture as the GitHub plugin but uses GitLab-native terminology (merge requests → `mr` prefix) and API semantics.

### Portability Principle
Tools are designed for platform portability. Each tool has an abstract shape (list, get, create, search) mapped to each platform's API. The tool surface is intentionally generic — only concepts that exist on both platforms are included in the initial feature set. Platform-specific tools (e.g., PR reviews, GitLab-specific features) are deferred to later iterations.

### Tool Namespace Convention
- GitHub tools use dot-notation with platform prefix: `github.issue.list`, `github.pr.create`, `github.code.search`
- GitLab tools use dot-notation with platform prefix: `gitlab.issue.list`, `gitlab.mr.create`, `gitlab.code.search`
- Merge requests use `mr` (not `pr`) in GitLab tool names to match GitLab's native terminology

### Monorepo Structure
All plugin packages live in a single monorepo at `github.com/weiyentan/opencode-plugins`. Each package is fully independent — no shared runtime code between packages, only shared architecture patterns. CI uses path-filtered workflows to test and publish only the package that changed. This structure reduces overhead while keeping things discoverable.
