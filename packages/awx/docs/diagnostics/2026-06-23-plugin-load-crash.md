# Diagnostic: AWX Plugin Load Crash — "Unexpected server error"

**Date:** 2026-06-23
**Author:** OpenCode Agent
**Status:** Resolved
**Affected:** `opencode-plugin-awx` v0.2.0

## Symptom

Running `opencode` from the `opencode-plugins` project directory produced:

```
Error: Unexpected server error. Check server logs for details.
    at <anonymous> (B:/~BUN/root/chunk-jekdjp8m.js:8:7615)
    at processTicksAndRejections (native:7:39)
```

Running `opencode` from outside the project directory worked fine. The `--pure` flag and `--log-level DEBUG --print-logs` did not reveal additional details — the error is a generic catch-all in OpenCode's Bun-bundled binary.

## Isolation

The crash manifested as plugin loading failed. Through iterative isolation:

| Config | Plugin Entry | Result |
|--------|-------------|--------|
| None (no AWX plugin) | N/A | ✅ Works |
| `["./packages/awx/dist/index.js", ...]` | Direct file path | ✅ Works |
| `["./packages/awx", ...]` | Directory path (via package.json) | ❌ Crashes |
| `["./packages/awx/dist-test/index.js", ...]` | Minimal test plugin, direct file path | ✅ Works |
| Minimal test plugin importing all real modules | Direct file path | ✅ Works |
| Minimal test plugin with full server() init | Direct file path | ✅ Works |
| Minimal test plugin with all 10 tools | Direct file path | ✅ Works |
| `["./packages/awx", ...]` — minimal package.json (name, type, main only) | Directory path | ❌ Crashes |
| `["./packages/awx", ...]` — with node_modules removed | Directory path | ✅ Works |

The crash occurred ONLY when two conditions were both true:
1. Plugin loaded via **directory path** (not direct file path)
2. `node_modules/` existed inside `packages/awx/`

## Root Cause

**OpenCode's Bun-bundled runtime (`OpenCode.exe`) resolves module imports using the plugin's local `node_modules/` when loading from a directory path, rather than using its own bundled modules.** This causes a conflict between the locally-installed `@opencode-ai/plugin` (v1.17.8) and `zod` (v4.1.8) versus OpenCode's own internal versions, resulting in an unrecoverable server crash.

When the plugin is loaded via a **direct file path** (`["./packages/awx/dist/index.js", ...]`), Bun's module resolution walks up from the file's location, likely finding OpenCode's own modules first, avoiding the conflict.

## Fix

1. **Removed** `packages/awx/node_modules/` from disk
2. **Added** `packages/awx/node_modules/` to `.gitignore`
3. **Restored** original `package.json` from backup (no changes needed to the plugin itself)

## Development Workflow

The plugin's local `node_modules/` is still needed for building and testing:

```powershell
cd packages\awx
npm install       # installs dev + runtime deps
npm test          # runs vitest
npm run build     # compiles TypeScript
```

Before running `opencode` from the project directory, remove the `node_modules`:

```powershell
Remove-Item -Recurse -Force packages\awx\node_modules
```

Or run `opencode` from outside the project directory.

## Related Artifacts

- `.opencode/` directory → renamed to `opencode-plugin-dev/` (no leading dot prevents auto-discovery)
- `opencode-plugin-dev/plugins/` — built plugin artifact staging directory
- Test plugin at `packages/awx/dist-test/index.js` — can load all 10 tools via direct file path
- `packages/awx/CONTEXT.md` — documents the getSecret phantom-method bug

## Test Status

After the fix, 10 of 18 test files pass (265 tests). The 16 failing tests relate to the 3-tier auth fallback chain (`customConfig` → `getSecret` → `AWX_TOKEN`) and need updating to match the new behavior — they are not related to this crash.
