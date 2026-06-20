# PRD: OpenCode AWX Plugin (`@opencode-ai/plugin-awx`) — Refined

## Problem Statement

The current AWX connectivity stack in OpenCode relies on brittle PowerShell 5.1 scripts that accumulate significant technical debt and waste agent tokens on infrastructure failures:

1. **PowerShell 5.1 lock-in** — The `AnsibleTower` module uses .NET Framework's `ICertificatePolicy`, forcing all scripts to run under Windows PowerShell 5.1 (not pwsh). This blocks migration to modern PowerShell and creates compatibility issues on systems where PowerShell 5.1 is unavailable or deprecated. Linux and macOS users have no native AWX access path.

2. **Credential XML file on disk** — Authentication depends on a `PSCredential` XML file at `$env:USERPROFILE\awx-credential.xml`. If this file is missing, expired, or never created, every script fails with a cryptic error. The file is a plain-text-adjacent secret storage mechanism with no encryption-at-rest guarantees.

3. **Hardcoded URLs** — The Tower URL (`https://aap.tanscloud-internal.com`) is hardcoded in every script. The stack is non-portable: any team with a different AAP instance must fork all scripts and modify URLs manually.

4. **Duplicated module discovery** — The `Import-AwxModule` function (parsing `PSModulePath`, OneDrive paths, and regex-parsing `.psd1` for version checks) is copy-pasted across multiple scripts with no shared library.

5. **Dot-source coupling** — Every script dot-sources `Connect-Awx.ps1`, inheriting its entire execution context. This makes scripts difficult to test, debug, or run in isolation.

6. **SSL bypass everywhere** — Every connection uses `-DisableCertificateVerification` with no option for trusted certificates. There is no path to production-grade TLS verification.

7. **Token wastage and agent reliability** — When scripts fail mid-flow (credential expired, module not found, URL unreachable), the agent retries, burning conversation tokens on debugging brittle infrastructure rather than performing the actual task. This creates a poor user experience and reduces the effective context window available for productive work.

## Solution

Build an OpenCode server plugin (`@opencode-ai/plugin-awx`) that wraps AWX's REST API directly via Node.js `fetch`, eliminating PowerShell entirely. The plugin registers seven tools with OpenCode, each performing a specific AWX operation over HTTP.

### Auth Model

- **Bearer token** (Personal Access Token) stored via OpenCode's plugin `auth` hook with `type: "api"`.
- The user generates a PAT once from the AAP UI (`/api/v2/tokens/` or Profile → Tokens). The plugin prompts for it during initial setup.
- Every tool call attaches `Authorization: Bearer <token>` to requests.
- No credential files on disk, no PowerShell module dependencies, no SSL bypass.
- Bearer token viability has been **verified** against the target AAP instance (`https://aap.tanscloud-internal.com`) — a curl spike confirmed 200 OK.
- OAuth2 token refresh is **deferred to v2**; MVP uses single PAT per session.

### Generic by Design

- Plugin code contains zero hardcoded URLs.
- `baseUrl` is configured per-user in `opencode.jsonc`:
  ```jsonc
  { "plugin": [["./packages/awx", { "baseUrl": "https://aap.tanscloud-internal.com" }]] }
  ```
- Anyone with an AAP instance can use the plugin with their own config and token.

### Output Contract

All job-related tools return a structured response matching the `awx_job_detail.py` v1.0 schema:

```typescript
interface JobDetailOutput {
  schema_version: "1.0";
  job: {
    id: number;
    name: string;
    status: string;       // "successful" | "failed" | "running" | ...
    failed: boolean;
    job_type: string;
    playbook: string;
    created: string;
    started: string | null;
    finished: string | null;
    elapsed: number | null;
    execution_node: string;
    controller_node: string;
    scm_branch: string;
    verbosity: number;
    forks: number | null;
    limit: string;
  };
  related: {
    inventory_name: string;
    project_name: string;
    job_template_name: string;
    instance_group_name: string;
    created_by: string;
    credential_names: string[];
    label_names: string[];
  };
  host_status_counts: {
    ok: number;
    failed: number;
    skipped: number;
    changed: number;
    unreachable: number;
  };
  derived: {
    is_successful: boolean;
    is_failed: boolean;
    has_unreachable_hosts: boolean;
  };
  warnings: string[];
  errors: string[];
  stdout?: string;        // only with awx-job-status --include-stdout
  raw_events?: unknown[];  // only with --include-events
}
```

