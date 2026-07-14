# @weiyentan/opencode-plugin-gitlab

[![npm version](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-gitlab)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-gitlab)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An [OpenCode](https://opencode.ai) server plugin that exposes GitLab API capabilities as native agent tools. Uses GraphQL for rich queries and REST for CRUD operations — optimized for browsing issues, reviewing merge requests, searching code, and getting repository context.

## Installation

```bash
npm install @weiyentan/opencode-plugin-gitlab
```

Add to your `opencode.jsonc`:

```jsonc
{ "plugin": ["@weiyentan/opencode-plugin-gitlab"] }
```

Set the required environment variable:

```bash
export GITLAB_TOKEN="your_pat_here"
```

## Tools

All tools are registered with `gitlab_*` namespace.

### Utility Tools

| Tool | Description |
|------|-------------|
| `hello` | Sanity-check tool — verifies plugin load, tool registration, and hot-reload |
| `gitlab_configure` | Configure the GitLab plugin at runtime — sets the PAT used for all GitLab API requests |
| `gitlab_ping` | Verify REST and GraphQL connectivity by pinging `/api/v4/user` and validating the GraphQL client |

### GraphQL Rich Tools

| Tool | Description |
|------|-------------|
| `gitlab_issue_get_full` | Fetch a single issue with description, labels, notes (first 15), linked MRs, and system events (GraphQL) |
| `gitlab_mr_get_full` | Fetch a single MR with commits (first 30), discussions, pipelines, merge status, approvals, and diff stats (GraphQL) |
| `gitlab_issue_search` | Cross-project issue search with rich results including project context and labels (GraphQL) |
| `gitlab_project_get_full` | Fetch a project with description, languages, README summary, top-level file tree, recent activity, and stats (GraphQL) |
| `gitlab_query` | Execute an arbitrary GraphQL query against the GitLab API |

### REST Issue Tools

| Tool | Description |
|------|-------------|
| `gitlab_issue_list` | List issues for a project — filterable by state, labels, milestone, and search text |
| `gitlab_issue_get` | Get a single issue by project-level IID |
| `gitlab_issue_create` | Create a new issue with title, description, labels, milestone, and assignees |
| `gitlab_issue_update` | Update an existing issue (partial update via PUT) |
| `gitlab_issue_comment` | Add a note (comment) to an existing issue |

### REST Merge Request Tools

| Tool | Description |
|------|-------------|
| `gitlab_mr_list` | List merge requests for a project — filterable by state, labels, source/target branch |
| `gitlab_mr_get` | Get a single MR with diff stats and commit history |
| `gitlab_mr_create` | Create a new merge request (supports draft/WIP) |
| `gitlab_mr_merge` | Merge a merge request with configurable merge strategy, squash, and source branch removal |

### REST Project & Code Tools

| Tool | Description |
|------|-------------|
| `gitlab_project_get` | Get project metadata — description, topics, language, star/fork counts, visibility, repo URLs |
| `gitlab_project_search` | Search projects by query string |
| `gitlab_code_search` | Search code content across projects — filter by project ID and language |

### REST User Tool

| Tool | Description |
|------|-------------|
| `gitlab_user_get` | Get current authenticated user's profile — username, name, email, avatar, bio, location |

## Configuration

The plugin resolves its PAT through a 3-tier fallback chain:

1. `gitlab_configure` tool (runtime, highest priority)
2. Server-injected secret via `getSecret("gitlab")` (if available)
3. `GITLAB_TOKEN` environment variable

The PAT requires at least `read_user` and `api` scopes.

## Architecture

| Module | Purpose |
|--------|---------|
| `src/index.ts` | Plugin entry point — wires auth hook and tools into the Hooks shape; exports only `GitLabPlugin` and `default` (see ADR-0007) |
| `src/runtime-config.ts` | Runtime configuration store — `CustomConfig` interface, `setCustomConfig()`, `getCustomConfig()`; kept separate from entry point per ADR-0007 |
| `src/auth.ts` | PAT authentication via `authorize()` hook, init-time token validation |
| `src/client.ts` | HTTP middleware pipeline with circuit breaker, rate-limit parsing, and retry/backoff |
| `src/graphql.ts` | GraphQL API wrapper using native `fetch` (no SDK dependency) |
| `src/pagination.ts` | GitLab pagination utilities — Link header parsing and numeric page helpers |
| `src/tools/issues.ts` | REST-powered issue tools — list, get, create, update, comment |
| `src/tools/mrs.ts` | REST-powered merge request tools — list, get, create, merge |
| `src/tools/projects.ts` | REST-powered project tools — get, search |
| `src/tools/code.ts` | REST-powered code search tool |
| `src/tools/user.ts` | REST-powered user profile tool |
| `src/tools/rich.ts` | GraphQL-powered rich tools — gitlab_issue_get_full, gitlab_mr_get_full, gitlab_issue_search, gitlab_project_get_full |
| `src/tools/query.ts` | Generic GraphQL passthrough tool (`gitlab_query`) |

## Development

```bash
npm install                # Install dependencies
npm run build              # Compile TypeScript
npm test                   # Run unit tests (vitest)
npm run lint               # Type-check only
```

Requires Node >=20.

## License

MIT — see [LICENSE](LICENSE) for full terms.
