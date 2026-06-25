# AWX Plugin (`@weiyentan/opencode-plugin-awx`)

OpenCode server plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Provides native tool access to job templates, projects, and job lifecycle operations.

## Status

✅ **Phase 0 — Repository Scaffolding** (complete)  
✅ **Phase 1 — Client Infrastructure** (complete)  
✅ **Phase 2 — Tool Implementation** (complete)

The AWX plugin delivers these modules:

| Module | File | Purpose |
|--------|------|---------|
| **Plugin entry** | `src/index.ts` | Registers all AWX tools (awx-list-templates, awx-list-projects, awx-list-jobs, awx-launch-job, awx-job-status, awx-wait-job, awx-get-job-events, awx-sync-project, awx-get-resource, awx-debug-env, awx-configure, awx-create-project, awx-create-template, awx-create-inventory, awx-update-project, awx-update-template, awx-update-inventory, awx-delete-project, awx-delete-template, awx-delete-inventory) + hello-world scaffold; wires HTTP client, metrics lifecycle, and dispose hook |
| **Auth hook** | `src/auth.ts` | Bearer token / PAT authentication via OpenCode's `type: "api"` auth hook with init-time validation |
| **Output contract** | `src/contracts/job-detail.ts` | TypeScript types (`JobDetailOutput`) matching `awx_job_detail.py` v1.0 |
| **Client middleware** | `src/client.ts` | HTTP middleware pipeline: circuit breaker, retry/backoff, timeout via native `fetch` |
| **Metrics** | `src/metrics.ts` | Per-tool counters with file-backed durability for operational visibility |
| **Node shim** | `src/node-shim.d.ts` | Minimal Node.js built-in declarations (avoids `@types/node` dependency) |
| **Snapshot generator** | `scripts/generate-snapshots.py` | Python script that regenerates contract snapshots from fixture data |

Tool implementation (Phase 2) is complete — all 20 AWX tools are implemented and tested. See the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues) for upcoming enhancements.

### Tool Output Formats

| Tool | Output Format | Filter Support |
|------|--------------|----------------|
| `awx-list-templates` | Pipe-delimited Markdown table (ID / Name / Description) | `--filter` (e.g., `name__icontains=workspace`) |
| `awx-list-projects` | Pipe-delimited Markdown table (ID / Name / Description / SCM) | `--filter` (e.g., `name__icontains=workspace`) |
| `awx-list-jobs` | Pipe-delimited Markdown table (ID / Name / Job Type / Status / Created / Started / Finished / Launched By) | `--filter` (e.g., `name__icontains=workspace`) |
| `awx-sync-project` | Plain text message + structured metadata | — |
| `awx-launch-job` | Raw AWX API response JSON (thin proxy — no transforms or structured envelope) | — |
| `awx-job-status` | JSON-serialized `JobDetailOutput` v1.0 contract | — |
| `awx-wait-job` | JSON-serialized `JobDetailOutput` v1.0 contract | — |
| `awx-get-job-events` | Plain text message + structured metadata | — |
| `awx-configure` | Plain text confirmation message | — |
| `awx-debug-env` | JSON string | — |
| `awx-get-resource` | Plain text structured summary + metadata with `{ schema_version, resource_type, id, data }` envelope | `type` (template\|project\|inventory) + `id` |
| `awx-create-project` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-create-template` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-create-inventory` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-update-project` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-update-template` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-update-inventory` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-delete-project` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-delete-template` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |
| `awx-delete-inventory` | Plain text confirmation message + `ResourceMutationOutput` metadata | — |

Both `awx-list-templates` and `awx-list-projects` accept `--timeout` (total tool timeout in ms, default 30000).

## Prerequisites

- **Node.js** >= 18.0.0 (Node 18 compatibility is handled transparently — the client middleware includes `anyAbortSignal()` and `createTimeoutSignal()` fallbacks)
- **npm** >= 9.0.0 (ships with Node.js 18)
- TypeScript knowledge for plugin development
- Access to an AAP instance for integration testing (optional — unit tests run offline)

## Setup

```bash
# From the monorepo root:
npm install

# Or from this package directly:
cd packages/awx
npm install
```

This package is consumed by the OpenCode plugin server as a dependency — no standalone runtime is needed.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` (`tsc`) |
| `npm test` | Run the Vitest test suite (`vitest run`) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check without emitting (`tsc --noEmit`) |
| `npm run typecheck` | Alias for `lint` — strict type checking |

