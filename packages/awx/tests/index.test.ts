/**
 * Plugin Index Tests
 *
 * Validates the AWX plugin entry point: lazy client resolution,
 * cached client reuse, dispose hook, and tool registrations.
 *
 * Follows the same patterns as tests/plugin.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import awxPluginModule from "../src/index.js";
import * as clientModule from "../src/client.js";

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

/** Minimal mock of PluginInput with configurable getSecret */
function mockPluginInput(overrides?: Partial<PluginInput>): PluginInput {
  const mockLog = vi.fn();
  const mockGetSecret = vi.fn().mockResolvedValue(null);
  return {
    client: {
      app: { log: mockLog },
      getSecret: mockGetSecret,
    } as unknown as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/mock/dir",
    worktree: "/mock/worktree",
    experimental_workspace: {
      register: vi.fn(),
    },
    serverUrl: new URL("http://localhost:0"),
    $: {} as PluginInput["$"],
    ...overrides,
  };
}

/**
 * Call server() with optional AwxPluginOptions.
 * Uses a cast because PluginModule.server is typed with only one parameter,
 * but the actual implementation accepts a second options parameter.
 */
async function createHooks(
  input: PluginInput,
  options?: { baseUrl?: string },
): Promise<Hooks> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serverFn = awxPluginModule.server as (input: PluginInput, options?: any) => Promise<Hooks>;
  return serverFn(input, options);
}

describe("AWX Plugin Index", () => {
  /* ── Clean up after each test ─────────────────────────────────── */
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  /* ══════════════════════════════════════════════════════════════════
     Tool Registrations
     ══════════════════════════════════════════════════════════════════ */

  describe("tool registrations", () => {
    it("hooks.tool contains hello tool", async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!.hello).toBeDefined();
      expect(typeof hooks.tool!.hello!.description).toBe("string");
    });

    it("hooks.tool contains listTemplates tool", async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!.listTemplates).toBeDefined();
      expect(typeof hooks.tool!.listTemplates!.description).toBe("string");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Dispose Hook
     ══════════════════════════════════════════════════════════════════ */

  describe("hooks.dispose", () => {
    it("exists and is a function", async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.dispose).toBeDefined();
      expect(typeof hooks.dispose).toBe("function");
    });

    it("can be called without throwing", async () => {
      const hooks = await createHooks(mockPluginInput());

      await expect(hooks.dispose!()).resolves.toBeUndefined();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Lazy Client Resolution — getAwxClient() via listTemplates tool
     ══════════════════════════════════════════════════════════════════ */

  describe("lazy client resolution (via listTemplates)", () => {
    it("returns undefined when no baseUrl configured", async () => {
      const input = mockPluginInput();
      const hooks = await createHooks(input);

      const result = await hooks.tool!.listTemplates!.execute(
        {},
        mockToolContext(),
      );

      expect(result).toContain("AWX client not available");
    });

    it("returns undefined when no token stored (getSecret returns null)", async () => {
      const input = mockPluginInput();
      // getSecret already returns null by default in mockPluginInput
      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!.listTemplates!.execute(
        {},
        mockToolContext(),
      );

      expect(result).toContain("AWX client not available");
    });

    it("returns AwxClient when token and baseUrl are set", async () => {
      // getSecret returns a token string
      (mockPluginInput().client as any).getSecret = vi
        .fn()
        .mockResolvedValue("my-test-token");

      const input = mockPluginInput();
      (input.client as any).getSecret = vi
        .fn()
        .mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!.listTemplates!.execute(
        {},
        mockToolContext(),
      );

      // When getAwxClient returns a client, listTemplates returns the stub
      // (not the "client not available" message)
      expect(result).toContain("AWX integration not yet implemented");
      expect(result).not.toContain("AWX client not available");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Cached Client Reuse
     ══════════════════════════════════════════════════════════════════ */

  describe("cached client reuse", () => {
    it("reuses the same AwxClient when token is unchanged", async () => {
      const createClientSpy = vi.spyOn(clientModule, "createClient");

      const input = mockPluginInput();
      (input.client as any).getSecret = vi
        .fn()
        .mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      // First call — should create a new client
      await hooks.tool!.listTemplates!.execute({}, mockToolContext());
      expect(createClientSpy).toHaveBeenCalledTimes(1);

      // Second call with same token — should reuse cached client
      await hooks.tool!.listTemplates!.execute({}, mockToolContext());
      expect(createClientSpy).toHaveBeenCalledTimes(1); // still 1, not 2

      createClientSpy.mockRestore();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Module Export Contract
     ══════════════════════════════════════════════════════════════════ */

  describe("module export", () => {
    it("exports a valid PluginModule with id and server function", () => {
      expect(awxPluginModule.id).toBe("awx");
      expect(awxPluginModule.server).toBeDefined();
      expect(typeof awxPluginModule.server).toBe("function");
    });
  });
});
