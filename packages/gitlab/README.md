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

| Tool | Description |
|------|-------------|
| `hello` | Sanity-check tool — verifies plugin load, tool registration, and hot-reload |
| `gitlab-configure` | Configure the GitLab plugin at runtime — sets the PAT used for all GitLab API requests |
| `gitlab-ping` | Verify REST and GraphQL connectivity by pinging `/api/v4/user` and validating the GraphQL client |

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
