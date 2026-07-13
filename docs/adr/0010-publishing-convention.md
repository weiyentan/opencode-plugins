# ADR 0010: Publishing Convention for @weiyentan/opencode-plugin-* Packages

## Status

Accepted

## Context

The OpenCode Plugins monorepo (`github.com/weiyentan/opencode-plugins`) packages three npm workspaces:

| Package | npm Name |
|---------|----------|
| `packages/awx` | `@weiyentan/opencode-plugin-awx` |
| `packages/github` | `@weiyentan/opencode-plugin-github` |
| `packages/gitlab` | `@weiyentan/opencode-plugin-gitlab` |

Each package is independently versioned and independently publishable. Before this ADR, no publishing workflow existed — packages were published ad-hoc by the operator running `npm publish` locally from the `master` branch. This is error-prone: there is no automated version-safety check, no branch-policy enforcement, and no record of who published what when.

We need a consistent, safe, auditable publishing convention that works for all current and future `@weiyentan/opencode-plugin-*` packages.

## Decision

**Publishing is manual via GitHub Actions `workflow_dispatch`**, with the following design:

### Workflow inputs

- `package` (choice: `awx`, `github`, `gitlab`) — the workspace to publish

### Safety checks (in order)

1. **Branch guard** — the workflow fails immediately unless `GITHUB_REF` is `refs/heads/master`. Publishing from any other branch is rejected with a clear error message.
2. **Package directory exists** — the mapped workspace directory must be present.
3. **Version auto-read + dist-tag derivation** — the version is read automatically from the selected package's `package.json`. The dist-tag is derived from the version string: if the version contains `-experimental.`, the tag is set to `experimental`; otherwise it defaults to `latest`. No manual version or tag input is required.
4. **Build + test** — `npm run build` and `npm test` must pass for the selected workspace before publish proceeds.

### Flow

```
workflow_dispatch (manual trigger on master)
  → checkout + setup Node.js 20
  → branch guard (fail if not refs/heads/master)
  → map package input → workspace name + directory
  → validate directory exists
  → auto-read version from package.json + derive dist-tag
  → npm ci
  → npm run build --workspace=<name>
  → npm test --workspace=<name>
  → npm publish --workspace=<name> --tag=<derived_dist_tag>
```

### Why `workflow_dispatch` (manual trigger)

- Publishing a plugin package is a deliberate act — a human must choose the package. The version and dist-tag are auto-derived from `package.json`.
- Automated publish on merge would require complex change-detection (which package changed? is the version bump correct? what tag?) that adds fragility with little benefit for a repo of this cadence.
- `workflow_dispatch` gives the operator full control while enforcing safety via automated checks.

### Why master-only

- Publishing from a feature branch risks shipping unreviewed code. `master` is the single source of truth for released versions.
- GitHub Actions supports `workflow_dispatch` branch selectors in the UI, but not programmatic branch restrictions on the event trigger. An explicit guard step is the reliable enforcement mechanism.

## Consequences

- **Positive**: Every publish is auditable through GitHub Actions run history — who triggered it, what package, what version, what tag.
- **Positive**: Safety checks prevent common mistakes (wrong branch, version mismatch, broken build).
- **Positive**: The `workflow_dispatch` UI on GitHub naturally surfaces the current branch, reminding the operator to be on `master`.
- **Negative**: Publishing requires opening GitHub (or using `gh workflow run`). Local `npm publish` is possible but not the recommended path.
- **Operational note**: To publish, the operator navigates to the Actions tab, selects "Publish to npm", chooses `master` as the branch, selects the package from the dropdown, and clicks "Run workflow". The version and dist-tag are auto-derived from `package.json`. The `NPM_TOKEN` secret must be configured in the repository settings.

## Alternatives Considered

1. **Per-package version tags** (`awx/v0.7.0`, `github/v0.1.0`, `gitlab/v0.0.1`) — Each publish triggers a git tag scoped to the package name. This makes `git tag` self-documenting (you can see every published version of every package) and enables `npm version` integration. **Rejected**: Tag proliferation is messy for human workflow — tags interleave across packages and require discipline to create consistently. The audit trail from GitHub Actions run history is sufficient and less noisy.

2. **CI-triggered publish on merge to master** — Detect which package changed in the merged PR, auto-increment the version, and publish. **Rejected**: Too many edge cases (what if multiple packages change? what about major/minor/patch selection? what if the merge was experimental?). Human judgment is required for versioning and tag selection.

3. **`npm publish --workspaces` (publish all)** — Run `npm publish` across every workspace in one shot. **Rejected**: Packages are independently versioned and should be published independently. Publishing all at once couples releases that have no reason to be coupled.

4. **Local `npm publish` only** — No CI workflow; the operator runs `npm publish` from their machine. **Rejected**: No safety checks, no branch enforcement, no audit trail. This was the ad-hoc pre-ADR state and exactly what this convention replaces.
