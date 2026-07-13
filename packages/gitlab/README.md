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

All tools are registered with `gitlab.*` namespace.

### Utility Tools

| Tool | Description |
|------|-------------|
| `hello` | Sanity-check tool — verifies plugin load, tool registration, and hot-reload |
| `gitlab-configure` | Configure the GitLab plugin at runtime — sets the PAT used for all GitLab API requests |
| `gitlab-ping` | Verify REST and GraphQL connectivity by pinging `/api/v4/user` and validating the GraphQL client |

### GraphQL Rich Tools

| Tool | Description |
|------|-------------|
| `gitlab.issue.get-full` | Fetch a single issue with description, labels, notes (first 15), linked MRs, and system events (GraphQL) |
| `gitlab.mr.get-full` | Fetch a single MR with commits (first 30), discussions, pipelines, merge status, approvals, and diff stats (GraphQL) |
| `gitlab.issue.search` | Cross-project issue search with rich results including project context and labels (GraphQL) |
| `gitlab.project.get-full` | Fetch a project with description, languages, README summary, top-level file tree, recent activity, and stats (GraphQL) |
| `gitlab.query` | Execute an arbitrary GraphQL query against the GitLab API |

### REST Issue Tools

| Tool | Description |
|------|-------------|
| `gitlab.issue.list` | List issues for a project — filterable by state, labels, milestone, and search text |
| `gitlab.issue.get` | Get a single issue by project-level IID |
| `gitlab.issue.create` | Create a new issue with title, description, labels, milestone, and assignees |
| `gitlab.issue.update` | Update an existing issue (partial update via PUT) |
| `gitlab.issue.comment` | Add a note (comment) to an existing issue |

### REST Merge Request Tools

| Tool | Description |
|------|-------------|
| `gitlab.mr.list` | List merge requests for a project — filterable by state, labels, source/target branch |
| `gitlab.mr.get` | Get a single MR with diff stats and commit history |
| `gitlab.mr.create` | Create a new merge request (supports draft/WIP) |
| `gitlab.mr.merge` | Merge a merge request with configurable merge strategy, squash, and source branch removal |

### REST Project & Code Tools

| Tool | Description |
|------|-------------|
| `gitlab.project.get` | Get project metadata — description, topics, language, star/fork counts, visibility, repo URLs |
| `gitlab.project.search` | Search projects by query string |
| `gitlab.code.search` | Search code content across projects — filter by project ID and language |

### REST User Tool

| Tool | Description |
|------|-------------|
| `gitlab.user.get` | Get current authenticated user's profile — username, name, email, avatar, bio, location |

## Configuration

The plugin resolves its PAT through a 3-tier fallback chain:

1. `gitlab-configure` tool (runtime, highest priority)
2. Server-injected secret via `getSecret("gitlab")` (if available)
3. `GITLAB_TOKEN` environment variable

The PAT requires at least `read_user` and `api` scopes.

## Architecture

| Module | Purpose |
|--------|---------|
| `src/index.ts` | Plugin entry point — wires auth hook and tools into the Hooks shape |
| `src/auth.ts` | PAT authentication via `authorize()` hook, init-time token validation |
| `src/client.ts` | HTTP middleware pipeline with circuit breaker, rate-limit parsing, and retry/backoff |
| `src/graphql.ts` | GraphQL API wrapper using native `fetch` (no SDK dependency) |
| `src/pagination.ts` | GitLab pagination utilities — Link header parsing and numeric page helpers |
| `src/tools/issues.ts` | REST-powered issue tools — list, get, create, update, comment |
| `src/tools/mrs.ts` | REST-powered merge request tools — list, get, create, merge |
| `src/tools/projects.ts` | REST-powered project tools — get, search |
| `src/tools/code.ts` | REST-powered code search tool |
| `src/tools/user.ts` | REST-powered user profile tool |
| `src/tools/rich.ts` | GraphQL-powered rich tools — issue.get-full, mr.get-full, issue.search, project.get-full |
| `src/tools/query.ts` | Generic GraphQL passthrough tool (`gitlab.query`) |

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
