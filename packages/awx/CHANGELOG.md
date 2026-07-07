# Changelog

All notable changes to the AWX plugin are documented in this file.

## [Unreleased]

### Added

- **Tool factory modules** (`src/tools/`): Extracted all 22 inline tool definitions from the monolithic `index.ts` into 9 dedicated factory modules:
  - `hello.ts` — hello-world tool
  - `configure.ts` — awx-debug-env, awx-configure tools
  - `crud.ts` — awx-create-project, awx-create-template, awx-create-inventory, awx-update-project, awx-update-template, awx-update-inventory, awx-delete-project, awx-delete-template, awx-delete-inventory tools
  - `job-lifecycle.ts` — awx-launch-job, awx-job-status, awx-wait-job tools
  - `job-events.ts` — awx-get-job-events tool
  - `list.ts` — awx-list-templates, awx-list-projects, awx-list-jobs tools
  - `get-resource.ts` — awx-get-resource tool
  - `sync-project.ts` — awx-sync-project tool
  - `attach-credential.ts` — awx-attach-credential tool
- **Shared utilities module** (`src/utils.ts`): Extracted 4 shared helper functions (`formatErrorResponse`, `wrapMutationResult`, `buildPipeTable`, `formatResourceOutput`) from `index.ts` into a dedicated module.

### Changed

- **index.ts**: Reduced from ~2122 lines to ~168 lines as a thin orchestrator that imports factory modules and wires them into the Hooks shape. No behavioral changes — all 22 tool keys, Zod schemas, argument descriptions, error handling patterns, and metadata shapes are preserved identically.
- **Module imports**: `setCustomConfig` import moved from `index.ts` to `tools/configure.ts` where it is consumed.

### Fixed

- No behavioral fixes in this release — pure structural refactoring.

### Removed

- No functionality removed — all 22 tools preserved with identical behavior.
