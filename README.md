# OpenCode Plugins

[![CI](https://img.shields.io/github/actions/workflow/status/weiyentan/opencode-plugins/ci.yml?branch=master&label=CI)](https://github.com/weiyentan/opencode-plugins/actions)
[![awx](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-awx?label=awx)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-awx)
[![github](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-github?label=github)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-github)
[![gitlab](https://img.shields.io/npm/v/@weiyentan/opencode-plugin-gitlab?label=gitlab)](https://www.npmjs.com/package/@weiyentan/opencode-plugin-gitlab)
[![License](https://img.shields.io/github/license/weiyentan/opencode-plugins)](LICENSE)

A monorepo of [OpenCode](https://opencode.ai) server plugins that extend the OpenCode agent with first-class tool integrations.

## Plugins

### AWX Plugin (`packages/awx/`)

An OpenCode plugin for [AWX](https://github.com/ansible/awx) / Ansible Automation Platform (AAP). Provides native tool access to job templates, projects, and job lifecycle operations — replacing brittle PowerShell scripts with a portable, testable TypeScript plugin.

**Status:** ✅ Phase 0 (scaffolding), Phase 1 (client infrastructure), and Phase 2 core tools complete — 55+ tools implemented covering project lookup, template detail, inventory detail, job lifecycle, CRUD operations (create/update/delete for projects, templates, inventories, users, teams, schedules, notification templates, hosts, groups, labels, instance groups, execution environments, credentials, organizations, and workflow templates), credential attachment and detachment, environment debugging, and interactive configuration.

**Coverage:** 53+ AWX operations covering all major resource CRUD lifecycle needs. Full tool-action mapping table documented in the tool gap audit.

**Key docs:**
- [Architecture Decision Records](docs/adr/) — 6 ADRs covering auth, output contract, resilience, polling, transforms
- [AWX Tool Gap Audit](packages/awx/docs/tool-gap-audit.md) — full tool coverage and gap analysis
- [Client Middleware Design](docs/client-middleware-design.md) — middleware pipeline spec
- [Domain Glossary](CONTEXT.md) — core concepts and terminology
- [Changelog](packages/awx/CHANGELOG.md) — release history and version notes

**License:** MIT — see [LICENSE](LICENSE) for full terms.

**Implementation issues:** https://github.com/weiyentan/opencode-plugins/issues

### GitHub Plugin (`packages/github/`)

An OpenCode plugin that exposes GitHub API capabilities as developer-facing tools. Uses GraphQL for rich context queries and REST for CRUD operations — optimized for browsing issues, reviewing PRs, searching code, and getting repository context.

**Status:** ✅ Phase 0 (spike) and Phase 1 (core tools + REST tools) complete — 21 tools covering sanity check, configuration, rich GraphQL queries, REST issue CRUD + comment, PR list/get/create/merge, repo get/search, code search, and user profile.

**Tools:**
| Tool | Description |
|------|-------------|
| `hello` | Sanity-check tool — verifies plugin load | 
| `github-configure` | Configure connection settings (base URL, PAT) |
| `github-debug-env` | Return current environment configuration |
| `github.issue.get-full` | Issue with body, labels, comments, linked PRs, timeline (GraphQL) |
| `github.pr.get-full` | PR with commits, reviews, review threads, CI status (GraphQL) |
| `github.issue.search` | Cross-repo issue search with rich results (GraphQL) |
| `github.repo.get-full` | Repo with README, commits, languages, contributors (GraphQL) |
| `github.query` | Arbitrary GraphQL query passthrough |
| `github.issue.list` | List issues — filterable by state, labels, assignee |
| `github.issue.get` | Get a single issue by number |
| `github.issue.create` | Create a new issue |
| `github.issue.update` | Update an existing issue |
| `github.issue.comment` | Comment on an issue |
| `github.pr.list` | List pull requests |
| `github.pr.get` | Get a single PR with diffstat |
| `github.pr.create` | Create a new pull request |
| `github.pr.merge` | Merge a pull request |
| `github.repo.get` | Get repository metadata |
| `github.repo.search` | Search repositories |
| `github.code.search` | Search code across repositories |
| `github.user.get` | Get current user profile |

**Key docs:**
- [Package README](packages/github/README.md)
- [PRD — GitHub/GitLab Plugin MVP](docs/prd/github-gitlab-plugin-mvp.md)

### GitLab Plugin (`packages/gitlab/`)

An OpenCode plugin that exposes GitLab API capabilities as plugin tools. Uses GraphQL for rich queries and REST for CRUD operations with GitLab-native terminology (merge requests → `mr` prefix).

**Status:** ✅ Phase 0 (spike) and Phase 1 (core tools + REST tools + GraphQL rich tools) complete — 22 tools covering sanity check, runtime configuration, connectivity verification, GraphQL rich queries, REST issue CRUD + comment, MR list/get/create/merge, project get/search/list, code search, and user profile.

**Tools:**
| Tool | Description |
|------|-------------|
| `hello` | Sanity-check tool — verifies plugin load |
| `gitlab-configure` | Configure the GitLab plugin at runtime (sets PAT) |
| `gitlab-ping` | Verify REST and GraphQL connectivity to GitLab |
| `gitlab_issue_get_full` | Issue with notes, linked MRs, system events (GraphQL) |
| `gitlab_mr_get_full` | MR with commits, discussions, pipelines, approvals (GraphQL) |
| `gitlab_issue_search` | Cross-project issue search with rich results (GraphQL) |
| `gitlab_project_get_full` | Project with languages, README, file tree, activity (GraphQL) |
| `gitlab_query` | Arbitrary GraphQL query — response data surfaced as formatted JSON in output |
| `gitlab_issue_list` | List issues — filterable by state, labels, milestone |
| `gitlab_issue_get` | Get a single issue by IID |
| `gitlab_issue_create` | Create a new issue |
| `gitlab_issue_update` | Update an existing issue |
| `gitlab_issue_comment` | Comment on an issue |
| `gitlab_mr_list` | List merge requests |
| `gitlab_mr_get` | Get a single MR with diff stats |
| `gitlab_mr_create` | Create a new merge request |
| `gitlab_mr_merge` | Merge a merge request |
| `gitlab_project_get` | Get project metadata by ID or full path |
| `gitlab_project_search` | Search ALL GitLab projects globally — optional membership/owned params |
| `gitlab_project_list` | List user-accessible projects — defaults to membership scope |
| `gitlab_code_search` | Search code across projects |
| `gitlab_user_get` | Get current user profile |

**Key docs:**
- [Package README](packages/gitlab/README.md)
- [PRD — GitHub/GitLab Plugin MVP](docs/prd/github-gitlab-plugin-mvp.md)

### Portability Principle

Both the GitHub and GitLab plugins share a common architecture (GraphQL-powered rich tools, auth hooks, middleware pipelines) mapped to each platform's API. GitHub tool names use dot-notation (`github.*`) while GitLab tool names use underscore-notation (`gitlab_*`). See the [Domain Glossary](CONTEXT.md) for tool namespace conventions and design principles.

## Repository Structure

```
.opencode-workflow.yaml     # CI / workflow configuration
CONTEXT.md                  # Domain glossary (core concepts, AWX domain, infrastructure)
docs/
├── adr/                    # Architecture Decision Records (0001–0006)
├── prd/                    # Product Requirements Documents
│   ├── awx-plugin.md       # Original PRD (pre-refinement)
│   └── plugin-awx-refined.md  # Refined PRD
└── client-middleware-design.md  # Middleware pipeline design
packages/
├── awx/                    # AWX plugin package (auth, contracts, transforms, job lifecycle, CRUD mutation tools, resource detail tools)
├── github/                 # GitHub plugin package (issues, PRs, repos, code search, GraphQL rich tools)
└── gitlab/                 # GitLab plugin package (issues, MRs, projects, code search, GraphQL queries)
```

## Development

### Prerequisites

- Node >=20 (stable `fetch` API and `AbortSignal.timeout()` require Node 20+)
- `@opencode-ai/plugin` (peer dependency)
- Access to an AAP instance for integration testing

### Quick Start

#### AWX Plugin

Install the AWX plugin in your OpenCode project:

```bash
npm install @weiyentan/opencode-plugin-awx
```

Add it to your `opencode.jsonc` configuration:

```jsonc
{ "plugin": ["@weiyentan/opencode-plugin-awx"] }
```

Set the required environment variables:

```bash
export AWX_BASE_URL="https://your-aap-instance.example.com"
export AWX_TOKEN="your_pat_token_here"
```

> **Security:** In production, avoid hardcoding `AWX_TOKEN` in shell history or config files. Use a secrets manager (e.g., HashiCorp Vault, Ansible Vault, your CI/CD platform's secrets store) or the OpenCode auth hook for credential injection.

Launch OpenCode and the tools become available. Here are common usage examples:

```
/awx-list-templates                      # List all job templates
/awx-list-templates --filter "name__icontains=deploy"  # Filter templates
/awx-launch-job 8                        # Launch job template #8
/awx-job-status 42                       # Check status of job #42
/awx-sync-project 15                     # Sync project #15
/awx-ping                                # Test connectivity to AAP
```

#### GitHub Plugin

```bash
npm install @weiyentan/opencode-plugin-github
```

Add to `opencode.jsonc`:

```jsonc
{ "plugin": ["@weiyentan/opencode-plugin-github"] }
```

Set your token:

```bash
export GITHUB_TOKEN="your_pat_here"
```

Or configure at runtime with the `github-configure` tool. See [packages/github/README.md](packages/github/README.md) for all available tools.

#### GitLab Plugin

```bash
npm install @weiyentan/opencode-plugin-gitlab
```

Add to `opencode.jsonc`:

```jsonc
{ "plugin": ["@weiyentan/opencode-plugin-gitlab"] }
```

Set your token:

```bash
export GITLAB_TOKEN="your_pat_here"
```

Or configure at runtime with the `gitlab-configure` tool. See [packages/gitlab/README.md](packages/gitlab/README.md) for all available tools.

For a complete reference of all AWX tools and their arguments, see `packages/awx/README.md` or the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues).

### Architecture Overview

All plugins follow the same modular architecture:

- **`src/index.ts`** — Plugin entry point that wires auth hooks and tools into the Hooks shape
- **`src/client.ts`** — HTTP middleware pipeline with timeout, circuit breaker, rate-limit parsing, and retry/backoff
- **`src/auth.ts`** — Bearer token / PAT authentication via `authorize()` hook
- **`src/graphql.ts`** — GraphQL API wrapper (GitHub, GitLab) using native `fetch`

Package-specific documentation is in each `packages/<name>/README.md`.

### Running Integration Tests

Integration tests require an AAP instance and a valid PAT:

```bash
export AWX_TOKEN=your_pat_token_here
npx vitest run tests/integration/
```

## Autonomous Implementation

All issues use the AFK (Away From Keyboard) label for autonomous implementation:

- Run `/develop-loop` to auto-implement issues in dependency order
- Run `/tdd "<issue title>"` to implement a specific issue
- See `.opencode-workflow.yaml` for tier executor dispatch configuration

## Contributing

Contributions are welcome! This project uses autonomous (AFK) development workflows.

1. **Find an issue** — Pick an unblocked issue from the [issue tracker](https://github.com/weiyentan/opencode-plugins/issues) labeled `afk` and `status:todo`
2. **Read the docs** — Review the [PRD](docs/prd/) and [Architecture Decision Records](docs/adr/) for design guidance and conventions
3. **Implement with TDD** — Each tool must include unit tests and conform to the output contract. Use `/tdd "<issue title>"` for test-driven development
4. **Run tests locally** — `npm test` (unit tests) before submitting. Integration tests (`npx vitest run tests/integration/`) are gated behind `AWX_TOKEN` and are not required for every PR
5. **Submit** — Open a pull request with your changes. The CI pipeline will run path-filtered checks for the affected package(s)

See `.opencode-workflow.yaml` for development workflow configuration and tier executor dispatch details.