## Testing

```bash
# Unit tests (no AAP instance required)
npm test
```

Tests follow TDD (test-driven development) with [Vitest](https://vitest.dev) and verify behavior through the public plugin interface.

### Running Integration Tests

Integration tests in `tests/integration/` exercise the plugin's tools against a **live AAP instance** through the plugin's own tool registration mechanism.

#### Read-Only Tools

The suite `tests/integration/read-only.test.ts` covers `awx-list-templates`, `awx-list-projects`, and `awx-list-jobs`.

#### Job Lifecycle Tools

The suite `tests/integration/job-lifecycle.test.ts` covers the full AWX job lifecycle:

- `awx-launch-job` → launches a job template
- `awx-job-status` → fetches structured job detail (v1.0 output contract)
- `awx-wait-job` → non-blocking status check (no polling)
- `awx-get-job-events` → retrieves job events

#### Environment Variables

The plugin reads configuration from these environment variables:

| Env Var | Default | Required | Description |
|---------|---------|----------|-------------|
| `AWX_BASE_URL` | — | **Yes** | Base URL of the AAP/AWX instance (e.g. `https://example.com`) |
| `AWX_TOKEN` | — | No | Personal Access Token fallback (primary: auth hook / `getSecret`). Used when no token is stored in the auth hook. |

#### Test Prerequisites

| Env Var | Default | Required | Description |
|---------|---------|----------|-------------|
| `AWX_TOKEN` | — | **Yes** | Valid AAP Personal Access Token (PAT) for integration tests |
| `AAP_BASE_URL` | `https://example.com` | No | Base URL of the AAP instance |
| `JOB_TEMPLATE_ID` | `10` | No | Non-production AWX job template ID to launch |
| `EXTRA_VARS_INVENTORY` | `"test"` | No | Inventory name for extra_vars |
| `EXTRA_VARS_SCM_URL` | `"https://github.com/example/repo.git"` | No | SCM URL for extra_vars |
| `EXTRA_VARS_SCM_BRANCH` | `"main"` | No | SCM branch for extra_vars |

> **Important:** Use a non-production job template. The launch tool starts a real job on AAP. The plugin now passes extra_vars verbatim — no SSH→HTTPS conversion, no branch inference, no required-var validation. Your job template must accept whatever extra_vars you pass.

#### Run Command

```bash
# From packages/awx/
export AWX_TOKEN=your_pat_token_here
npx vitest run tests/integration/

# Run a specific suite:
npx vitest run tests/integration/read-only.test.ts
npx vitest run tests/integration/job-lifecycle.test.ts

# With custom AAP URL:
export AWX_TOKEN=your_pat_token_here
export AAP_BASE_URL=https://my-aap.internal.example.com
npx vitest run tests/integration/
```

> **Note**: Integration tests are gated behind `AWX_TOKEN`. When `AWX_TOKEN` is not set, the live AAP tests are silently skipped using `describe.skipIf(!process.env.AWX_TOKEN)`.

#### Agent-Side Polling Pattern

Job lifecycle tools use an **agent-side polling** pattern (see ADR 0004):
- `awx-launch-job` returns immediately with a job ID.
- `awx-job-status` / `awx-wait-job` return the current status — the agent must loop to poll for completion.
- `awx-get-job-events` retrieves events from a completed or running job.

No tool blocks waiting for job completion. This avoids hanging the agent's execution loop and gives the agent control over polling strategy (poll interval, max attempts, timeout).

### Contract Tests

Contract tests (`tests/contract.test.ts`) validate that the TypeScript `JobDetailOutput` interface and zod schema match the Python `awx_job_detail.py` v1.0 output contract. A **snapshot-based approach** is used for CI safety:

- Fixture JSON files in `tests/fixtures/` represent pre-baked snapshots of the Python output contract.
- Tests parse each fixture through the zod schema and assert structural correctness.
- No live Python subprocess is executed — the tests are pure TypeScript and run in any CI environment.

#### Fixture Files

| Fixture | Purpose |
|---------|---------|
| `awx_job_success.json` | A successful job with no failures or unreachable hosts |
| `awx_job_partial.json` | A job that completed with some unreachable hosts |
| `awx_job_failure.json` | A failed job with task-level errors |

#### Regenerating Contract Snapshots

When the Python `awx_job_detail.py` v1.0 output contract changes (e.g., new fields are added or field types change), the fixture snapshots must be regenerated:

1. Run the Python `awx_job_detail.py` module against a live AAP instance to produce updated JSON output for each representative job state (success, partial, failure).
2. Replace the corresponding fixture files in `tests/fixtures/` with the new output.
3. Update `src/contracts/job-detail.ts` if the schema has changed (add/modify zod fields and TypeScript types).
4. Run `npm test` to verify the new snapshots pass schema validation.
5. Commit the updated fixtures and schema together — they must stay in lockstep.

> **Important**: Fixtures are checked into the repository. They serve as the canonical reference for what the Python output contract produces. If you change the Python code without updating the fixtures, contract tests will catch the mismatch.
## Hot-Reload

The OpenCode plugin server watches plugin source files and **automatically reloads** when changes are detected — no server restart required. This was verified during initial scaffolding:

1. The plugin is registered by the OpenCode server (consuming `src/index.ts` as the entry point).
2. Modifying the tool's `description` field in `src/index.ts` (e.g., changing the hello-world description text) triggers a plugin reload.
3. The server picks up the new description on the next tool invocation.

### Known Limitation

Hot-reload verification is performed structurally (the `tsc --noEmit` / `vitest run` cycle confirms the module compiles and tool execute signature is correct) but end-to-end hot-reload testing requires a running OpenCode server instance. Full integration testing of hot-reload behavior is tracked for a future enhancement.

### Entry Points

The `package.json` `main`, `types`, and `exports` fields point to the compiled `dist/` output. This is the production-safe configuration — consumers import the compiled JavaScript with type declarations.

#### Local Development (`opencode-plugin-dev/plugins/`)

For local testing without publishing, a re-export wrapper is set up at `opencode-plugin-dev/plugins/awx-plugin.js` which re-exports `AwxPlugin` from the compiled `dist/` output. The directory is named without a leading dot to prevent OpenCode from auto-discovering it at startup, keeping development artifacts isolated from the live plugin system.

After making changes:

```bash
cd packages/awx
npm run build          # Recompile to dist/
# Restart OpenCode server to pick up the new build
```

Build outputs are gitignored (`opencode-plugin-dev/` is in `.gitignore`), so the wrapper is local-only and never committed.

## CI Requirements

CI pipelines must run the following in order:

```bash
npm ci              # Clean install
npm run lint        # Type checking
npm test            # Unit tests
npm run build       # Production build
```

### Required CI Environment

- **Node.js** 18.x or 20.x LTS
- **npm** 9.x+
- No secrets required for unit tests (`npm test`)
- Integration tests are gated behind `AWX_TOKEN` and run separately

## Toolchain Decisions

### npm Workspaces (not pnpm)

This package lives inside an **npm workspaces** monorepo. The root `package.json` declares `packages/*` as workspaces. npm workspaces were chosen over pnpm for:

1. **Zero-install overhead** — npm ships with Node.js, no extra package manager needed.
2. **CI simplicity** — GitHub Actions runners include npm by default.
3. **Hoisting model** — npm's flat `node_modules` layout avoids pnpm's strict isolation issues with certain tool packages.

### Single tsconfig.json (not project references)

A single `tsconfig.json` at `packages/awx/tsconfig.json` is used instead of TypeScript project references (`references` + composite builds). This was chosen because:

1. **Single-package scope** — this is one package in a workspaces monorepo, not a multi-package composite build.
2. **Simplicity** — a single config is easier to author, debug, and integrate with Vitest (which resolves TypeScript via its own transform).
3. **Future readiness** — if the plugin is split into sub-packages (e.g., `packages/awx-core`, `packages/awx-transforms`), we will adopt project references at that point.

## Architecture

### Module Structure

```
packages/awx/
├── src/
│   ├── index.ts              # Plugin entry point — Hooks (auth + tools + dispose); client wiring & metrics lifecycle
│   ├── auth.ts               # Bearer token auth hook (type: "api")
│   ├── client.ts             # HTTP middleware pipeline (circuit breaker, retry, timeout)
│   ├── get-resource.ts       # Shared resource detail orchestrator — type→endpoint registry, fetch, map dispatch
│   ├── crud.ts               # CRUD endpoint registry — type→{create,update,delete} dispatch with per-type mappers
│   ├── metrics.ts            # Per-tool counters with file-backed durability
│   ├── node-shim.d.ts        # Minimal Node.js declarations (fs/promises, path)
│   ├── launch.ts             # awx-launch-job orchestration (thin proxy — passes extra_vars verbatim to AWX API)
│   ├── contracts/
│   │   ├── job-detail.ts     # JobDetailOutput v1.0 TypeScript interface
│   │   ├── resource-mutation.ts # ResourceMutationOutput v1.0 contract (schema_version, action, resource_type, id, data)
│   │   ├── template-detail.ts # TemplateDetailOutput contract (schema_version, resource_type, id, data)
│   │   ├── project-detail.ts  # ProjectDetailOutput contract
│   │   └── inventory-detail.ts # InventoryDetailOutput contract
│   └── mappers/
│       ├── map-template.ts   # Raw AWX API response → TemplateDetailOutput
│       ├── map-project.ts    # Raw AWX API response → ProjectDetailOutput
│       └── map-inventory.ts  # Raw AWX API response → InventoryDetailOutput
├── tests/
│   ├── plugin.test.ts            # Plugin registration and lifecycle tests
│   ├── client.test.ts            # Client middleware pipeline tests
│   ├── lifecycle.test.ts         # Lazy client/auth lifecycle tests (no-token → token → client-created)
│   ├── metrics.test.ts           # MetricsStore persistence & counter tests incl. concurrent serialization
│   ├── plugin-init-timeout.test.ts  # Init-time timeout cleanup tests (clear() called after validation)
│   ├── crud-project.test.ts      # CRUD create/update/delete integration tests for projects
│   ├── crud-template.test.ts     # CRUD create/update/delete integration tests for templates
│   ├── crud-inventory.test.ts    # CRUD create/update/delete integration tests for inventories
│   ├── get-resource.test.ts      # getResource orchestrator unit tests (dispatch, error handling, registry)
│   ├── get-resource-tool.test.ts # awx-get-resource tool integration tests (via plugin tool registration)
│   ├── map-template.test.ts      # mapTemplate mapper unit tests
│   ├── map-project.test.ts       # mapProject mapper unit tests
│   ├── map-inventory.test.ts     # mapInventory mapper unit tests
│   ├── contracts/
│   │   ├── contract.test.ts      # Contract compatibility tests
│   │   └── __snapshots__/        # Canonical contract output (ground truth)
│   └── fixtures/
│       ├── awx_job_success.json
│       ├── awx_job_partial.json
│       ├── awx_job_failure.json
│       ├── raw_awx_template.json  # Raw AWX API response fixture (template)
│       ├── raw_awx_project.json   # Raw AWX API response fixture (project)
│       └── raw_awx_inventory.json # Raw AWX API response fixture (inventory)
└── scripts/
    └── generate-snapshots.py # Python script to regenerate snapshots
```

### Auth Hook

The plugin uses OpenCode's `type: "api"` auth hook for bearer token (Personal Access Token) authentication. On plugin load:

1. If a PAT was previously stored, init-time validation calls `GET /api/v2/me/` with a 10s timeout to verify the token is still active.
2. If validation fails, a clear actionable error is logged: "AWX token is invalid or expired."
3. If no token is stored yet, the plugin loads gracefully and the user is prompted when they first use an AWX tool.

### Output Contract

All job-related tools return output matching the `JobDetailOutput` interface (see `src/contracts/job-detail.ts`). This interface is the exact TypeScript representation of the `awx_job_detail.py` v1.0 schema. Key naming:

- Use `host_status_counts` — NOT `host_summary`
- Use `derived` — NOT `extra_vars_summary`
- `related` fields are resolved names, not raw URLs
- `job.extra_vars` — Parsed from the AWX API JSON string into a `Record<string, unknown>` when valid JSON; omitted if parsing fails (the AWX API may return YAML)

See the [Architecture Decision Records](../../docs/adr/) in the monorepo for design rationale:

- **ADR 0001**: Auth strategy (bearer token / PAT)
- **ADR 0002**: Output contract schema
- **ADR 0003**: Resilience patterns (retry, timeout, circuit breaker)
- **ADR 0004**: Agent-side polling (job lifecycle)
- **ADR 0005**: Extra-variable transforms (Superseded — transforms removed; `awx-launch-job` now passes `extra_vars` verbatim)
- **ADR 0006**: Error taxonomy and structured error reporting

## License

MIT
