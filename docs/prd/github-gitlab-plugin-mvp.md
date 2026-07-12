# PRD: GitHub & GitLab OpenCode Plugin MVP

## Problem Statement

OpenCode agents currently lack native, structured access to GitHub and GitLab APIs. The existing skills (`gh`, `glab`) are instruction documents that guide agents to run CLI commands, resulting in fragile shell-out calls that differ across platforms, lack typed validation, and cannot leverage powerful API features like GraphQL.

The AWX plugin (`@weiyentan/opencode-plugin-awx`) proves the plugin architecture works — typed tools, auth hooks, middleware, and contract-driven output. The same architecture should be applied to GitHub and GitLab, giving agents structured, reliable access to the APIs developers use daily.

## Solution

Build two OpenCode plugin packages — `@weiyentan/opencode-plugin-github` and `@weiyentan/opencode-plugin-gitlab` — that expose their respective APIs as plugin tools. Each plugin uses REST for CRUD operations and GraphQL for rich context queries, presenting a unified tool surface to the agent.

The tool surface is designed for **platform portability** — only concepts that exist on both platforms are included in the MVP. Tool output uses a hybrid shape: curated fields for the agent's default view plus a `_raw` field preserving the full API response.

## User Stories

1. As an AI agent, I want to list issues in a repository, so that I can triage and prioritise work.
2. As an AI agent, I want to view an issue with its full context (body, labels, comments, linked PRs), so that I can understand what needs to be done without multiple round-trips.
3. As an AI agent, I want to create an issue, so that I can track bugs and feature requests.
4. As an AI agent, I want to update an issue (state, title, body, labels, assignees), so that I can manage issue lifecycle.
5. As an AI agent, I want to comment on an issue, so that I can participate in discussion threads.
6. As an AI agent, I want to list pull requests (or merge requests), so that I can review pending changes.
7. As an AI agent, I want to view a pull request with its diffstat, commits, reviews, and merge status, so that I can assess readiness for merge.
8. As an AI agent, I want to create a pull request, so that I can propose code changes.
9. As an AI agent, I want to merge a pull request, so that I can land approved changes.
10. As an AI agent, I want to get repository metadata (description, topics, language, stars), so that I can understand project context.
11. As an AI agent, I want to search repositories by query, so that I can discover relevant projects.
12. As an AI agent, I want to search code across repositories, so that I can find usages, patterns, and bugs.
13. As an AI agent, I want to get the current authenticated user's profile, so that I can personalise interactions.
14. As an AI agent, I want to execute arbitrary GraphQL queries, so that I can access API capabilities not covered by dedicated tools.
15. As an AI agent, I want to search issues across repositories using GraphQL, so that I can find cross-cutting concerns.
16. As a developer, I want tools to use the same output shape across all plugins, so that agent interactions are predictable.
17. As a developer, I want CI to run only when a package changes, so that pull requests are fast and focused.
18. As an AI agent, I want to use merge-request–specific tools for GitLab (e.g., `gitlab.mr.list`), so that terminology matches the platform.

## Implementation Decisions

### Tool Namespace Convention
- GitHub tools use dot-notation with `github.` prefix: `github.issue.list`, `github.pr.create`, `github.code.search`
- GitLab tools use dot-notation with `gitlab.` prefix: `gitlab.issue.list`, `gitlab.mr.create`, `gitlab.code.search`
- Merge requests use `mr` (not `pr`) in GitLab tool names to match GitLab's native terminology

### API Approach — Dual Track
- **REST** for simple CRUD operations (`list`, `get`, `create`, `update`, `comment`, `merge`)
- **GraphQL** for rich context queries that would require multiple REST round-trips (`get-full`, `search`)

A thin GraphQL client wrapper (`src/graphql.ts`) encapsulates the `@octokit/graphql` library behind a simple `query(query, variables)` interface, handling auth, variables, error parsing, and rate-limit tracking.

### Output Shape — Structured with Lossless Raw Fallback (ADR 0009)
Every tool returns:
```
{ output: string, metadata: { count, items: [...], _raw: unknown } }
```
- `output` — human-readable formatted text
- `items` — curated fields the agent typically needs
- `_raw` — full API response, always present but only read on demand

