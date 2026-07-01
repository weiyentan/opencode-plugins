# OpenCode Plugins

A monorepo of [OpenCode](https://opencode.ai) server plugins that extend the OpenCode agent with first-class tool integrations.

## Plugins

### AWX Plugin (`packages/awx/`)

An OpenCode plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Provides native tool access to job templates, projects, and job lifecycle operations — replacing brittle PowerShell scripts with a portable, testable TypeScript plugin.

**Status:** ✅ Phase 0 (scaffolding), Phase 1 (client infrastructure), and Phase 2 core tools complete — 21 tools implemented covering project lookup, template detail, inventory detail, job lifecycle, credential attachment, CRUD operations (create/update/delete for projects, templates, inventories), environment debugging, and interactive configuration.

**Coverage:** 21 of 22 AWX operations planned for v1 (~95%), covering the 95%+ use case. Full tool-action mapping table documented in the PRD.

**Key docs:**
- [Refined PRD](docs/prd/plugin-awx-refined.md) — full product requirements
- [Architecture Decision Records](docs/adr/) — 6 ADRs covering auth, output contract, resilience, polling, transforms
- [Client Middleware Design](docs/client-middleware-design.md) — middleware pipeline spec
- [Domain Glossary](CONTEXT.md) — core concepts and terminology

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

- Node.js 18+ (Node 18 compatibility is handled transparently via `anyAbortSignal()` and `createTimeoutSignal()` in the client middleware)
- `@opencode-ai/plugin` (peer dependency)
- Access to an AAP instance for integration testing

### Getting Started

The AWX plugin package (`packages/awx/`) is already scaffolded with these modules:

| Module | File | Purpose |
|--------|------|---------|
| **Plugin entry** | `src/index.ts` | Registers all AWX tools (list-templates, list-projects, list-jobs, launch-job, job-status, wait-job, get-job-events, sync-project, get-resource, debug-env, configure, create-project, create-template, create-inventory, update-project, update-template, update-inventory, delete-project, delete-template, delete-inventory, attach-credential); wires HTTP client, metrics lifecycle (load/persist/dispose), and dispose hook for plugin shutdown |
| **CRUD dispatch** | `src/crud.ts` | Endpoint registry and dispatch for create/update/delete on templates, projects, and inventories |
| **Auth hook** | `src/auth.ts` | Bearer token / PAT authentication via OpenCode's `type: "api"` auth hook |
| **Output contract** | `src/contracts/job-detail.ts` | Zod schemas and TypeScript types matching `awx_job_detail.py` v1.0 |
| **Mutation contract** | `src/contracts/resource-mutation.ts` | `ResourceMutationOutput` v1.0 contract for create/update/delete responses |
| **Transforms** | `src/transforms.ts` | SSH→HTTPS URL conversion, git branch inference, required-var validation |
| **Client middleware** | `src/client.ts` | HTTP middleware pipeline: circuit breaker, retry/backoff, timeout via native `fetch` |
| **Metrics** | `src/metrics.ts` | Per-tool counters with file-backed durability for operational visibility |
| **Node shim** | `src/node-shim.d.ts` | Minimal Node.js built-in declarations (avoids `@types/node` dependency) |
| **Snapshot generator** | `scripts/generate-snapshots.py` | Regenerates contract snapshots from fixture data |

See `packages/awx/README.md` for detailed documentation. To start implementing tools, pick an unblocked `afk` issue from the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues).

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

1. Pick an unblocked issue from the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues) labeled `afk` and `status:todo`
2. Follow the PRD and ADRs for architecture guidance
3. Each tool must include unit tests and conform to the output contract
4. Integration tests are gated behind `AWX_TOKEN` and are not required for every PR
