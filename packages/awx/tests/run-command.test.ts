/**
 * Run Command Tool Tests
 *
 * Validates the runCommand thin-proxy behavior and the
 * awx-run-command tool registration and execution.
 *
 * Covers:
 *   - Thin proxy function (runCommand): request body construction, abort signal,
 *     error responses (400/401/404/500), successful response parsing
 *   - Registered tool (awx-run-command): registration, success, error, abort
 *   - Integration tests (env-guarded) against real AWX
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { runCommand } from "../src/run-command.js";
import { AwxPlugin } from "../src/index.js";
import * as clientModule from "../src/client.js";
import type { AwxClient } from "../src/client.js";

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal mock AWX client for thin-proxy tests */
function mockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

/**
 * Create a mock Response object for a successful ad-hoc command launch.
 */
function mockOkResponse(body: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 201,
    statusText: "Created",
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

/**
 * Create a mock Response object for a failed ad-hoc command launch.
 */
function mockErrorResponse(
  status: number,
  statusText: string,
  detail: string,
): Response {
  return {
    ok: false,
    status,
    statusText,
    text: () => Promise.resolve(JSON.stringify({ detail })),
  } as Response;
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
    serverUrl: new URL("http://localhost:0"),
    $: {} as PluginInput["$"],
    ...overrides,
  };
}

