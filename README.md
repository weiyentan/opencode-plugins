# OpenCode Plugins

[![CI](https://img.shields.io/github/actions/workflow/status/weiyentan/opencode-plugins/ci.yml?branch=master&label=CI)](https://github.com/weiyentan/opencode-plugins/actions)
[![npm version](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-awx)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-awx)
[![License](https://img.shields.io/github/license/weiyentan/opencode-plugins)](LICENSE)

A monorepo of [OpenCode](https://opencode.ai) server plugins that extend the OpenCode agent with first-class tool integrations.

## Plugins

### AWX Plugin (`packages/awx/`)

An OpenCode plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Provides native tool access to job templates, projects, and job lifecycle operations — replacing brittle PowerShell scripts with a portable, testable TypeScript plugin.

**Status:** ✅ Phase 0 (scaffolding), Phase 1 (client infrastructure), and Phase 2 core tools complete — 55+ tools implemented covering project lookup, template detail, inventory detail, job lifecycle, CRUD operations (create/update/delete for projects, templates, inventories, users, teams, schedules, notification templates, hosts, groups, labels, instance groups, execution environments, credentials, organizations, and workflow templates), credential attachment and detachment, environment debugging, and interactive configuration.

**Coverage:** 53+ AWX operations covering all major resource CRUD lifecycle needs. Full tool-action mapping table documented in the tool gap audit.

**Key docs:**
- [Architecture Decision Records](docs/adr/) — 6 ADRs covering auth, output contract, resilience, polling, transforms
- [AWX Tool Gap Audit](packages/awx/docs/tool-gap-audit.md) — full tool coverage and gap analysis
- [Client Middleware Design](docs/client-middleware-design.md) — middleware pipeline spec
- [Domain Glossary](CONTEXT.md) — core concepts and terminology
- [Changelog](packages/awx/CHANGELOG.md) — release history and version notes

**License:** MIT — see [LICENSE](LICENSE) for full terms.

**Implementation issues:** https://github.com/weiyentan/opencode-plugins/issues

## Repository Structure

```
.opencode-workflow.yaml     # CI / workflow configuration
CONTEXT.md                  # Domain glossary (core concepts, AWX domain, infrastructure)
docs/
├── adr/                    # Architecture Decision Records (0001–0006)
├── prd/                    # Product Requirements Documents
│   ├── awx-plugin.md       # Original PRD (pre-refinement)
│   └── plugin-awx-refined.md  # Refined PRD
└── client-middleware-design.md  # Middleware pipeline design
packages/
└── awx/                    # AWX plugin package (auth, contracts, transforms, job lifecycle, CRUD mutation tools, resource detail tools)
```

## Development

### Prerequisites

- Node >=20 (stable `fetch` API and `AbortSignal.timeout()` require Node 20+)
- `@opencode-ai/plugin` (peer dependency)
- Access to an AAP instance for integration testing

### Quick Start

Install the AWX plugin in your OpenCode project:

```bash
npm install @weiyentan/opencode-plugin-awx
```

Add it to your `opencode.jsonc` configuration:

```jsonc
{ "plugin": ["@weiyentan/opencode-plugin-awx"] }
```

Set the required environment variables:

```bash
export AWX_BASE_URL="https://your-aap-instance.example.com"
export AWX_TOKEN="your_pat_token_here"
```

> **Security:** In production, avoid hardcoding `AWX_TOKEN` in shell history or config files. Use a secrets manager (e.g., HashiCorp Vault, Ansible Vault, your CI/CD platform's secrets store) or the OpenCode auth hook for credential injection.

Launch OpenCode and the tools become available. Here are common usage examples:

```
/awx-list-templates                      # List all job templates
/awx-list-templates --filter "name__icontains=deploy"  # Filter templates
/awx-launch-job 8                        # Launch job template #8
/awx-job-status 42                       # Check status of job #42
/awx-sync-project 15                     # Sync project #15
/awx-ping                                # Test connectivity to AAP
```

For a complete reference of all available tools and their arguments, see `packages/awx/README.md` or the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues).

### Architecture Overview

The AWX plugin follows a modular architecture with dedicated source modules for each tool category:

- **`src/index.ts`** — Plugin entry point that wires all tools into the Hooks shape
- **`src/client.ts`** — HTTP middleware pipeline with timeout, circuit breaker, and retry logic
- **`src/auth.ts`** — Bearer token / PAT authentication via `authorize()` hook
- **`src/transforms.ts`** — SSH→HTTPS URL conversion, git branch inference, extra-vars transformations
- **`src/contracts/`** — Zod schemas and TypeScript types for output contracts
- **`src/tools/`** — Tool factory modules (CRUD, job lifecycle, listing, etc.)
- **`src/tools/crud-*.ts`** — CRUD operations for individual resource types

See `packages/awx/README.md` for detailed documentation of all modules.

### Running Integration Tests

Integration tests require an AAP instance and a valid PAT:

```bash
export AWX_TOKEN=your_pat_token_here
npx vitest run tests/integration/
```

## Autonomous Implementation

All issues use the AFK (Away From Keyboard) label for autonomous implementation:

- Run `/develop-loop` to auto-implement issues in dependency order
- Run `/tdd "<issue title>"` to implement a specific issue
- See `.opencode-workflow.yaml` for tier executor dispatch configuration

## Contributing

Contributions are welcome! This project uses autonomous (AFK) development workflows.

1. **Find an issue** — Pick an unblocked issue from the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues) labeled `afk` and `status:todo`
2. **Read the docs** — Review the [PRD](docs/prd/) and [Architecture Decision Records](docs/adr/) for design guidance and conventions
3. **Implement with TDD** — Each tool must include unit tests and conform to the output contract. Use `/tdd "<issue title>"` for test-driven development
4. **Run tests locally** — `npm test` (unit tests) before submitting. Integration tests (`npx vitest run tests/integration/`) are gated behind `AWX_TOKEN` and are not required for every PR
5. **Submit** — Open a pull request with your changes. The CI pipeline will run path-filtered checks for the affected package(s)

See `.opencode-workflow.yaml` for development workflow configuration and tier executor dispatch details.
