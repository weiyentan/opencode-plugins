# ADR 0007: Plugin Entry Point Export Hygiene

**Status:** Accepted  
**Date:** 2026-06-25  

## Context

The plugin entry point (`src/index.ts`) is the module loaded by the OpenCode plugin server at runtime. The server iterates over the module's exports to discover plugin factories — anything that is not a valid `Plugin` function (i.e., not assignable to the `Plugin` type) causes the loader to crash.

Version 0.4.0 exported a module-private `setCustomConfig` function from `src/index.ts` alongside `AwxPlugin`. This non-plugin export triggered a loader crash on every OpenCode startup.

## Decision

**Only two exports are permitted from `src/index.ts`:**

```ts
export const AwxPlugin: Plugin = server;
export default AwxPlugin;
```

All other exports, configuration stores, and utility functions that are consumed internally MUST live in separate source modules (e.g., `src/config.ts`, `src/client.ts`, `src/auth.ts`), and MUST NOT be re-exported through `src/index.ts`.

If tests or external consumers need access to internal utilities, they must import from the specific sub-module, NOT from the entry point.

## Consequences

- `setCustomConfig` and `getCustomConfig` were extracted into `src/config.ts`, which `index.ts` imports internally without re-exporting.
- Test files that need `setCustomConfig` import it from `../src/config.js` directly.
- The npm package's `exports` field maps only `"."` to `"./dist/index.js"`, so the sub-module is unreachable via bare package imports — reinforcing the barrier.
- Future tool implementations, helper functions, and config stores must follow this pattern from the start.

## Alternatives Considered

1. **Export everything, let the server ignore non-Plugins** — Rejected: the OpenCode plugin server is a prebuilt binary whose source is not accessible; relying on undocumented runtime behavior is fragile.
2. **Barrel file with selective re-exports** — Rejected: still adds non-plugin exports to the entry module, risking the same crash.
3. **Lint rule to block non-Plugin exports** — Considered viable, but the simpler safeguard of physical separation (sub-modules) is more robust and easier to audit.