This contract has been **verified** against all three existing fixtures (`awx_job_success.json`, `awx_job_partial.json`, `awx_job_failure.json`) by running them through the actual `awx_job_detail.py` Python script.

### Scope and Coverage

The plugin covers **7 of 22 actions** (approximately 30%) from the existing `awx-helper.ps1` script. This is an honest accounting — critical-path operations are covered, and a full tool-action mapping table documents which actions have plugin equivalents and which remain as documented gaps.

## User Stories

1. As an **OpenCode user**, I want to launch an AWX job template by name with optional extra vars, so that I can trigger automation runs without leaving my agent session.

2. As an **OpenCode user**, I want to check the status of a running or completed AWX job, so that I can determine whether my automation succeeded, failed, or is still in progress.

3. As an **OpenCode user**, I want to wait for a job to complete and get its final status, so that I can proceed with next steps once the automation finishes — without blocking the plugin process.

4. As an **OpenCode user**, I want to list and search available job templates, so that I can discover which templates are available and pick the right one for my task.

5. As an **OpenCode user**, I want to list and search available projects, so that I can verify project state and find the project I need to sync.

6. As an **OpenCode user**, I want to trigger a project synchronisation from the SCM source, so that I can pick up latest changes from Git before launching a job.

7. As an **OpenCode user**, I want to retrieve job events for a running or completed job, so that I can debug failures and understand task-level execution details.

8. As an **OpenCode user**, I want to authenticate to AWX via a bearer token stored securely by the plugin, so that I never have to handle credential files or re-authenticate mid-session.

9. As an **OpenCode user**, I want to configure the AAP base URL in `opencode.jsonc`, so that the plugin works with any AAP instance without code changes.

10. As a **platform maintainer**, I want to deprecate the brittle PowerShell scripts, so that the AWX connectivity stack is maintainable, portable, and testable on any OS.

## Implementation Decisions

### Plugin Architecture

The plugin follows the `@opencode-ai/plugin` v1.14.29 API surface:

- **Entry point:** `index.ts` exports a `PluginModule` with a `server()` function that receives `PluginInput` (`client`, `project`, `directory`, `worktree`, `serverUrl`, `$` shell) and returns `Hooks`.
- **Tool registration:** Each tool uses `tool({ description, args: zodSchema, execute })` from `@opencode-ai/plugin/tool`.
- **Auth hook:** Uses `type: "api"` with `authorize()` returning `{ type: "success", key: "<pat>" }`.
- **Tool context:** Each `execute` receives `ToolContext` with `sessionID`, `abort: AbortSignal` (for runtime-level cancellation), `metadata()`, and `ask()`.

### Auth Module (`auth.ts`)

- Single auth method with `type: "api"` and a `token` text prompt.
- The `authorize` function returns the PAT as the secret key.
- Token validation happens on plugin load (see Init-Time Validation below), not on first tool call.
- OAuth2 token refresh is out of scope for v1.

### Client Module (`client.ts`)

- A thin `fetch` wrapper that encapsulates all HTTP resilience logic.
- Parameters:
  | Parameter | Value |
  |-----------|-------|
  | Request timeout | 30s default (10s for health-check) |
  | Retry policy | Exponential backoff (1s, 2s, 4s), 3 retries max, **5xx only** |
  | Auth failure retry | Zero retries for 401/403/404 |
  | Circuit breaker | Fail fast if AAP health-check fails on consecutive init attempts |
- No third-party HTTP dependencies — uses Node.js 18+ native `fetch`.
- All fetch calls wired to `ToolContext.abort` for runtime-level cancellation.
- Standard error handling for HTTP 401 (unauthorised), 403 (forbidden), 404 (not found), and 5xx (server error) responses.

### Transforms Module (`transforms.ts`)

A shared utility module containing pure functions, importable by any tool or external caller:

