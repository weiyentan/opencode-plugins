/**
 * Sync Project Tool Tests
 *
 * Validates the awx-sync-project tool:
 * - Registration in the hooks.tool map
 * - Successful sync trigger: mocks client request, verifies output shape
 * - Error handling: project not found (404), not authorized (401/403)
 *
 * Follows the same patterns as tests/index.test.ts.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";
import * as clientModule from "../src/client.js";
import type { AwxClient } from "../src/client.js";

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
  return {
    client: {
      app: { log: vi.fn() },
      getSecret: vi.fn().mockResolvedValue(null),
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
 * Create hooks by calling AwxPlugin() directly.
 * When baseUrl is provided, it sets process.env.AWX_BASE_URL via vi.stubEnv.
 */
async function createHooks(
  input: PluginInput,
  options?: { baseUrl?: string },
): Promise<Hooks> {
  if (options?.baseUrl) {
    vi.stubEnv("AWX_BASE_URL", options.baseUrl);
  }
  return AwxPlugin(input);
}

/** Create a mock AwxClient with a controllable request method */
function createMockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

describe('"awx-sync-project" tool', () => {
  let mockClient: AwxClient;
  let createClientSpy: ReturnType<typeof vi.spyOn>;

  /* ── Setup: mock createClient to return a controllable client ── */
  beforeEach(() => {
    mockClient = createMockClient();
    createClientSpy = vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);
  });

  afterEach(() => {
    createClientSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /* ══════════════════════════════════════════════════════════════════
     Tool Registration
     ══════════════════════════════════════════════════════════════════ */

  it('is registered as "awx-sync-project" in hooks.tool', async () => {
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-sync-project"]).toBeDefined();
    expect(typeof hooks.tool!["awx-sync-project"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════════
     Successful Sync Trigger
     ══════════════════════════════════════════════════════════════════ */

  it("triggers SCM sync and returns project_update_id, status, project_name", async () => {
    // Mock the project GET response
    const mockProjectResponse = {
      id: 123,
      name: "My Test Project",
      scm_type: "git",
      url: "/api/v2/projects/123/",
      last_updated: "2024-06-15T10:30:00Z",
    };

    // Mock the project update POST response
    const mockProjectUpdateResponse = {
      id: 456,
      status: "running",
      project: 123,
    };

    // Two calls: GET project first, then POST update
    (mockClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockProjectResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockProjectUpdateResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-sync-project"]!.execute(
      { project_id: 123 },
      mockToolContext(),
    );

    // Verify the result is a structured object
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");

    const wrapped = result as { output: string; metadata: Record<string, unknown> };
    expect(wrapped.output).toBeDefined();
    expect(typeof wrapped.output).toBe("string");
    expect(wrapped.output).toContain("SCM sync triggered");
    expect(wrapped.output).toContain("My Test Project");

    // Check structured data in metadata
    expect(wrapped.metadata).toBeDefined();
    const meta = wrapped.metadata;

    // Check contract fields from the issue description
    expect(meta.project_update_id).toBe(456);
    expect(meta.status).toBe("running");
    expect(meta.project_name).toBe("My Test Project");

    // Check additional contract fields from the acceptance criteria
    expect(meta.project_id).toBe(123);
    expect(meta.url).toBe("/api/v2/projects/123/");
    expect(meta.scm_type).toBe("git");
    expect(meta.last_updated).toBe("2024-06-15T10:30:00Z");
  });

  /* ══════════════════════════════════════════════════════════════════
     Client Request Made Correctly
     ══════════════════════════════════════════════════════════════════ */

  it("calls GET /api/v2/projects/123/ then POST /api/v2/projects/123/update/", async () => {
    (mockClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 123, name: "My Project", scm_type: "git", url: "/api/v2/projects/123/", last_updated: "2024-01-01" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 456, status: "running", project: 123 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    await hooks.tool!["awx-sync-project"]!.execute(
      { project_id: 123 },
      mockToolContext(),
    );

    // First call: GET /api/v2/projects/123/
    expect(mockClient.request).toHaveBeenNthCalledWith(
      1,
      "awx-sync-project",
      "/api/v2/projects/123/",
      expect.objectContaining({ method: "GET" }),
      expect.any(AbortSignal),
    );

    // Second call: POST /api/v2/projects/123/update/
    expect(mockClient.request).toHaveBeenNthCalledWith(
      2,
      "awx-sync-project",
      "/api/v2/projects/123/update/",
      expect.objectContaining({ method: "POST" }),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling — Project Not Found (404)
     ══════════════════════════════════════════════════════════════════ */

  it("returns clear error when project is not found (404)", async () => {
    (mockClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Not found." }), {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "application/json" },
        }),
      );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-sync-project"]!.execute(
      { project_id: 999 },
      mockToolContext(),
    );

    expect(result).toHaveProperty("output");
    expect(typeof (result as { output: string }).output).toBe("string");
    expect((result as { output: string }).output).toContain("not found");
    expect((result as { output: string }).output).toContain("999");
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling — Not Authorized (401)
     ══════════════════════════════════════════════════════════════════ */

  it("returns clear error when not authorized (401)", async () => {
    (mockClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Authentication credentials were not provided." }), {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        }),
      );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-sync-project"]!.execute(
      { project_id: 123 },
      mockToolContext(),
    );

    expect(result).toHaveProperty("output");
    expect(typeof (result as { output: string }).output).toBe("string");
    expect((result as { output: string }).output).toContain("Not authorized");
    expect((result as { output: string }).output).toContain("123");
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling — Forbidden (403)
     ══════════════════════════════════════════════════════════════════ */

  it("returns clear error when forbidden (403)", async () => {
    (mockClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "You do not have permission to perform this action." }), {
          status: 403,
          statusText: "Forbidden",
          headers: { "Content-Type": "application/json" },
        }),
      );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-sync-project"]!.execute(
      { project_id: 123 },
      mockToolContext(),
    );

    expect(result).toHaveProperty("output");
    expect(typeof (result as { output: string }).output).toBe("string");
    expect((result as { output: string }).output).toContain("Not authorized");
    expect((result as { output: string }).output).toContain("123");
  });
});
