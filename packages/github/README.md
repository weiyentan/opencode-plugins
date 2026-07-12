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

All tools are registered with `github.*` namespace.

| Tool | Description |
|------|-------------|
| `hello` | Sanity-check tool — verifies plugin load, tool registration, and hot-reload |
| `github-configure` | Configure GitHub connection settings (base URL and/or PAT) at runtime |
| `github-debug-env` | Debug tool — returns current GitHub environment configuration |
| `github.issue.get-full` | Fetch a single issue with body, labels, comments, linked PRs, and timeline events (GraphQL) |
| `github.pr.get-full` | Fetch a single PR with commits, reviews, review threads, merge status, and CI checks (GraphQL) |
| `github.issue.search` | Cross-repo issue search with rich results including repo context (GraphQL) |
| `github.repo.get-full` | Fetch repository with README, recent commits, top contributors, languages, and stats (GraphQL) |
| `github.query` | Execute an arbitrary GraphQL query against the GitHub API |

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
| `src/tools/query.ts` | Generic GraphQL passthrough tool (`github.query`) |

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
