# ADR 0003: Plugin API Surface Discovery

**Status:** Accepted  
**Date:** 2026-06-20  
**Council Session:** `awx-plugin-prd-20260620-135410`

## Context

The PRD referenced `@opencode-ai/plugin` as a peer dependency but neither the TypeScript types nor the auth hook interface documentation were present in the plugin repository. This was a blocking dependency: implementation could not start without knowing the tool registration interface, the auth hook contract, and the plugin entry point signature.

## Decision

**Adopt the discovered `@opencode-ai/plugin` v1.14.29 API surface** as documented in the local installation at `C:\ai\opencode\node_modules\@opencode-ai\plugin`.

## Discovered API Surface

### Plugin Entry Point
```typescript
// Package: @opencode-ai/plugin (exports: ".", "./tool", "./tui")
import type { Plugin, PluginInput, PluginOptions, Hooks } from "@opencode-ai/plugin";

export default {
  server: async (ctx: PluginInput, options?: PluginOptions): Promise<Hooks> => {
    // ctx: { client, project, directory, worktree, serverUrl, $: BunShell }
    return {
      auth: { ... },
      tool: { ... },
    };
  },
};
```

### Tool Registration (`@opencode-ai/plugin/tool`)
```typescript
import { tool } from "@opencode-ai/plugin/tool";

const myTool = tool({
  description: "...",
  args: {
    foo: tool.schema.string().describe("foo"),
  },
  async execute(args, context: ToolContext): Promise<ToolResult> {
    // context: { sessionID, messageID, agent, directory, worktree, abort: AbortSignal }
    return { output: "...", metadata: { ... } };
  },
});
```

### Auth Hook (`type: "api"`)
```typescript
auth: {
  provider: "awx",
  methods: [{
    type: "api",
    label: "AWX Bearer Token",
    prompts: [{
      type: "text",
      key: "token",
      message: "Enter your AWX Personal Access Token",
    }],
    async authorize(inputs) {
      return { type: "success", key: inputs.token };
    },
  }],
},
```

## Consequences

- The `auth.ts` module follows the `type: "api"` pattern with a single `token` prompt.
- Tools are registered via the `tool()` function in the `tool` hook of the `Hooks` interface.
- `ToolContext.abort` provides native timeout/abort signal — no custom timeout wrapping needed.
- The `@opencode-ai/plugin` package must be added as a dependency in `packages/awx/package.json`.
- Dependencies include `zod` (for tool arg schemas) and `effect` (from the SDK peer dependency).

## Alternatives Considered

1. **No plugin API exists** — The package might not exist. Rejected: verified at v1.14.29 on npm and installed locally.
2. **Different auth type** — `type: "oauth"` instead of `type: "api"`. Rejected: `type: "api"` is the correct fit for bearer token storage; OAuth is for interactive flows.
