/**
 * Phase 0: Repository Scaffolding — Placeholder tests
 *
 * Verifies that the AWX plugin package compiles, the plugin function
 * produces a valid hook shape, and the hello-world tool is registered.
 */
import { describe, it, expect, vi } from "vitest";
import type { PluginInput, Hooks, PluginModule } from "@opencode-ai/plugin";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin";

// This import will fail (RED) until src/index.ts is created
// with a default PluginModule export.
import awxPluginModule from "../src/index.js";

/** Minimal mock of PluginInput for scaffold tests */
function mockPluginInput(overrides?: Partial<PluginInput>): PluginInput {
  return {
    client: {} as ReturnType<typeof vi.fn>,
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

describe("AWX Plugin Scaffolding", () => {
  it("exports a valid PluginModule with an id and server function", () => {
    // Verify the default export matches the PluginModule contract
    const mod = awxPluginModule as PluginModule;

    expect(mod).toBeDefined();
    expect(mod.id).toBe("awx");
    expect(mod.server).toBeDefined();
    expect(typeof mod.server).toBe("function");
  });

  it("server() returns a Hooks object with auth hook", async () => {
    const hooks: Hooks = await awxPluginModule.server(mockPluginInput());

    expect(hooks).toBeDefined();
    expect(hooks.auth).toBeDefined();
    expect(hooks.auth!.provider).toBe("awx");
    expect(hooks.auth!.methods).toHaveLength(1);
    expect(hooks.auth!.methods[0]!.type).toBe("api");
  });


  it("server() returns a Hooks object with a hello-world tool", async () => {
    const hooks: Hooks = await awxPluginModule.server(mockPluginInput());

    // The hooks must contain a `tool` map
    expect(hooks).toBeDefined();
    expect(hooks.tool).toBeDefined();
    expect(typeof hooks.tool).toBe("object");

    // The hello-world tool must be registered
    const hello = hooks.tool?.hello;
    expect(hello).toBeDefined();
    expect(hello!.description).toBeDefined();
    expect(typeof hello!.description).toBe("string");
  });

  it("hello-world tool execute returns a greeting with default name", async () => {
    const hooks = await awxPluginModule.server(mockPluginInput());
    const tool = hooks.tool!.hello!;

    const result: ToolResult = await tool.execute(
      {},
      mockToolContext(),
    );

    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result).toContain("world");
  });

  it("hello-world tool accepts a custom name", async () => {
    const hooks = await awxPluginModule.server(mockPluginInput());
    const tool = hooks.tool!.hello!;

    const result = await tool.execute(
      { name: "OpenCode" },
      mockToolContext(),
    );

    expect(result).toContain("OpenCode");
  });

  it("hello-world tool returns abort message when signal is aborted", async () => {
    const hooks = await awxPluginModule.server(mockPluginInput());
    const tool = hooks.tool!.hello!;

    const aborted = new AbortController();
    aborted.abort(); // immediately abort

    const result = await tool.execute(
      {},
      mockToolContext({ abort: aborted.signal }),
    );

    expect(result).toContain("aborted");
  });
});
