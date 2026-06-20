# PRD: OpenCode AWX Plugin (`@opencode-ai/plugin-awx`)

## Problem Statement

The current AWX connectivity stack in OpenCode relies on brittle PowerShell scripts that have accumulated significant technical debt:

1. **PowerShell 5.1 lock-in** — The `AnsibleTower` PowerShell module uses .NET Framework's `ICertificatePolicy`, forcing all scripts to run under Windows PowerShell 5.1 (not pwsh). This blocks migration to modern PowerShell and creates compatibility issues on systems where PowerShell 5.1 is unavailable or deprecated.

2. **Credential XML file on disk** — Authentication depends on a `PSCredential` XML file at `$env:USERPROFILE\awx-credential.xml`. If this file is missing, expired, or never created, every script fails with a cryptic error. The file is a plain-text-adjacent secret storage mechanism with no encryption-at-rest guarantees.

3. **Hardcoded URLs** — The Tower URL (`https://aap.tanscloud-internal.com`) is hardcoded in every script. The stack is non-portable: any team with a different AAP instance must fork all scripts and modify URLs manually.

4. **Duplicated module discovery** — The `Import-AwxModule` function (parsing `PSModulePath`, OneDrive paths, and regex-parsing `.psd1` for version checks) is copy-pasted across multiple scripts with no shared library.

5. **Dot-source coupling** — Every script dot-sources `Connect-Awx.ps1`, inheriting its entire execution context. This makes scripts difficult to test, debug, or run in isolation.

6. **SSL bypass everywhere** — Every connection uses `-DisableCertificateVerification` with no option for trusted certificates. There is no path to production-grade TLS verification.

7. **Token wastage and agent reliability** — When scripts fail mid-flow (credential expired, module not found, URL unreachable), the agent retries, burning conversation tokens on debugging brittle infrastructure rather than performing the actual task. This creates a poor user experience and reduces the effective context window available for productive work.

## Solution

Build an OpenCode server plugin (`@opencode-ai/plugin-awx`) that wraps AWX's REST API directly via Node.js `fetch`, eliminating PowerShell entirely. The plugin registers six tools with OpenCode, each performing a specific AWX operation over HTTP.

### Auth Model

- Bearer token stored via OpenCode's plugin `auth` hook (API-key style storage).
- The user generates a token once from the AAP UI (`/api/v2/tokens/` or Profile → Tokens).
- Every tool call attaches `Authorization: Bearer <token>` to requests.
- No credential files on disk, no PowerShell module dependencies, no SSL bypass.

### Generic by Design

- Plugin code contains zero hardcoded URLs.
- `baseUrl` is configured per-user in `opencode.jsonc`:
  ```jsonc
  { "plugin": [["./packages/awx", { "baseUrl": "https://aap.tanscloud-internal.com" }]] }
  ```
- Anyone with an AAP instance can use the plugin with their own config and token.

### Output Contract

All job-related tools return a structured response matching the `awx_job_detail.py` schema v1.0:

```typescript
{
  schema_version: "1.0",
  job: { id, name, status, failed, playbook, elapsed, ... },
  related: { job_template, project, inventory, ... },
  host_summary: { ok, failed, changed, unreachable, skipped },
  warnings: string[],
  errors: string[],
  extra_vars_summary: { keys: string[], redacted: true }
}
```

## User Stories

1. As an **OpenCode user**, I want to launch an AWX job template by name with optional extra vars, so that I can trigger automation runs without leaving my agent session.

2. As an **OpenCode user**, I want to check the status of a running or completed AWX job, so that I can determine whether my automation succeeded, failed, or is still in progress.

3. As an **OpenCode user**, I want to list and search available job templates, so that I can discover which templates are available and pick the right one for my task.

4. As an **OpenCode user**, I want to list and search available projects, so that I can verify project state and find the project I need to sync.

