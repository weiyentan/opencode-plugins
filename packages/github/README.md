# @weiyentan/opencode-plugin-github

[![npm version](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-github)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-github)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An [OpenCode](https://opencode.ai) server plugin that exposes GitHub API capabilities as native agent tools. Uses GraphQL for rich context queries and REST for CRUD operations — optimized for browsing issues, reviewing PRs, searching code, and getting repository context.

## Installation

```bash
npm install @weiyentan/opencode-plugin-github
```

Add to your `opencode.jsonc`:

```jsonc
{ "plugin": ["@weiyentan/opencode-plugin-github"] }
```

Set the required environment variable:

```bash
export GITHUB_TOKEN="your_pat_here"
```

## Tools

All tools are registered with `github_*` namespace.

### Utility Tools

| Tool | Description |
|------|-------------|
| `hello` | Sanity-check tool — verifies plugin load, tool registration, and hot-reload |
| `github-configure` | Configure GitHub connection settings (base URL and/or PAT) at runtime |
| `github-debug-env` | Debug tool — returns current GitHub environment configuration |

### GraphQL Rich Tools

| Tool | Description |
|------|-------------|
| `github_issue_get_full` | Fetch a single issue with body, labels, comments, linked PRs, and timeline events (GraphQL) |
| `github_pr_get_full` | Fetch a single PR with commits, reviews, review threads, merge status, and CI checks (GraphQL) |
| `github_issue_search` | Cross-repo issue search with rich results including repo context (GraphQL) |
| `github_repo_get_full` | Fetch repository with README, recent commits, top contributors, languages, and stats (GraphQL) |
| `github_query` | Execute an arbitrary GraphQL query against the GitHub API |

### REST Issue Tools

| Tool | Description |
|------|-------------|
| `github_issue_list` | List issues for a repository — filterable by state, labels, assignee, sort |
| `github_issue_get` | Get a single issue by number |
| `github_issue_create` | Create a new issue with title, body, labels, and assignees |
| `github_issue_update` | Update an existing issue (partial via PATCH) |
| `github_issue_comment` | Add a comment to an existing issue |

### REST Pull Request Tools

| Tool | Description |
|------|-------------|
| `github_pr_list` | List pull requests — filterable by state, head/base branch, sort |
| `github_pr_get` | Get a single PR with diffstat (additions, deletions, changed files) and commits |
| `github_pr_create` | Create a new pull request (supports draft PRs) |
| `github_pr_merge` | Merge a PR with merge, squash, or rebase strategy |

### REST Repository & Code Tools

| Tool | Description |
|------|-------------|
| `github_repo_get` | Get repository metadata — description, topics, language, stars, forks, license |
| `github_repo_search` | Search repositories by query — sorted by stars, forks, or last updated |
| `github_code_search` | Search code across repositories — supports language, repo, and path qualifiers |

### REST User Tool

| Tool | Description |
|------|-------------|
| `github_user_get` | Get current authenticated user's profile — name, email, company, followers, etc. |

## Configuration

The plugin resolves its PAT through a 3-tier fallback chain:

1. `github-configure` tool (runtime, highest priority)
2. Server-injected secret via `getSecret("github")` (if available)
3. `GITHUB_TOKEN` environment variable

## Architecture

| Module | Purpose |
|--------|---------|
| `src/index.ts` | Plugin entry point — wires auth hook and tools into the Hooks shape |
| `src/auth.ts` | PAT authentication via `authorize()` hook, init-time token validation |
| `src/client.ts` | HTTP middleware pipeline: signal → timeout → circuit breaker → fetch → retry/backoff |
| `src/graphql.ts` | GraphQL API wrapper using native `fetch` (no SDK dependency) |
| `src/tools/rich.ts` | GraphQL-powered rich tools — `get-full` and `search` variants |
| `src/tools/query.ts` | Generic GraphQL passthrough tool (`github_query`) |
| `src/tools/issues.ts` | REST-powered issue tools — list, get, create, update, comment |
| `src/tools/prs.ts` | REST-powered pull request tools — list, get, create, merge |
| `src/tools/repos.ts` | REST-powered repository tools — get, search |
| `src/tools/code.ts` | REST-powered code search tool |
| `src/tools/user.ts` | REST-powered user profile tool |

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
