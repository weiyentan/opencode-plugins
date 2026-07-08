# Changelog

All notable changes to the AWX plugin are documented in this file.

## [Unreleased]

### Added

- **New list tools**: Added `awx-list-organizations`, `awx-list-credentials`, and `awx-list-inventories` tools — paginated listing with timeout budgeting, page cap enforcement, name sorting, and server-side filtering. Closes P0 gaps from tool-gap-audit (list organizations, list credentials, list inventories).
- **New source modules**: `src/list-organizations.ts`, `src/list-credentials.ts`, `src/list-inventories.ts` — shared pagination logic for the three new list tools.
- **Tool-action mapping audit trail**: `docs/tool-action-mapping.md` — full accounting of 33 AWX API operations mapped to plugin tools, with gap priority breakdown and token safety verification.
- **Version bump**: `0.5.3` → `0.5.4`
- **Security**: `test-awx.ps1` and `test-awx-stderr.ps1` no longer echo `AWX_TOKEN` values — display "(loaded from auth.json — value not displayed for security)" instead.
- **Tool factory modules** (`src/tools/`): Extracted all 22 inline tool definitions from the monolithic `index.ts` into 9 dedicated factory modules:
  - `hello.ts` — hello-world tool
  - `configure.ts` — awx-debug-env, awx-configure tools
  - `crud.ts` — awx-create-project, awx-create-template, awx-create-inventory, awx-update-project, awx-update-template, awx-update-inventory, awx-delete-project, awx-delete-template, awx-delete-inventory tools
  - `job-lifecycle.ts` — awx-launch-job, awx-job-status, awx-wait-job tools
  - `job-events.ts` — awx-get-job-events tool
  - `list.ts` — awx-list-templates, awx-list-projects, awx-list-jobs, awx-list-organizations, awx-list-credentials, awx-list-inventories tools
  - `get-resource.ts` — awx-get-resource tool
  - `sync-project.ts` — awx-sync-project tool
  - `attach-credential.ts` — awx-attach-credential tool
- **Shared utilities module** (`src/utils.ts`): Extracted 4 shared helper functions (`formatErrorResponse`, `wrapMutationResult`, `buildPipeTable`, `formatResourceOutput`) from `index.ts` into a dedicated module.

### Changed

- **index.ts**: Reduced from ~2122 lines to ~168 lines as a thin orchestrator that imports factory modules and wires them into the Hooks shape. No behavioral changes — all 22 tool keys, Zod schemas, argument descriptions, error handling patterns, and metadata shapes are preserved identically (3 new tool keys added to `list.ts` in a subsequent change).
- **Module imports**: `setCustomConfig` import moved from `index.ts` to `tools/configure.ts` where it is consumed.

### Fixed

- No behavioral fixes in this release — pure structural refactoring.

### Removed

- No functionality removed — all 25 tools preserved with identical behavior (22 original + 3 new list tools).
