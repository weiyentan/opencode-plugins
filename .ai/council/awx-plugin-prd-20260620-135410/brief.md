# Council Brief: OpenCode AWX Plugin PRD Review

## Idea Statement

Review the Product Requirements Document (PRD) for an OpenCode server plugin (`@opencode-ai/plugin-awx`) that provides six AWX REST API tools via Node.js `fetch`, replacing the current brittle PowerShell-based AWX connectivity stack. The plugin uses bearer token authentication stored via OpenCode's auth hook, configurable `baseUrl`, and returns structured outputs matching the existing `awx_job_detail.py` v1.0 contract.

## Context

- **No existing Council sessions found** — this is the first Council run in this repository.
- The repository (`opencode-plugins`) is currently empty except for a `.git/` directory and a `docs/prd/awx-plugin.md` file.
- The PRD is 222 lines covering: problem statement, solution, 9 user stories, implementation decisions (auth hook, client module, 6 tools, output contract, 4-phase rollout), testing decisions (unit, contract, integration), and out-of-scope items.
- The target AAP instance is `https://example.com` with existing AWX + EDA infrastructure running.

## Known Assumptions

1. The OpenCode plugin auth hook (`type: "api-key"`) is the correct mechanism for bearer token storage.
2. Node.js 18+ native `fetch` is available and sufficient (no axios/node-fetch dependency needed).
3. The existing `awx_job_detail.py` v1.0 contract is the right output shape to maintain backward compatibility with existing skill renderers.
4. The six v1 tools cover 90%+ of the AWX operations that OpenCode agents currently invoke via PowerShell.
5. The AAP server itself needs no changes — the plugin adapts to the existing API.
6. The 4-phase rollout (MVP → skill update → deprecation → retirement) is feasible without breaking existing workflows.

## Open Questions for the Council

1. **Auth approach**: Is the bearer token via OpenCode's `auth` hook sufficient, or should the plugin support OAuth2 token refresh / username-password exchange as a fallback?
2. **Tool surface**: Are 6 tools the right v1 scope, or should any be dropped (e.g., `awx-sync-project` is rarely used) or added (e.g., `awx-get-job-events` for debugging)?
3. **Contract alignment**: Does matching the existing `awx_job_detail.py` v1.0 contract constrain the plugin design unnecessarily?
4. **Error recovery**: How should the plugin handle AAP being unreachable, token expiry mid-session, or job launch failures (template not found, missing extra vars)?
5. **Migration risk**: What could go wrong during the Phase 2 skill updates that could break existing agent workflows?
6. **Cost/token efficiency**: Will the plugin actually reduce token waste compared to the current PowerShell approach, or could the HTTP overhead offset the gains?
7. **Testability**: Is the 3-layer test matrix (unit, contract, integration) sufficient, or are there gaps (e.g., no E2E tests, no performance tests)?
