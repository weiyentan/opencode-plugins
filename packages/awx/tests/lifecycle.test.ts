/**
 * Lazy Client/Auth Lifecycle Tests
 *
 * Verifies the no-token → token-set → client-created sequence works
 * without requiring a plugin reload. This tests the auth → client
 * creation → tool execution pathway end-to-end.
 *
 * The `getAwxClient()` function inside the plugin reads the current
 * stored AWX token at tool execution time (not at plugin init time)
 * via `getAwxToken()` and creates the client lazily. When no token is
 * available, tools report that the client is unavailable. When a token
 * becomes available, the same plugin instance can create and use the
 * client without any plugin reload.
 *
 * ## Test Strategy
 *
 * - Start with `_awxToken` unset (undefined) — no token available.
 * - Create the plugin server with a `baseUrl` so that the lazy client
 *   path is exercised.
 * - Call a tool that relies on `getAwxClient()` → expects "not available".
 * - Set the token via `__setAwxToken()` (simulating the auth hook loader
 *   having fired).
 * - Call the same tool again → expects client to be created and used.
 */
import { describe, it, expect, vi } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import awxPluginModule from "../src/index.js";
import { __setAwxToken } from "../src/auth.js";

/** Minimal mock of ToolContext for tool execute tests */
function mockToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory: "/mock/dir",
    worktree: "/mock/worktree",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Minimal PluginInput stub — no getSecret needed (token flows via AuthHook loader) */
function createPluginInput(): PluginInput {
  return {
    client: {
      app: { log: vi.fn() },
    } as unknown as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/mock/dir",
    worktree: "/mock/worktree",
    experimental_workspace: {
      register: vi.fn(),
    },
    serverUrl: new URL("http://localhost:0"),
    $: {} as PluginInput["$"],
  };
}

describe("AWX Plugin — Lazy Client/Auth Lifecycle", () => {
  it("creates client lazily when token becomes available without plugin reload", async () => {
    // ── Step 1: Start with no AWX token available ──────────────
    __setAwxToken(undefined);

    const hooks: Hooks = await awxPluginModule.server(
      createPluginInput(),
      { baseUrl: "https://example.com" },
    );
    try {
      const awxListTemplates = hooks.tool!["awx-list-templates"]!;

      // ── Step 2: Without a token, awxListTemplates reports "not available" ──
      const resultNoToken = await awxListTemplates.execute({}, mockToolContext());
      const outNoToken = (resultNoToken as { output: string }).output;
      expect(outNoToken).toContain("not available");
      expect(outNoToken).toContain("AWX client");

      // ── Step 3: Token becomes available (no plugin reload) ──────────
      __setAwxToken("my-pat-token");

      // ── Step 4: Same plugin instance now creates and uses the client ──────
      const resultWithToken = await awxListTemplates.execute({}, mockToolContext());
      const outWithToken = (resultWithToken as { output: string }).output;
      // The tool will try to make an HTTP request and fail (no fetch mock),
      // but should return a JSON structure, not stub text.
      expect(outWithToken).toContain("Failed to fetch");
      // Must NOT still report "not available"
      expect(outWithToken).not.toContain("not available");
    } finally {
      await hooks.dispose?.();
    }
  });
});
