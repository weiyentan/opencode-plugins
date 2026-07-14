/**
 * Hello Tool Tests — GitLab Plugin
 *
 * Basic verification that the plugin entry point loads and the hello tool
 * registers and executes correctly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { GitLabPlugin } from "../src/index.js";
import { getCustomConfig, setCustomConfig } from "../src/runtime-config.js";

/** Minimal mock of ToolContext */
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

/** Minimal mock of PluginInput */
function mockPluginInput(overrides?: Partial<PluginInput>): PluginInput {
  return {
    client: {
      app: { log: vi.fn() },
    } as unknown as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/mock/dir",
    worktree: "/mock/worktree",
    serverUrl: new URL("http://localhost:0"),
    $: {} as PluginInput["$"],
    ...overrides,
  };
}

describe("GitLab Plugin — entry point", () => {
  it("exports a valid Plugin function", () => {
    expect(GitLabPlugin).toBeDefined();
    expect(typeof GitLabPlugin).toBe("function");
  });

  it("creates hooks with a hello tool", async () => {
    const hooks = await GitLabPlugin(mockPluginInput());
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!.hello).toBeDefined();
    expect(typeof hooks.tool!.hello!.description).toBe("string");
  });

  it("creates hooks with auth configuration", async () => {
    const hooks = await GitLabPlugin(mockPluginInput());
    expect(hooks.auth).toBeDefined();
  });

  it("creates hooks with gitlab_configure tool", async () => {
    const hooks = await GitLabPlugin(mockPluginInput());
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["gitlab_configure"]).toBeDefined();
  });

  it("hello tool responds with greeting", async () => {
    const hooks: Hooks = await GitLabPlugin(mockPluginInput());
    const hello = hooks.tool!.hello!;
    const result = await hello.execute({}, mockToolContext());

    expect(result).toEqual({ output: "Hello, world! 👋" });
  });

  it("hello tool responds with custom name", async () => {
    const hooks: Hooks = await GitLabPlugin(mockPluginInput());
    const hello = hooks.tool!.hello!;
    const result = await hello.execute({ name: "GitLab" }, mockToolContext());

    expect(result).toEqual({ output: "Hello, GitLab! 👋" });
  });

  it("hello tool respects abort signal", async () => {
    const hooks: Hooks = await GitLabPlugin(mockPluginInput());
    const hello = hooks.tool!.hello!;
    const controller = new AbortController();
    controller.abort();

    const result = await hello.execute(
      {},
      mockToolContext({ abort: controller.signal }),
    );

    expect(result).toEqual({ output: "Request was aborted." });
  });

  it("export surface includes GitLabPlugin and default only", async () => {
    const importedModule = await import("../src/index.js");
    const keys = Object.keys(importedModule).sort();
    expect(keys).toEqual(["GitLabPlugin", "default"].sort());
  });
});

describe("GitLab Plugin — custom config (Tier 1 auth fallback)", () => {
  beforeEach(() => {
    setCustomConfig({});
  });

  it("getCustomConfig returns undefined by default", () => {
    setCustomConfig({});
    const config = getCustomConfig();
    expect(config).toBeDefined();
    expect(config!.token).toBeUndefined();
  });

  it("setCustomConfig stores and retrieves token", () => {
    setCustomConfig({ token: "glpat-test" });
    const config = getCustomConfig();
    expect(config!.token).toBe("glpat-test");
  });

  it("setCustomConfig overwrites previous config", () => {
    setCustomConfig({ token: "glpat-first" });
    setCustomConfig({ token: "glpat-second" });
    expect(getCustomConfig()!.token).toBe("glpat-second");
  });
});

describe("GitLab Plugin — gitlab_configure tool", () => {
  it("sets token via gitlab_configure tool", async () => {
    const hooks = await GitLabPlugin(mockPluginInput());
    const configureTool = hooks.tool!["gitlab_configure"]!;

    const result = await configureTool.execute(
      { token: "glpat-configured" },
      mockToolContext(),
    );

    expect(result.output).toContain("GitLab plugin configured");
    expect(getCustomConfig()!.token).toBe("glpat-configured");
  });

  it("gitlab_configure respects abort", async () => {
    const hooks = await GitLabPlugin(mockPluginInput());
    const configureTool = hooks.tool!["gitlab_configure"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await configureTool.execute(
      { token: "glpat-aborted" },
      mockToolContext({ abort: controller.signal }),
    );

    expect(result.output).toBe("Request was aborted.");
  });
});
