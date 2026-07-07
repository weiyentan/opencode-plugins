/**
 * Hello Tool Unit Tests
 *
 * Tests for the hello-world tool: registration, default greeting,
 * custom name, abort signal handling, and serverUrl reflected in
 * description.
 *
 * Follows the same patterns as tests/plugin.test.ts and tests/index.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../../src/index.js";

/** Minimal mock of PluginInput with configurable overrides */
function mockPluginInput(overrides?: Partial<PluginInput>): PluginInput {
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
    ...overrides,
  };
}

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
 * Create hooks by calling AwxPlugin().
 * Stubs AWX_BASE_URL and AWX_TOKEN env vars so tests don't
 * accidentally pick up real credentials.
 */
async function createHooks(
  input: PluginInput,
  options?: { baseUrl?: string },
): Promise<Hooks> {
  if (options?.baseUrl) {
    vi.stubEnv("AWX_BASE_URL", options.baseUrl);
  } else {
    vi.stubEnv("AWX_BASE_URL", undefined);
  }
  vi.stubEnv("AWX_TOKEN", undefined);
  return AwxPlugin(input);
}

describe("hello tool", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Tool registration
     ══════════════════════════════════════════════════════════════ */

  it("hooks.tool.hello is defined with a description string", async () => {
    const hooks = await createHooks(mockPluginInput());
    try {
      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!.hello).toBeDefined();
      expect(typeof hooks.tool!.hello!.description).toBe("string");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Default greeting
     ══════════════════════════════════════════════════════════════ */

  it("executing with no args returns greeting containing 'world'", async () => {
    const hooks = await createHooks(mockPluginInput());
    try {
      const tool = hooks.tool!.hello!;
      const result = await tool.execute({}, mockToolContext());
      const out = (result as { output: string }).output;
      expect(out).toContain("world");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Custom name
     ══════════════════════════════════════════════════════════════ */

  it("executing with { name: 'OpenCode' } returns greeting containing 'OpenCode'", async () => {
    const hooks = await createHooks(mockPluginInput());
    try {
      const tool = hooks.tool!.hello!;
      const result = await tool.execute(
        { name: "OpenCode" },
        mockToolContext(),
      );
      const out = (result as { output: string }).output;
      expect(out).toContain("OpenCode");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Abort signal
     ══════════════════════════════════════════════════════════════ */

  it("returns abort message when signal is already aborted", async () => {
    const hooks = await createHooks(mockPluginInput());
    try {
      const tool = hooks.tool!.hello!;

      const aborted = new AbortController();
      aborted.abort(); // immediately abort

      const result = await tool.execute(
        {},
        mockToolContext({ abort: aborted.signal }),
      );
      const out = (result as { output: string }).output;
      expect(out).toContain("aborted");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Logging context — serverUrl reflected in description
     ══════════════════════════════════════════════════════════════ */

  it("serverUrl from PluginInput is reflected in tool description", async () => {
    const testUrl = new URL("https://my-awx.example.com");
    const hooks = await createHooks(mockPluginInput({ serverUrl: testUrl }));
    try {
      const description = hooks.tool!.hello!.description;
      expect(description).toContain("my-awx.example.com");
    } finally {
      await hooks.dispose?.();
    }
  });
});
