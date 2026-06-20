# OpenCode Plugins

A monorepo of [OpenCode](https://opencode.ai) server plugins that extend the OpenCode agent with first-class tool integrations.

## Plugins

### AWX Plugin (`packages/awx/`)

An OpenCode plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Provides native tool access to job templates, projects, and job lifecycle operations — replacing brittle PowerShell scripts with a portable, testable TypeScript plugin.

**Status:** 🚧 In design / pre-implementation. 23 issues broken down and ready for implementation.

**Coverage:** 7 of 22 AWX operations in v1 (30%), covering the 80% use case. Full tool-action mapping table documented in the PRD.

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
└── awx/                    # AWX plugin package (to be scaffolded)
```

## Development

### Prerequisites

- Node.js 18+ (Node.js 20+ recommended for `AbortSignal.any()`)
- `@opencode-ai/plugin` (peer dependency)
- Access to an AAP instance for integration testing

### Getting Started

This repo is in a greenfield state — start with [Issue #1](https://github.com/weiyentan/opencode-plugins/issues/1) (Phase 0: Repository Scaffolding) to set up the package structure, build toolchain, and test infrastructure.

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