5. As an **OpenCode user**, I want to trigger a project synchronisation from the SCM source, so that I can pick up latest changes from Git before launching a job.

6. As an **OpenCode user**, I want to poll a job until it completes (with configurable interval and timeout), so that I can await results without manually polling or context switching.

7. As an **OpenCode user**, I want to authenticate to AWX via a bearer token stored securely by the plugin, so that I never have to handle credential files or re-authenticate mid-session.

8. As an **OpenCode user**, I want to configure the AAP base URL in `opencode.jsonc`, so that the plugin works with any AAP instance without code changes.

9. As a **platform maintainer**, I want to deprecate the brittle PowerShell scripts, so that the AWX connectivity stack is maintainable, portable, and testable.

## Implementation Decisions

### Auth hook

- Use OpenCode's built-in `auth` plugin hook with `type: "api-key"`.
- The token is stored once per session; the plugin never writes it to disk.
- Token validation occurs on first tool call by making a lightweight request to `/api/v2/me/`.

### Client module

- A single `client.ts` module wraps Node.js `fetch` with:
  - Automatic `Authorization` header injection from the auth hook.
  - Base URL resolution for all endpoints.
  - Standard error handling for HTTP 401 (unauthorised), 403 (forbidden), 404 (not found), and 5xx responses.
  - Request/response logging for debugging (gated behind a debug flag).
- No third-party HTTP dependencies — uses Node.js 18+ native `fetch`.

### Tool design

- **`awx-launch-job`** — Resolves job template ID by name via `/api/v2/job_templates/?name=<name>`, then POSTs to `/api/v2/job_templates/<id>/launch/` with optional extra vars. Returns the full v1.0 contract.

- **`awx-job-status`** — GET `/api/v2/jobs/<id>/` and transform response to v1.0 contract. Includes `related` links for navigation.

- **`awx-list-templates`** — GET `/api/v2/job_templates/` with optional `?name__icontains=<query>` filter. Returns paginated results consolidated into a single list.

- **`awx-list-projects`** — GET `/api/v2/projects/` with optional `?name__icontains=<query>` filter. Returns paginated results consolidated into a single list.

- **`awx-sync-project`** — Resolves project ID by name via `/api/v2/projects/?name=<name>`, then POSTs to `/api/v2/projects/<id>/update/`. Returns the update job status.

- **`awx-wait-job`** — Polls GET `/api/v2/jobs/<id>/` every N seconds (default 10, configurable) until `status` is one of `successful`, `failed`, `canceled`, or `error`. Returns the final v1.0 contract. Timeout defaults to 600 seconds (configurable).

### Plugin entry point

- `index.ts` registers all six tools and the auth hook in the `openai_plugin` export.
- Each tool is registered with its own `execute` function that imports from the corresponding tool module.

### Output contract compliance

- A dedicated `contracts/job-detail.ts` file defines TypeScript types matching the v1.0 schema.
- Every job-related tool transforms the raw API response into this contract shape.
- Host summary is computed by summing the `host_status_counts` or `host_summary` fields from the job detail.

### Rollout strategy (4 phases)

| Phase | Action |
|-------|--------|
| **Phase 1** | Build plugin MVP alongside existing PowerShell scripts. Both paths work. |
| **Phase 2** | Update skills (`awx-windows`, `awx-cli`, `awx-integration`) to prefer plugin tools over script calls. |
| **Phase 3** | Deprecate PowerShell scripts with a warning message pointing to the plugin. |
| **Phase 4** | Retire scripts from the repository. |

## Testing Decisions

### Integration tests (live AAP)

- Write Vitest tests that run against a configured live AAP instance.
- Each test authenticates using a bearer token from `process.env.AWX_TOKEN`.
- Tests create isolated resources (e.g., a test project, a test job template) and clean up after themselves.

### Contract tests

