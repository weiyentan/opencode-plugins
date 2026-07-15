# ADR 0012: Underscore as Standard Tool Naming Convention for All Future Plugins

**Status:** Accepted  
**Date:** 2026-07-15

## Context

The OpenCode plugin monorepo currently contains three plugins with three different tool naming conventions:

- **GitLab** — Uses underscore notation (`gitlab_issue_list`, `gitlab_mr_create`, `gitlab_code_search`)
- **GitHub** — Documented as dot-notation in `CONTEXT.md` (`github.issue.list`, `github.pr.create`, `github.code.search`), but actually uses underscore in the code (`github_issue_list`, `github_pr_create`, `github_code_search`) — see issue #220
- **AWX** — Uses hyphen/kebab notation (`awx-list-templates`, `awx-get-resource`, `awx-launch-job`)

With a fourth plugin (SQLite) entering the design phase, a single, consistent naming convention is needed to prevent further divergence. Each design iteration or new plugin should not have to decide its naming scheme from scratch, and users interacting with tools across different plugins should experience a predictable naming pattern.

## Decision

**All future plugins MUST use underscore notation for tool names.**

The canonical format is:

```
<prefix>_<noun>_<verb>
```

Where:
- `<prefix>` is the plugin identifier (e.g., `sqlite`, `github`, `gitlab`)
- `<noun>` is the domain entity or resource (e.g., `issue`, `template`, `repo`)
- `<verb>` is the operation (e.g., `list`, `get`, `create`, `delete`)

Examples of tool names that conform to this convention:

- `sqlite_table_list`
- `sqlite_query_execute`
- `github_issue_get`
- `gitlab_project_create`

**Dot-notation (`.`) is explicitly disallowed for future plugins.** The dot character has special meaning in many contexts (object property access, file extensions, shell interpretation), which can cause issues with tool routing, argument parsing, and command-line invocation.

### Grandfathering

Existing plugins are **grandfathered** — there is no forced migration of currently shipped tools. Specifically:

- AWX hyphen-notation tools (`awx-list-templates`, etc.) remain as-is
- GitHub underscore tools (`github_issue_list`, etc.) already conform — no change needed
- GitLab underscore tools (`gitlab_issue_list`, etc.) already conform — no change needed

New tools added to grandfathered plugins SHOULD follow underscore notation where practical, but this is a recommendation rather than a requirement for existing packages.

## Consequences

**Positive:**

- **Clarity for new plugin authors** — The convention is pre-decided; no time spent debating naming during design.
- **Codifies existing reality** — Both GitHub and GitLab plugins already use underscores in code. This ADR documents existing practice rather than imposing an abstract ideal.
- **Shell-safe** — Underscores are valid in shell, URLs, and most identifiers without escaping.
- **Predictable discovery** — Users can guess tool names across plugins (e.g., `<prefix>_<resource>_list`).
- **Consistent with broader ecosystem** — Several major CLI tools (GitLab CLI `glab`, AWS CLI, `gcloud`, `npm`) use underscore or hyphen; underscore avoids ambiguity with shell redirection and file extensions that dot-notation introduces.

**Negative:**

- **AWX remains divergent** — AWX hyphen-notation is shipped and cannot be changed without breaking existing integrations. The monorepo will never be fully uniform.
- **Documentation aligned** — CONTEXT.md, README.md, ADR 0009, and the GitHub/GitLab plugin PRD already reflect underscore notation for tool names. No documentation updates are needed alongside this ADR.
- **Minor migration friction for SQLite** — If any SQLite design documents were drafted with dot-notation placeholders, they need to be updated before implementation.

## Alternatives Considered

1. **Hyphen/kebab notation** (`<prefix>-<noun>-<verb>`) — Rejected because 2 out of 3 existing plugins already use underscores. Adopting hyphens would create a 2-to-1 split where the majority convention is abandoned in favor of the minority. Additionally, hyphens are not valid in JavaScript identifiers without quoting, making programmatic tool references slightly more cumbersome.

2. **Dot-notation** (`<prefix>.<noun>.<verb>`) — Rejected because it was never actually shipped in code — it only existed in documentation (`CONTEXT.md`). The dot character has special meaning in shell (source/execute), JavaScript (property access), and file paths (extension separator), which introduces real parsing ambiguity. Going forward, dot-notation is explicitly disallowed.

3. **Per-plugin freedom** (no convention) — Rejected because inconsistency hurts discoverability. Users interacting with multiple plugins should not need to remember three different naming schemes. A shared convention reduces cognitive overhead and makes cross-plugin tool references predictable.

