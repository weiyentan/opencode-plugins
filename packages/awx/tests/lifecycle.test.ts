/**
 * Lazy Client/Auth Lifecycle Tests
 *
 * Verifies the no-token → token-set → client-created sequence works
 * without requiring a plugin reload. This tests the auth → client
 * creation → tool execution pathway end-to-end.
 *
 * The `getAwxClient()` function inside the plugin reads the current
 * stored AWX token at tool execution time (not at plugin init time)
 * and creates the client lazily. When no token is available, tools
 * report that the client is unavailable. When a token becomes
 * available, the same plugin instance can create and use the client
 * without any plugin reload.
 *
 * ## Test Strategy
 *
 * - Use a controlled mock for the OpencodeClient's `getSecret` method.
 * - Start with `getSecret` returning `undefined` (no token stored).
 * - Create the plugin server with a `baseUrl` so that the lazy client
 *   path is exercised.
 * - Call a tool that relies on `getAwxClient()` → expects "not available".
 * - Change the mock to return a valid PAT token.
 * - Call the same tool again → expects client to be created and used.
 */
import { describe, it, expect, vi } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import awxPluginModule from "../src/index.js";

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

/**
 * Create a minimal PluginInput stub with a controllable getSecret mock.
 *
 * Only `getSecret` is provided on the client — the init-time validation
 * code path is not triggered because `getSecret` initially returns
 * `undefined` (no token stored at init time). The `app.log` calls
 * inside the init-validation catch blocks are therefore never reached.
 */
function createPluginInput(
  getSecretMock: (key: string) => Promise<string | undefined>,
): PluginInput {
  return {
    client: {
      getSecret: getSecretMock,
      app: { log: vi.fn() },
    } as PluginInput["client"],
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
    const getSecretMock = vi.fn<(key: string) => Promise<string | undefined>>();
    getSecretMock.mockResolvedValue(undefined);

    const hooks: Hooks = await awxPluginModule.server(
      createPluginInput(getSecretMock),
      { baseUrl: "https://aap.tanscloud-internal.com" },
    );
    try {
      const listTemplates = hooks.tool!.listTemplates!;

      // ── Step 2: Without a token, listTemplates reports "not available" ──
      const resultNoToken = await listTemplates.execute({}, mockToolContext());
      expect(resultNoToken).toContain("not available");
      expect(resultNoToken).toContain("AWX client");

      // ── Step 3: Token becomes available (no plugin reload) ──────────
      getSecretMock.mockResolvedValue("my-pat-token");

      // ── Step 4: Same plugin instance now creates the client ───────────
      const resultWithToken = await listTemplates.execute({}, mockToolContext());
      expect(resultWithToken).toContain("AWX integration not yet implemented");
      // Must NOT still report "not available"
      expect(resultWithToken).not.toContain("not available");
    } finally {
      await hooks.dispose?.();
    }
  });
});
