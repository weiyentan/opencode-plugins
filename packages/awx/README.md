# AWX Plugin (`@weiyentan/opencode-plugin-awx`)

[![npm version](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-awx)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-awx)
[![License](https://img.shields.io/npm/l/@weiyentan/opencode-plugin-awx)](https://github.com/weiyentan/opencode-plugins/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/weiyentan/opencode-plugins/ci.yml?branch=main)](https://github.com/weiyentan/opencode-plugins/actions)

An [OpenCode](https://github.com/weiyentan/opencode) server plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Provides native tool access to job templates, projects, inventories, credentials, and full job lifecycle operations — all from within an OpenCode agent session.

## Prerequisites

- **Node.js** >= 20
- A running **AWX** or **Ansible Automation Platform (AAP)** instance (for runtime use; unit tests run offline)
- An AAP **Personal Access Token (PAT)** for authentication

## Installation

```bash
npm install @weiyentan/opencode-plugin-awx
```

The plugin is typically registered in your OpenCode plugin server configuration. Once installed, it exposes 60+ AWX tools automatically.

## Quick Start

Register the plugin and configure your AWX connection:

```typescript
import { definePlugin } from "@opencode-ai/plugin";
import { AwxPlugin } from "@weiyentan/opencode-plugin-awx";

export default definePlugin({
  plugins: [AwxPlugin],
});
```

Set your AWX instance URL and token, then launch a job template:

```
# Configure connection
awx-configure baseUrl=https://my-aap.example.com token=your-pat-token

# Verify connectivity
awx-ping

# List available job templates
awx-list-templates

# Launch a job template
awx-launch-job templateId=10

# Check job status
awx-job-status jobId=42
```

The `awx-configure` tool stores credentials in memory for the session. Alternatively, set the `AWX_TOKEN` environment variable before starting the OpenCode server for automatic credential discovery.

## Configuration

### Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `AWX_BASE_URL` | — | Yes | Base URL of the AAP/AWX instance (e.g. `https://example.com`) |
| `AWX_TOKEN` | — | No | Personal Access Token fallback (used when no token is stored via `awx-configure` or the auth hook) |

### Auth Hook

The plugin registers an OpenCode `type: "api"` auth hook that accepts a bearer token (PAT). On plugin load, the token is validated by calling `GET /api/v2/me/` with a 10-second timeout. If validation fails, a clear error is logged. If no token is configured, the plugin loads gracefully and prompts the user on first tool invocation.

### Credential Resolution

The plugin resolves credentials through a 3-tier fallback chain:

1. **Session config** — credentials stored via `awx-configure` tool
2. **`getSecret`** — server-injected secret retrieval (if supported by the OpenCode server)
3. **Environment variable** — `AWX_TOKEN` from `process.env`

## Tool Reference

### Diagnostics & Configuration

| Tool | Description |
|------|-------------|
| `awx-ping` | Verify connectivity to the AWX API (`/api/v2/ping/`) |
| `awx-debug-env` | Print resolved configuration (base URL, auth status) |
| `awx-configure` | Set base URL and/or token at runtime |

### Listing Tools (17 tools)

| Tool | Description |
|------|-------------|
| `awx-list-templates` | List job templates |
| `awx-list-projects` | List projects |
| `awx-list-jobs` | List jobs |
| `awx-list-organizations` | List organizations |
| `awx-list-credentials` | List credentials |
| `awx-list-inventories` | List inventories |
| `awx-list-hosts` | List hosts |
| `awx-list-groups` | List groups |
| `awx-list-labels` | List labels |
| `awx-list-instance-groups` | List instance groups |
| `awx-list-execution-environments` | List execution environments |
| `awx-list-users` | List users |
| `awx-list-teams` | List teams |
| `awx-list-schedules` | List schedules |
| `awx-list-notification-templates` | List notification templates |
| `awx-list-templates-by-credential` | List templates filtered by credential |
| `awx-list-workflow-templates` | List workflow templates |

All list tools accept `--filter` (e.g., `name__icontains=workspace`), `--timeout`, `--maxPages`, and `--pageSize` for pagination control. Results are returned as pipe-delimited Markdown tables.

### Resource Operations

| Tool | Description |
|------|-------------|
| `awx-get-resource` | Get details for any resource by type and ID |
| `awx-sync-project` | Trigger an SCM sync for a project |
| `awx-attach-credential` | Attach a credential to a resource |
| `awx-detach-credential` | Detach a credential from a resource |

### Job Lifecycle

| Tool | Description |
|------|-------------|
| `awx-launch-job` | Launch a job template (returns job ID immediately) |
| `awx-job-status` | Fetch structured job detail (v1.0 output contract) |
| `awx-wait-job` | Non-blocking status check for a running job |
| `awx-get-job-events` | Retrieve events from a running or completed job |

Job lifecycle tools use an **agent-side polling** pattern: the agent calls `awx-launch-job`, receives a job ID, then polls with `awx-job-status` in a loop until completion. No tool blocks waiting for a job to finish.

### CRUD Operations

| Tool Family | Create | Update | Delete |
|-------------|--------|--------|--------|
| Projects | `awx-create-project` | `awx-update-project` | `awx-delete-project` |
| Templates | `awx-create-template` | `awx-update-template` | `awx-delete-template` |
| Inventories | `awx-create-inventory` | `awx-update-inventory` | `awx-delete-inventory` |
| Users | `awx-create-user` | `awx-update-user` | `awx-delete-user` |
| Teams | `awx-create-team` | `awx-update-team` | `awx-delete-team` |
| Schedules | `awx-create-schedule` | `awx-update-schedule` | `awx-delete-schedule` |
| Notification Templates | `awx-create-notification-template` | `awx-update-notification-template` | `awx-delete-notification-template` |
| Hosts | `awx-create-host` | `awx-update-host` | `awx-delete-host` |
| Groups | `awx-create-group` | `awx-update-group` | `awx-delete-group` |
| Labels | `awx-create-label` | `awx-update-label` | `awx-delete-label` |
| Instance Groups | `awx-create-instance-group` | `awx-update-instance-group` | `awx-delete-instance-group` |
| Execution Environments | `awx-create-execution-environment` | `awx-update-execution-environment` | `awx-delete-execution-environment` |

All CRUD tools return a confirmation message plus structured metadata.

### Ad-Hoc & Workflow Tools

| Tool | Description |
|------|-------------|
| `awx-run-command` | Launch an ad-hoc Ansible command against a host or group |
| `awx-launch-workflow` | Launch a workflow job template |

## Output Contract

Job-related tools return output conforming to the `JobDetailOutput` v1.0 schema. Key fields:

- `schema_version` — Always `"1.0"`
- `job` — Core job metadata (ID, name, status, elapsed time, etc.)
- `related` — Resolved resource names (not raw URLs)
- `host_status_counts` — Host result breakdown (not `host_summary`)
- `derived` — Computed boolean flags (not `extra_vars_summary`)
- `warnings`, `errors` — Structured warning and error arrays
- `stdout` / `raw_events` — Optional, present when requested

## Development

### Setup

```bash
# From the monorepo root
npm install

# Or from this package directly
cd packages/awx
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm test` | Run the Vitest test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Type-check without emitting |
| `npm run typecheck` | Alias for `lint` |

### Testing

Unit tests run offline with no AAP instance required:

```bash
npm test
```

Integration tests exercise tools against a live AAP instance:

```bash
export AWX_TOKEN=your_pat_token_here
npx vitest run tests/integration/
```

### Contract Tests

Contract tests validate that the TypeScript output schemas match the Python `awx_job_detail.py` v1.0 contract. Fixture JSON files in `tests/fixtures/` serve as the canonical reference. When the Python contract changes, regenerate fixtures by running `scripts/generate-snapshots.py` against a live AAP instance.

### Architecture

```
packages/awx/
├── src/
│   ├── index.ts               # Plugin entry point — registers all tools
│   ├── auth.ts                # Bearer token auth hook
│   ├── client.ts              # HTTP middleware (circuit breaker, retry, timeout)
│   ├── metrics.ts             # Per-tool counters with file-backed durability
│   ├── utils.ts               # Shared helpers (formatting, error handling)
│   ├── tools/                 # Tool factories (one per tool or tool family)
│   ├── contracts/             # TypeScript interfaces + zod schemas
│   └── mappers/               # Raw API response → typed contract mappers
├── tests/                     # Unit and integration tests
└── scripts/
    └── generate-snapshots.py  # Contract snapshot generator
```

For design rationale, see the [Architecture Decision Records](../../docs/adr/):

- **ADR 0001**: Bearer token / PAT auth strategy
- **ADR 0002**: Output contract schema alignment
- **ADR 0003**: Resilience patterns (retry, timeout, circuit breaker)
- **ADR 0004**: Agent-side polling for job lifecycle
- **ADR 0006**: Structured error reporting

## License

MIT