- **`sshToHttps(url: string): string`** — Converts SSH Git URLs (`git@gitlab.com:org/repo.git`) to HTTPS URLs (`https://gitlab.com/org/repo`). Replicates the PowerShell helper's `ConvertTo-HttpsUrl` logic.
- **`inferBranch(): Promise<string | undefined>`** — Runs `git branch --show-current` to detect the current branch if none is specified.
- **`validateRequiredVars(vars: Record<string, unknown>, required: string[]): string[]`** — Validates that all required vars are present. Returns list of missing var names. Configurable list is the caller's responsibility (per-deployment).

The `awx-launch-job` tool imports `transforms.ts` and applies transformations before making the API call.

### Tool Design

- **`awx-launch-job`** — Resolves job template ID by name via `GET /api/v2/job_templates/?name=<name>`, then POSTs to `/api/v2/job_templates/<id>/launch/` with optional extra vars. Applies extra-var transformations (SSH→HTTPS, branch inference) before POST. Returns the full v1.0 contract.

- **`awx-job-status`** — `GET /api/v2/jobs/<id>/` and transform response to v1.0 contract. Includes `related` resolved names, `host_status_counts`, and `derived` boolean flags. Optional `--include-stdout` flag.

- **`awx-wait-job`** — **Non-blocking.** Returns immediately with `{ jobId: number }`. The agent performs a documented poll loop via `awx-job-status`:
  ```
  1. awx-launch-job({ template, extra_vars }) → { jobId: 42 }
  2. loop {
       awx-job-status({ jobId: 42 })
       if status.job.status in ["successful", "failed", "canceled", "error"] → break
       sleep(10s + jitter) → continue
     }
  ```
  No server-side polling loop. The `abort` signal in `ToolContext` provides runtime-level cancellation for the single status GET call.

- **`awx-list-templates`** — `GET /api/v2/job_templates/` with optional `?name__icontains=<query>` filter. Consolidates paginated results into a single list. Returns `{ templates: [...] }`.

- **`awx-list-projects`** — `GET /api/v2/projects/` with optional `?name__icontains=<query>` filter. Consolidates paginated results. Returns `{ projects: [...] }`.

- **`awx-sync-project`** — Resolves project ID by name via `GET /api/v2/projects/?name=<name>`, then POSTs to `/api/v2/projects/<id>/update/`. Returns the update job status in the v1.0 contract format.

- **`awx-get-job-events`** — Simple passthrough: `GET /api/v2/jobs/<id>/job_events/`. Returns raw job events array for debugging. Minimal transformation — no v1.0 contract wrapping.

### Init-Time Validation

On plugin load, before any tool is registered:

1. `GET /api/v2/me/` — Validates the bearer token is active.
2. `GET /api/v2/` — Detects AAP version, caches it, refuses to initialise if below AAP 2.3 (AWX 21.0.0+).

This prevents silent failures: if the token is invalid or AAP is unreachable, the user gets a clear error message immediately rather than on the first tool call.

### Structured Metrics

Minimum metrics for operational visibility and phase-gating:

- Per-tool call count
- Per-tool error count (by HTTP status code category)
- Per-tool latency (p50, p95)
- Token expiry events (401 detection)
- PowerShell fallback usage count (for deprecation monitoring)

Metrics are exported via simple counters in the plugin — no external monitoring integration required for v1.

## Tool-Action Mapping

This table accounts for all 22 actions in the existing `awx-helper.ps1`:

| `awx-helper.ps1` action | Plugin tool | v1 covered | Business logic lost in v1 |
|---|---|---|---|
| launch | `awx-launch-job` | ✅ | — (transforms in plugin) |
| wait-job | `awx-wait-job` → agent poll pattern | ✅ | — |
| list-templates | `awx-list-templates` | ✅ | — |
| list-projects | `awx-list-projects` | ✅ | — |
| sync-project | `awx-sync-project` | ✅ | — |
| get-job-events | `awx-get-job-events` | ✅ | — |
| get-template | **gap** | ❌ | Must use PowerShell fallback |
| get-job-stdout | **gap** (can use `awx-job-status --include-stdout`) | ❌ | Low priority |
| get-jobs | **gap** | ❌ | Low priority |
| list-credentials | **gap** | ❌ | Medium priority |
| list-inventories | **gap** | ❌ | Low priority |
| list-ee | **gap** | ❌ | Low priority |
| list-organizations | **gap** | ❌ | Low priority |
| list-hosts | **gap** | ❌ | Low priority |
| list-users | **gap** | ❌ | Low priority |
| list-teams | **gap** | ❌ | Low priority |
| list-instance-groups | **gap** | ❌ | Low priority |
| add-template | **gap** | ❌ | Very low priority |
| update-project | **gap** | ❌ | Very low priority |
| ... (3 more) | **gap** | ❌ | Very low priority |