- Every tool output is validated against the v1.0 TypeScript type using `zod` or TypeScript compile-time checks.
- A JSON schema file is maintained alongside the TypeScript types for cross-language validation.
- Fixture-based tests compare tool outputs against known-good JSON responses.

### Fixture tests (offline)

- Reuse existing fixtures from `C:\ai\opencode\tests\fixtures\awx_job_*.json`.
- Mock the `fetch` calls to return fixture data.
- Verify that:
  - Job status polling returns correct terminal states.
  - Error responses (401, 404, 500) are handled gracefully.
  - Paginated list responses are consolidated correctly.
  - Extra vars are redacted in the contract output.

### Test matrix

| Test layer | Scope | Dependencies |
|-----------|-------|-------------|
| Unit | Individual tool modules, client helpers | None (mocked fetch) |
| Contract | Tool output → v1.0 schema | Fixture JSON files |
| Integration | End-to-end flow against AAP | Live AAP + valid token |

## Out of Scope (V1)

- **CRUD operations** — Creating, updating, or deleting job templates, projects, inventories, or credentials.
- **User/team management** — Managing AAP users, teams, or role-based access control.
- **Inventory management** — Listing, creating, or syncing inventories and inventory sources.
- **Workflow job templates** — Launching or monitoring workflow job templates (not the same as regular job templates).
- **TUI plugin** — An interactive terminal UI for AWX operations is a separate concern.
- **Credential management** — Creating or updating AAP credentials from the plugin.
- **Tower CLI passthrough** — Running arbitrary `tower-cli` or `awx` CLI commands through the plugin.
- **Multi-instance support** — Operating against multiple AAP instances simultaneously in one session.
- **Auto-retry on failure** — The plugin reports failures as they occur; auto-retry is the caller's responsibility.

## Further Notes

### Security considerations

- The bearer token is held in memory only (via the plugin `auth` hook) and never persisted to disk by the plugin.
- TLS verification is always enabled (Node.js native `fetch` enforces this by default).
- Extra vars in job responses are redacted (`redacted: true`) with only key names exposed, never values.
- No credential XML files, no `-DisableCertificateVerification`, no PowerShell module discovery.

### Migration path

- Plugin and scripts coexist during Phase 1–2, allowing gradual adoption.
- Phase 3 adds a deprecation warning to each script: *"This script is deprecated. Use the `@opencode-ai/plugin-awx` tool instead."*
- Phase 4 removes script files entirely after a transition period.

### API compatibility

- The plugin targets the AWX REST API at a minimum supported version of AAP 2.3+ (AWX 21.0.0+).
- The `awx_job_detail.py` v1.0 schema is the canonical output contract; any changes to it require a schema version bump.

### Package structure

```
opencode-plugins/
├── packages/
│   └── awx/
│       ├── package.json              # @opencode-ai/plugin as peer dep
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts              # Plugin entry: hooks + tool registration
│       │   ├── auth.ts               # Bearer token auth hook
│       │   ├── client.ts             # AWX REST API client (fetch wrapper)
│       │   ├── tools/
│       │   │   ├── launch-job.ts
│       │   │   ├── job-status.ts
│       │   │   ├── list-templates.ts
│       │   │   ├── list-projects.ts
│       │   │   ├── sync-project.ts
│       │   │   └── wait-job.ts
│       │   └── contracts/
│       │       └── job-detail.ts      # TypeScript types matching the v1.0 contract
│       └── README.md
├── package.json                       # workspace root
└── docs/
    └── prd/
        └── awx-plugin.md              # This document
```

### Target environment

**Existing Infrastructure:** This plugin targets an existing, operational AWX (Ansible Automation Platform) and EDA (Event-Driven Ansible) deployment at `https://aap.tanscloud-internal.com`. The AAP instance hosts multiple projects, job templates, inventories, credentials, and execution environments already configured and in use. EDA rulebooks and activation workflows are also running on this instance. The plugin must remain compatible with this existing setup — no migration or reconfiguration of the AAP server is required.
