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
- GitHub tools use underscore-notation with platform prefix: `github_issue_list`, `github_pr_create`, `github_code_search`
- GitLab tools use underscore-notation with platform prefix: `gitlab_issue_list`, `gitlab_mr_create`, `gitlab_code_search`
- Merge requests use `mr` (not `pr`) in GitLab tool names to match GitLab's native terminology

## SQLite Plugin Domain

| Term | Definition |
|------|-----------|
| **sqlite_tables** | Tool that lists all tables in the connected SQLite database by querying `sqlite_master`. Returns markdown table output and metadata with table names. |
| **sqlite_schema** | Tool that inspects a specific table's schema via `PRAGMA table_info`. Returns column names, types, nullability, default values, and primary key flags. |
| **sqlite_query** | Tool that executes a read-only SQL query (SELECT, PRAGMA, EXPLAIN, WITH) against the database. Enforces read-only validation — rejects INSERT, UPDATE, DELETE, DROP, ALTER, CREATE. Returns markdown table output with row count and execution time. |
| **OPENCODE_DB_PATH** | Environment variable pointing to the SQLite database file. Defaults to `~/.local/share/opencode/opencode.db`. |
| **Read-only enforcement** | Business logic in `query.ts` that validates SQL statements start with allowed prefixes (SELECT, PRAGMA, EXPLAIN, WITH) and rejects multi-statement input. Prevents accidental or malicious writes to the database. |
| **better-sqlite3** | Synchronous SQLite3 driver used by the plugin. Connection is opened lazily in read-only mode with `query_only = true` pragma for defense-in-depth. |

### Monorepo Structure
All plugin packages live in a single monorepo at `github.com/weiyentan/opencode-plugins`. Each package is fully independent — no shared runtime code between packages, only shared architecture patterns. CI uses path-filtered workflows to test only the affected packages on push/PR. Publishing is manual via `workflow_dispatch` with a selected package; version and dist-tag are auto-derived from `package.json`. This structure reduces overhead while keeping things discoverable.

## AFK Review Service

| Term | Definition |
|------|-----------|
| **/afk_review** | Endpoint that accepts a PR key (e.g. `owner/repo/number`) and initiates an automated review. Protected by duplicate-detection via `ReviewStateTracker`. |
| **ReviewStateTracker** | In-memory state tracker in `src/fast_api_eda_gateway/review_state_tracker.py`. Maintains a dict of `pr_key → started_at` timestamps to prevent concurrent reviews of the same PR. |
| **In-flight state** | A PR marked as currently being reviewed. While in-flight (and not stale), duplicate `/afk_review` calls are rejected with status 409 and reason `review_already_in_flight`. |
| **Stale in-flight TTL** | Configurable time-to-live (in seconds) after which an in-flight entry is considered stale. When stale, a new `/afk_review` is accepted and the entry is reset. Stale acceptance logs `reason=review_in_flight_expired`. |
| **REVIEW_IN_FLIGHT_TTL_SECONDS** | Environment variable controlling the stale TTL. Default: `3600` (1 hour). Set to a lower value (e.g. `600` for 10 minutes) to unblock review re-attempts sooner after a failed review. Configurable in `src/config/settings.py`.
