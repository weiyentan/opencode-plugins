# AWX Plugin (`@weiyentan/opencode-plugin-awx`)

[![npm version](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-awx)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-awx)
[![License](https://img.shields.io/npm/l/@weiyentan/opencode-plugin-awx)](https://github.com/weiyentan/opencode-plugins/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/weiyentan/opencode-plugins/ci.yml?branch=master)](https://github.com/weiyentan/opencode-plugins/actions)

An [OpenCode](https://github.com/weiyentan/opencode) server plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Exposes 60+ AWX tools — job templates, projects, inventories, credentials, and full job lifecycle — within an OpenCode agent session.

## Prerequisites

- **Node.js** >= 20
- A running **AWX** or **AAP** instance with a Personal Access Token (PAT)

## Installation

```bash
npm install @weiyentan/opencode-plugin-awx
```

Register the plugin in your `opencode.jsonc`:

```jsonc
{
  "plugins": [
    "@weiyentan/opencode-plugin-awx"
  ]
}
```

Tools are available automatically after register and server restart.

## Quick Start

```text
awx-configure baseUrl=https://my-aap.example.com token=your-pat-token
awx-ping
awx-list-templates
awx-launch-job templateId=10
awx-job-status jobId=42
```

The `awx-configure` tool stores credentials in memory for the session. Alternatively, set `AWX_TOKEN` as an environment variable before starting the OpenCode server.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `AWX_BASE_URL` | Yes | Base URL of the AAP/AWX instance |
| `AWX_TOKEN` | No | Personal Access Token (fallback if not set via `awx-configure`) |

Credentials are resolved through a 3-tier fallback: session config → server `getSecret` → environment variable.

## Available Tools

**Diagnostics** — `awx-ping`, `awx-debug-env`, `awx-configure`

**Listing** (17 tools) — `awx-list-templates`, `awx-list-projects`, `awx-list-jobs`, `awx-list-credentials`, `awx-list-inventories`, `awx-list-organizations`, `awx-list-hosts`, `awx-list-groups`, `awx-list-labels`, `awx-list-instance-groups`, `awx-list-execution-environments`, `awx-list-users`, `awx-list-teams`, `awx-list-schedules`, `awx-list-notification-templates`, `awx-list-templates-by-credential`, `awx-list-workflow-templates`

All list tools accept `--filter`, `--timeout`, `--maxPages`, and `--pageSize`.

**Resource Operations** — `awx-get-resource`, `awx-sync-project`, `awx-attach-credential`, `awx-detach-credential`

**Job Lifecycle** — `awx-launch-job`, `awx-job-status`, `awx-wait-job`, `awx-get-job-events`

Job tools use an agent-side polling pattern: launch returns a job ID immediately, and status/events are fetched on demand.

**CRUD** — Create, update, and delete tools for 12 resource families: projects, templates, inventories, hosts, groups, labels, instance-groups, execution-environments, users, teams, schedules, and notification-templates. Each resource has `awx-create-*`, `awx-update-*`, and `awx-delete-*` variants.

**Ad-Hoc & Workflow** — `awx-run-command`, `awx-launch-workflow`

Job-related tools return output conforming to the `JobDetailOutput` v1.0 schema.

## Development

```bash
npm install
npm run build    # Compile TypeScript to dist/
npm test         # Run the Vitest test suite
npm run lint     # Type-check without emitting
```

Unit tests run offline with no AAP instance required. Integration tests exercise tools against a live AAP instance — set `AWX_TOKEN` and run `npx vitest run tests/integration/`.

## License

MIT © 2025 weiyentan