## Phase-Gate Criteria

Measurable triggers for each phase transition:

| Gate | Trigger |
|------|---------|
| Phase 0→1A | Auth spike complete, contract aligned, plugin API known |
| Phase 1A→1B | Read-only tools (`list-templates`, `list-projects`) passing integration tests |
| Phase 1B→1C | Job tools (`launch`, `status`, `wait`, `get-events`) passing integration tests |
| Phase 1C→2 | Plugin handles 100% of agent-initiated AWX calls for 7 consecutive days |
| Phase 2→3 | Zero PowerShell AWX calls for 14 consecutive days |
| Phase 3→4 | No user complaints about deprecation for 30 days |

## Package Structure

```
opencode-plugins/
├── packages/
│   └── awx/
│       ├── package.json              # @opencode-ai/plugin as peer dep
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts              # Plugin entry: server() → Hooks { auth, tool }
│       │   ├── auth.ts               # Auth hook: type: "api", authorize() → PAT
│       │   ├── client.ts             # HTTP client: fetch, timeout, retry, circuit breaker
│       │   ├── transforms.ts         # SSH→HTTPS, branch inference, var validation
│       │   ├── metrics.ts            # Per-tool counters
│       │   ├── contracts/
│       │   │   └── job-detail.ts     # TypeScript types matching v1.0 contract
│       │   └── tools/
│       │       ├── launch-job.ts
│       │       ├── job-status.ts
│       │       ├── wait-job.ts
│       │       ├── list-templates.ts
│       │       ├── list-projects.ts
│       │       ├── sync-project.ts
│       │       └── get-job-events.ts
│       └── tests/
│           ├── fixtures/             # awx_job_{success,partial,failure}.json
│           ├── client.test.ts        # Timeout/retry/circuit-breaker behavior
│           ├── transforms.test.ts    # SSH→HTTPS, branch inference
│           ├── contract.test.ts      # Python vs TypeScript diff gate
│           ├── tools/                # Per-tool unit tests (mocked fetch)
│           └── integration/          # Live AAP tests (requires AWX_TOKEN)
└── docs/
    └── prd/
        └── plugin-awx-refined.md     # This document
```

## Testing Decisions

### Test Philosophy

- Test **external behavior**, not implementation details.
- The output contract is the system boundary — every tool's output must match the v1.0 contract exactly.

### Test Layers

| Layer | Scope | Dependencies | Priority |
|-------|-------|-------------|----------|
| **Contract** | Fixture-based: run 3 fixtures through both Python and TypeScript, assert field-exact match | Fixture JSON files | **Zeroeth deliverable** — must pass before any tool code |
| **Unit** | Individual tool modules, client helpers, transforms | Mocked fetch | Build alongside each tool |
| **Integration** | End-to-end flow against live AAP | Live AAP + valid AWX_TOKEN env var | After all unit tests pass |

### Key Tests

- **`contract.test.ts`** — The zeroeth deliverable. Loads `awx_job_success.json`, `awx_job_partial.json`, `awx_job_failure.json`, runs them through both the Python script's output and the TypeScript contract module's output, asserts field-exact match. CI gate.
- **`client.test.ts`** — Verifies timeout behavior, retry on 5xx, zero retry on 4xx, circuit breaker behavior.
- **`transforms.test.ts`** — SSH→HTTPS conversion (happy path, edge cases like no-match), branch inference (with and without git repo), required-var validation (all present, some missing).
- **`tools/`** — Per-tool mocked tests using fixtures. Verify: correct API calls, correct contract transformation, correct error handling.
- **`integration/`** — Live AAP tests (gated behind `AWX_TOKEN` env var). Full lifecycle: launch → wait → status → events.

### Prior Art

