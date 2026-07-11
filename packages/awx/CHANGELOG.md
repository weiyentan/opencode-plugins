# Changelog

All notable changes to the AWX plugin are documented in this file.

## [Unreleased]

### Added

- **11 new list tools**: Added `awx-list-schedules`, `awx-list-notification-templates`, `awx-list-labels`, `awx-list-instance-groups`, `awx-list-execution-environments`, `awx-list-templates-by-credential`, `awx-list-users`, `awx-list-hosts`, `awx-list-workflow-templates`, `awx-list-groups`, and `awx-list-teams` — all with pagination, timeout budgeting, page cap enforcement, name sorting, and server-side filtering.
- **New source modules** (`src/list-*.ts`): 11 dedicated modules for each new list tool, plus `src/list-templates-by-credential.ts`.
- **`awx-run-command` tool** (`src/run-command.ts`): Launch ad-hoc Ansible commands (`POST /api/v2/ad_hoc_commands/`) with any module.
- **`awx-launch-workflow` tool** (`src/tools/launch-workflow.ts`): Launch workflow job templates with extra_vars support.
- **`awx-ping` tool** (`src/ping.ts` + `src/tools/ping.ts`): Health check / connectivity verification via `GET /api/v2/ping/`.
- **New contracts**: `src/contracts/credential-detail.ts`, `src/contracts/organization-detail.ts`.
- **New mappers**: `src/mappers/map-credential.ts`, `src/mappers/map-organization.ts`.
- **Tool factories**: `src/tools/run-command.ts`, `src/tools/launch-workflow.ts`, `src/tools/ping.ts`.
- **`awx-get-resource` enhanced**: Now supports `type="credential"` and `type="organization"` via new contracts and mappers.
- **CRUD tools for hosts, groups, and labels** (`src/tools/crud-host.ts`, `src/tools/crud-group.ts`, `src/tools/crud-label.ts`): Full create/update/delete operations for hosts, groups, and labels (PR #164, #166).
- **CRUD tools for instance groups and execution environments** (`src/tools/crud-instance-group.ts`, `src/tools/crud-execution-environment.ts`): Full create/update/delete operations for instance groups and execution environments (PR #164, #166).
- **CRUD tools for credentials, organizations, and workflow templates** (`src/tools/crud-credential.ts`, `src/tools/crud-organization.ts`, `src/tools/crud-workflow-template.ts`): Full create/update/delete operations for credentials, organizations, and workflow templates (PR #165).
- **CRUD tools for users, teams, schedules, and notification templates** (`src/tools/crud-user.ts`, `src/tools/crud-team.ts`, `src/tools/crud-schedule.ts`, `src/tools/crud-notification-template.ts`): Full create/update/delete operations for users, teams, schedules, and notification templates (PR #171).

### Changed

- **Tool count**: Expanded from 25 tools to 60 tools across all modules.
- **Tool-action mapping**: Updated `docs/tool-action-mapping.md` — coverage from ~76% to ~97% (32 of 33 operations covered).

## [0.6.1] - 2026-07-08

### Fixed

- **Version bump alignment**: The `v0.6.1` tag was prematurely created before the version in `package.json` was bumped from `0.6.0` to `0.6.1`. The tag has been recreated at the correct commit with the version properly set to `0.6.1`.

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
