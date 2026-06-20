# AWX Plugin (`@opencode-ai/plugin-awx`)

OpenCode server plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Provides native tool access to job templates, projects, and job lifecycle operations.

## Status

✅ **Phase 0 — Repository Scaffolding** (complete)

Phase 0 delivered the foundational modules for the AWX plugin:

| Module | File | Purpose |
|--------|------|---------|
| **Plugin entry** | `src/index.ts` | Registers the hello-world tool; validates plugin load, tool registration, and hot-reload |
| **Auth hook** | `src/auth.ts` | Bearer token / PAT authentication via OpenCode's `type: "api"` auth hook with init-time validation |
| **Output contract** | `src/contracts/job-detail.ts` | Zod schemas and TypeScript types (`JobDetailOutput`) matching `awx_job_detail.py` v1.0 |
| **Transforms** | `src/transforms.ts` | Pure functions: SSH→HTTPS URL conversion, git branch inference, required-var validation |
| **Snapshot generator** | `scripts/generate-snapshots.py` | Python script that regenerates contract snapshots from fixture data |

Full tool implementation (Phase 1) begins next — see the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues) for available issues.

## Prerequisites

- **Node.js** >= 18.0.0 (Node.js 20+ recommended for `AbortSignal.any()` support)
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

# Integration tests (requires AAP instance and PAT)
export AWX_TOKEN=your_pat_token_here
npx vitest run tests/integration/
```

Tests follow TDD (test-driven development) with [Vitest](https://vitest.dev) and verify behavior through the public plugin interface.

## Hot-Reload

The OpenCode plugin server watches plugin source files and **automatically reloads** when changes are detected — no server restart required. This was verified during Phase 0 scaffolding:

1. The plugin is registered by the OpenCode server (consuming `src/index.ts` as the entry point).
2. Modifying the tool's `description` field in `src/index.ts` (e.g., changing the hello-world description text) triggers a plugin reload.
3. The server picks up the new description on the next tool invocation.

### Known Limitation (Phase 0)

At the scaffolding stage, hot-reload verification was performed structurally (the `tsc --noEmit` / `vitest run` cycle confirms the module compiles and tool execute signature is correct) but end-to-end hot-reload testing requires a running OpenCode server instance. Full integration testing of hot-reload behavior is tracked for a later phase.

### Dev-Mode Flag

The `package.json` `type` field is set to `"module"`, and the `main` / `exports` fields point directly to `src/index.ts`. This allows the OpenCode server to consume TypeScript source directly in development mode, bypassing the build step for faster iteration. When running in development:

```bash
# The OpenCode server watches src/ and reloads on change
# No explicit watch flag needed — this is the default plugin loading behavior
```

For production deployment, run `npm run build` to compile TypeScript into `dist/` and update the `main` field to point to the compiled output.

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

See the [Architecture Decision Records](../../docs/adr/) in the monorepo for design rationale:

- **ADR 0001**: Bearer token auth strategy (PAT)
- **ADR 0002**: Output contract alignment with `awx_job_detail.py` v1.0
- **ADR 0003**: Plugin API surface discovery (`@opencode-ai/plugin` types)
- **ADR 0004**: Non-blocking `awx-wait-job` agent-side polling pattern
- **ADR 0005**: Extra-var transformations in `transforms.ts`
- **ADR 0006**: Connection resilience parameters (timeout, retry, circuit breaker)

## License

MIT