The existing `awx_job_detail.py` test suite at `C:\ai\opencode\tests\fixtures\` uses the same fixture-driven approach. The TypeScript contract tests mirror this pattern.

## Out of Scope (V1)

- **CRUD operations** — Creating, updating, or deleting job templates, projects, inventories, or credentials.
- **User/team management** — Managing AAP users, teams, or role-based access control.
- **Inventory management** — Listing, creating, or syncing inventories and inventory sources.
- **Workflow job templates** — Launching or monitoring workflow job templates (not the same as regular job templates).
- **TUI plugin** — An interactive terminal UI for AWX operations is a separate concern.
- **Credential management** — Creating or updating AAP credentials from the plugin.
- **Tower CLI passthrough** — Running arbitrary `awx` CLI commands through the plugin.
- **Multi-instance support** — Operating against multiple AAP instances simultaneously in one session.
- **Auto-retry on failure** — The plugin reports failures as they occur; auto-retry is the caller's responsibility.
- **OAuth2 token refresh** — Deferred to v2; v1 uses single PAT per session.
- **16 of 22 `awx-helper.ps1` actions** — These remain as documented gaps; PowerShell fallback required.

## Further Notes

### Resolved Critical Unknowns

Three foundational unknowns from the initial PRD have been resolved:

| Unknown | Resolution |
|---------|-----------|
| Bearer token viability | ✅ Verified: `curl` to `/api/v2/me/` returned 200 OK on target AAP |
| Output contract alignment | ✅ Verified: corrected types match actual Python output across all 3 fixtures |
| Plugin API surface | ✅ Discovered: `@opencode-ai/plugin` v1.14.29 types at `C:\ai\opencode\node_modules\@opencode-ai\plugin` |

### Remaining Unknowns for Implementation

- **Plugin hot-reload** — Whether plugin updates require a server restart affects Phase 1→2 transition disruptiveness.
- **AAP rate limits** — Safe polling defaults depend on target instance configuration.
- **Skill renderer field usage** — grep the skill repository for `host_status_counts`, `derived`, `schema_version` to know which fields are critical vs. unused.

### Rollout Strategy (7 Phases)

| Phase | Content | Estimated effort |
|-------|---------|-----------------|
| Phase 0 | Spikes & alignment (✅ resolved) | 6-10 hours |
| Phase 1A | Read-only tools (`list-templates`, `list-projects`) — proofs auth, client, contract output | 3-5 hours |
| Phase 1B | Job tools (`launch`, `status`, `wait`, `get-events`) | 3-5 hours |
| Phase 1C | Sync tool + integration + metrics | 3-5 hours |
| Phase 2 | Per-skill updates (3 skills) with tool-action mapping guide | 6-14 hours |
| Phase 3 | Deprecation with monitoring gate | 1-2 hours |
| Phase 4 | Retirement | 0.5 hours |
| **Total** | | **~23-42 hours** |

### Security Considerations

- Bearer token held in memory only (via the plugin `auth` hook) and never persisted to disk by the plugin.
- TLS verification always enabled (Node.js native `fetch` enforces this by default).
- Extra vars in job responses are redacted (`***REDACTED***`) for known secret patterns (AWS keys, GitHub PATs, GitLab PATs, password-like keys).
- No credential XML files, no `-DisableCertificateVerification`, no PowerShell module discovery.
- Credential lifecycle: user generates PAT in AAP UI, plugin stores in memory only, revocation is detected on next API call (401).

### API Compatibility

- Plugin targets AWX REST API at AAP 2.3+ (AWX 21.0.0+).
- Init-time version check (`GET /api/v2/`) validates minimum version before registering tools.
- The `awx_job_detail.py` v1.0 schema is the canonical output contract; any changes require a schema version bump which consuming skills must check.

### Architecture Decision Records

This PRD is supported by ADRs in `docs/adr/`:

- `0001-bearer-token-auth-model.md` — Bearer token PAT auth confirmed working
- `0002-output-contract-alignment.md` — Corrected output contract matching Python
- `0003-plugin-api-surface-discovery.md` — Plugin API types discovered
- `0004-non-blocking-awx-wait-job.md` — Non-blocking polling pattern
- `0005-extra-var-transformations-in-plugin.md` — `transforms.ts` shared helper
- `0006-connection-resilience-parameters.md` — Timeout, retry, circuit breaker spec