This avoids both the lossiness of strict Zod contracts (AWX pain point) and the context bloat of returning every API field in the default view.

### Monorepo Structure
All packages live in a single monorepo at `github.com/weiyentan/opencode-plugins`. Packages are fully independent — no shared runtime code, only shared architecture patterns. CI uses path-filtered workflows to test only the affected packages on push/PR. Publishing is manual via `workflow_dispatch` with a selected package, expected version, and dist tag.

### Plugin Architecture
Each plugin follows the proven AWX pattern:
1. **Auth hook** — `type: "api"` PAT prompt, validated via `GET /user` (GitHub) or equivalent GitLab endpoint
2. **Lazy client resolver** — cached by token, created on first tool execution
3. **Tool factories** — `createXxxTool(getClient)` exported per tool file
4. **Plain TypeScript** — `tsc` (no bundler), `"type": "module"`, ES2022 target

### Modules (GitHub plugin)
- `src/index.ts` — Plugin entry point, registers all tools
- `src/auth.ts` — PAT auth hook with validation
- `src/client.ts` — REST HTTP client (existing, add GraphQL method)
- `src/graphql.ts` — GraphQL client wrapper (NEW)
- `src/tools/issues.ts` — `list`, `get`, `create`, `update`, `comment`
- `src/tools/prs.ts` — `list`, `get`, `create`, `merge`
- `src/tools/repos.ts` — `get`, `search`
- `src/tools/code.ts` — `search`
- `src/tools/user.ts` — `get`
- `src/tools/rich.ts` — GraphQL rich tools: `issue.get-full`, `pr.get-full`, `issue.search`, `repo.get-full`
- `src/tools/query.ts` — Generic GraphQL query
- `tests/` — Unit + integration tests

### GitLab plugin
Same module structure. Namespaced as `gitlab.*`. Uses `mr` prefix for merge request tools. GitLab's API is REST-based with a GraphQL endpoint at `https://gitlab.com/api/graphql`.

### Dependency: @octokit/graphql
The GitHub plugin adds `@octokit/graphql` (3 dependencies, ~15KB) for GraphQL support. The REST client remains plain `fetch`. The GitLab plugin uses the same pattern but with GitLab's own GraphQL endpoint — no separate SDK package needed.

## Testing Decisions

### What makes a good test
- Tests external behaviour, not implementation details
- Input validation (Zod schemas reject bad args)
- Output shape (curated fields + `_raw` present)
- Auth failure handling (invalid token → helpful error)
- Network errors (timeout, rate limit → graceful fallback)

### What will be tested
- **Auth hook**: token validation, error messages
- **Client**: request construction, rate-limit header parsing (unit)
- **Each REST tool**: input validation, output formatting (unit with fixtures)
- **GraphQL integration**: one happy-path query per rich tool (integration, gated behind `GITHUB_TOKEN`/`GITLAB_TOKEN`)

### Prior art
The AWX plugin has 49 test files (45 unit, 4 integration) using Vitest with fixture-based contract testing. The same Vitest setup, fixture pattern, and gated integration test approach apply directly.

## Out of Scope

- Pull request reviews — deferred
- GitHub Actions / workflow tools — deferred
- Organisation administration (org, team, billing management) — deferred
- GitHub Apps installation flow — deferred
- Raw `gh`/`glab` CLI passthrough — not planned
- Webhook management — not planned
- Shared abstraction layer between GitHub and GitLab plugins — each package is independent

## Further Notes

- The prototype at `packages/github/` (commit `release/0.7.0-experimental` branch) validates the plugin architecture. The REST client, auth hook, and entry point patterns are proven.
- ADR 0009 documents the structured output with `_raw` fallback decision.
- The `.opencode/plugins/` shim mechanism is NOT used for plugin loading — use `opencode.jsonc` at repo root with `["./packages/<name>", {}]` syntax.
- `process.env.GITHUB_TOKEN` / `process.env.GITLAB_TOKEN` is the reliable token resolution path (not `getSecret`).