/**
 * Create hooks by calling AwxPlugin() directly.
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

// ============================================================================
// runCommand — Thin proxy function
// ============================================================================

describe("runCommand", () => {
  it("sends POST to /api/v2/ad_hoc_commands/ with required fields", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 42, status: "new" }),
    );

    await runCommand(client, 10, 20, "ping");

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-run-command",
      "/api/v2/ad_hoc_commands/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory: 10,
          credential: 20,
          module_name: "ping",
        }),
      },
      undefined,
    );
  });

  it("includes module_args when provided", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 43, status: "new" }),
    );

    await runCommand(client, 10, 20, "command", "uptime");

    expect(client.request).toHaveBeenCalledTimes(1);
    const callBody = JSON.parse(
      (client.request as ReturnType<typeof vi.fn>).mock.calls[0][2].body,
    );
    expect(callBody).toHaveProperty("module_args", "uptime");
  });

  it("includes limit when provided", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 44, status: "new" }),
    );

    await runCommand(client, 10, 20, "ping", undefined, "webservers");

    expect(client.request).toHaveBeenCalledTimes(1);
    const callBody = JSON.parse(
      (client.request as ReturnType<typeof vi.fn>).mock.calls[0][2].body,
    );
    expect(callBody).toHaveProperty("limit", "webservers");
  });

  it("includes both module_args and limit when both provided", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 45, status: "new" }),
    );

    await runCommand(client, 10, 20, "shell", "ls -la", "*.example.com");

    expect(client.request).toHaveBeenCalledTimes(1);
    const callBody = JSON.parse(
      (client.request as ReturnType<typeof vi.fn>).mock.calls[0][2].body,
    );
    expect(callBody).toHaveProperty("module_args", "ls -la");
    expect(callBody).toHaveProperty("limit", "*.example.com");
  });

  it("omits module_args from request body when not provided", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 46, status: "new" }),
    );

    await runCommand(client, 10, 20, "ping");

    const callBody = JSON.parse(
      (client.request as ReturnType<typeof vi.fn>).mock.calls[0][2].body,
    );
    expect(callBody).not.toHaveProperty("module_args");
  });

  it("omits limit from request body when not provided", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 47, status: "new" }),
    );

    await runCommand(client, 10, 20, "ping");

    const callBody = JSON.parse(
      (client.request as ReturnType<typeof vi.fn>).mock.calls[0][2].body,
    );
    expect(callBody).not.toHaveProperty("limit");
  });

  it("returns raw AWX response body on success", async () => {
    const client = mockClient();
    const awxResponse = {
      id: 100,
      status: "new",
      inventory: 10,
      credential: 20,
      module_name: "ping",
      module_args: "",
      limit: "",
      created: "2024-01-01T00:00:00Z",
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse(awxResponse),
    );

    const result = await runCommand(client, 10, 20, "ping");

    expect(result).toEqual(awxResponse);
  });

  it("returns empty object when AWX response body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await runCommand(client, 10, 20, "ping");

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP 400 (bad request)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockErrorResponse(400, "Bad Request", "Invalid module name."),
    );

    await expect(
      runCommand(client, 10, 20, ""),
    ).rejects.toThrow("Invalid module name.");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP 401 (unauthorized)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockErrorResponse(401, "Unauthorized", "Invalid credentials."),
    );

    await expect(
      runCommand(client, 10, 20, "ping"),
    ).rejects.toThrow("Invalid credentials.");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP 404 (not found)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockErrorResponse(404, "Not Found", "Inventory not found."),
    );

    await expect(
      runCommand(client, 99999, 20, "ping"),
    ).rejects.toThrow("Inventory not found.");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP 500 (server error)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    } as Response);

    await expect(
      runCommand(client, 10, 20, "ping"),
    ).rejects.toThrow("AWX ad-hoc command failed: HTTP 500: Internal Server Error");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP error with non-JSON body", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.resolve("<html>Bad Gateway</html>"),
    } as Response);

    await expect(
      runCommand(client, 10, 20, "ping"),
    ).rejects.toThrow("AWX ad-hoc command failed: HTTP 502: <html>Bad Gateway</html>");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws on network error (fetch fails)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED example.com:443"),
    );

    await expect(
      runCommand(client, 10, 20, "ping"),
    ).rejects.toThrow("connect ECONNREFUSED");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 42, status: "new" }),
    );

    const controller = new AbortController();
    await runCommand(client, 10, 20, "ping", undefined, undefined, controller.signal);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      controller.signal,
    );
  });

  it("throws AbortError when request is aborted", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const controller = new AbortController();
    controller.abort();

    await expect(
      runCommand(client, 10, 20, "ping", undefined, undefined, controller.signal),
    ).rejects.toThrow("aborted");
  });
});

// ============================================================================
// awx-run-command — Registered tool
// ============================================================================

describe('"awx-run-command" tool', () => {
  let mockAwxClient: AwxClient;
  let createClientSpy: ReturnType<typeof vi.spyOn>;

  /* ── Setup: mock createClient to return a controllable client ── */
  beforeEach(() => {
    mockAwxClient = mockClient();
    createClientSpy = vi.spyOn(clientModule, "createClient").mockReturnValue(mockAwxClient);
  });

  afterEach(() => {
    createClientSpy.mockRestore();
    vi.restoreAllMocks();
  });

  /* ══════════════════════════════════════════════════════════════════
     Tool Registration
     ══════════════════════════════════════════════════════════════════ */

  it('is registered as "awx-run-command" in hooks.tool', async () => {
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-run-command"]).toBeDefined();
    expect(typeof hooks.tool!["awx-run-command"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════════
     Successful Execution
     ══════════════════════════════════════════════════════════════════ */

  it("returns success output and metadata when command is launched", async () => {
    const mockResponse = {
      id: 42,
      status: "new",
      inventory: 10,
      credential: 20,
      module_name: "ping",
      module_args: "",
      limit: "",
    };
    (mockAwxClient.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-run-command"]!.execute(
      {
        inventory_id: 10,
        credential_id: 20,
        module_name: "ping",
      },
      mockToolContext(),
    );

    const wrapped = result as { output: string; metadata: Record<string, unknown> };
    expect(wrapped.output).toContain("Ad-hoc command #42 launched.");
    expect(wrapped.output).toContain("Module: ping");
    expect(wrapped.output).toContain("Inventory: 10");
    expect(wrapped.metadata).toEqual(mockResponse);
  });

  it("includes module_args and limit in success output when provided", async () => {
    const mockResponse = {
      id: 43,
      status: "new",
      inventory: 10,
      credential: 20,
      module_name: "command",
      module_args: "uptime",
      limit: "webservers",
    };
    (mockAwxClient.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-run-command"]!.execute(
      {
        inventory_id: 10,
        credential_id: 20,
        module_name: "command",
        module_args: "uptime",
        limit: "webservers",
      },
      mockToolContext(),
    );

    const wrapped = result as { output: string; metadata: Record<string, unknown> };
    expect(wrapped.output).toContain("Ad-hoc command #43 launched.");
    expect(wrapped.metadata).toEqual(mockResponse);
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling — API Error
     ══════════════════════════════════════════════════════════════════ */

  it("returns error output when API returns an error", async () => {
    (mockAwxClient.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Inventory not found." }), {
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

    const result = await hooks.tool!["awx-run-command"]!.execute(
      {
        inventory_id: 99999,
        credential_id: 20,
        module_name: "ping",
      },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("awx-run-command error");
    expect((result as { output: string }).output).toContain("Inventory not found");
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling — Client Init Failure
     ══════════════════════════════════════════════════════════════════ */

  it("returns error when AWX client cannot be initialized", async () => {
    // When getSecret returns null and no env var is set, client init fails
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue(null);
    vi.stubEnv("AWX_TOKEN", "");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-run-command"]!.execute(
      {
        inventory_id: 10,
        credential_id: 20,
        module_name: "ping",
      },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("Personal Access Token");
  });

  /* ══════════════════════════════════════════════════════════════════
     Abort Signal Handling
     ══════════════════════════════════════════════════════════════════ */

  it("respects abort signal before execution", async () => {
    const controller = new AbortController();
    controller.abort();

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-run-command"]!.execute(
      {
        inventory_id: 10,
        credential_id: 20,
        module_name: "ping",
      },
      mockToolContext({ abort: controller.signal }),
    );

    expect((result as { output: string }).output).toBe("Request was aborted.");
  });

  it("handles abort during API call gracefully", async () => {
    (mockAwxClient.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-run-command"]!.execute(
      {
        inventory_id: 10,
        credential_id: 20,
        module_name: "ping",
      },
      mockToolContext({ abort: new AbortController().signal }),
    );

    expect((result as { output: string }).output).toBe("Request was aborted.");
  });
});

// ══════════════════════════════════════════════════════════════════
// Integration Tests — run against real AWX (env-guarded)
// ══════════════════════════════════════════════════════════════════
//
// Run with: AWX_INTEGRATION_TEST=1 npm test -- run-command
//
// Requires:
//   AWX_INTEGRATION_TEST=1         — must be set to run
//   AWX_BASE_URL                   — full AWX URL (e.g. https://aap.example.com)
//   AWX_TOKEN                      — AWX Personal Access Token (PAT)
//   AWX_TEST_INVENTORY_ID          — ID of a real AWX inventory
//   AWX_TEST_CREDENTIAL_ID         — ID of a real machine credential
//   AWX_TEST_HOST_LIMIT            — (optional) host limit pattern

const integrationTest = process.env.AWX_INTEGRATION_TEST ? it : it.skip;

describe("awx-run-command integration", () => {
  integrationTest(
    "launches an ad-hoc ping command against a real AWX instance",
    async () => {
      const baseUrl = process.env.AWX_BASE_URL;
      const token = process.env.AWX_TOKEN;
      const inventoryId = process.env.AWX_TEST_INVENTORY_ID;
      const credentialId = process.env.AWX_TEST_CREDENTIAL_ID;
      const hostLimit = process.env.AWX_TEST_HOST_LIMIT;

      if (!baseUrl || !token) {
        throw new Error(
          "AWX_BASE_URL and AWX_TOKEN environment variables must be set for integration tests",
        );
      }
      if (!inventoryId || !credentialId) {
        throw new Error(
          "AWX_TEST_INVENTORY_ID and AWX_TEST_CREDENTIAL_ID must be set",
        );
      }

      // Import createClient directly (bypass the tool layer)
      const { createClient } = await import("../src/client.js");
      const client = createClient({ baseUrl, token });

      // Launch a safe ad-hoc ping command
      const result = await runCommand(
        client,
        Number(inventoryId),
        Number(credentialId),
        "ping",
        undefined,
        hostLimit || undefined,
      );

      // Verify the response shape
      expect(result).toBeDefined();
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("module_name", "ping");
      expect(result).toHaveProperty("inventory", Number(inventoryId));
      expect(result).toHaveProperty("credential", Number(credentialId));
    },
    30000, // 30 second timeout for real network calls
  );

  integrationTest(
    "returns error for invalid inventory ID",
    async () => {
      const baseUrl = process.env.AWX_BASE_URL;
      const token = process.env.AWX_TOKEN;

      if (!baseUrl || !token) {
        throw new Error(
          "AWX_BASE_URL and AWX_TOKEN environment variables must be set for integration tests",
        );
      }

      const { createClient } = await import("../src/client.js");
      const client = createClient({ baseUrl, token });

      // Try launching with a non-existent inventory ID
      await expect(
        runCommand(client, 999999, 1, "ping"),
      ).rejects.toThrow();
    },
    30000,
  );
});
