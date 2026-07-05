/**
 * Attach Credential Tool Tests
 *
 * Validates the attachCredential thin-proxy behavior and the
 * awx-attach-credential tool registration and execution.
 *
 * 14 tests covering:
 *   - Thin proxy function (attachCredential): success, error paths, abort, edge cases
 *   - Registered tool (awx-attach-credential): registration, success, error, abort
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { attachCredential } from "../src/attach-credential.js";
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
// attachCredential — Thin proxy function
// ============================================================================

describe("attachCredential", () => {
  it("sends POST to /api/v2/job_templates/{id}/credentials/ with credential_id", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 42, name: "My Credential" })),
    } as Response);

    await attachCredential(client, 10, 42);

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 42 }),
      },
      undefined,
    );
  });

  it("returns raw AWX response body on success", async () => {
    const client = mockClient();
    const awxResponse = {
      id: 42,
      name: "My Credential",
      credential_type: 1,
      organization: 2,
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify(awxResponse)),
    } as Response);

    const result = await attachCredential(client, 10, 42);

    expect(result).toEqual(awxResponse);
  });

  it("throws clear error on HTTP error with detail message", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () => Promise.resolve(JSON.stringify({ detail: "Invalid credential ID." })),
    } as Response);

    await expect(
      attachCredential(client, 10, 99999),
    ).rejects.toThrow("Invalid credential ID.");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP error using statusText when body has no detail", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    } as Response);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow("AWX attach credential failed: HTTP 500: Internal Server Error");

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
      attachCredential(client, 10, 42),
    ).rejects.toThrow("AWX attach credential failed: HTTP 502: <html>Bad Gateway</html>");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws on network error (fetch fails)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connect ECONNREFUSED example.com:443"),
    );

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow("connect ECONNREFUSED");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 42 })),
    } as Response);

    const controller = new AbortController();
    await attachCredential(client, 10, 42, controller.signal);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      controller.signal,
    );
  });

  it("returns empty object when AWX response body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await attachCredential(client, 10, 42);

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("handles non-JSON success response gracefully", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 204,
      statusText: "No Content",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await attachCredential(client, 10, 42);

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// awx-attach-credential — Registered tool
// ============================================================================

describe('"awx-attach-credential" tool', () => {
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

  it('is registered as "awx-attach-credential" in hooks.tool', async () => {
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-attach-credential"]).toBeDefined();
    expect(typeof hooks.tool!["awx-attach-credential"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════════
     Successful Execution
     ══════════════════════════════════════════════════════════════════ */

  it("returns success output and metadata when credential is attached", async () => {
    const mockResponse = { id: 42, name: "My Credential", credential_type: 1 };
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

    const result = await hooks.tool!["awx-attach-credential"]!.execute(
      { job_template_id: 10, credential_id: 42 },
      mockToolContext(),
    );

    const wrapped = result as { output: string; metadata: Record<string, unknown> };
    expect(wrapped.output).toContain("Credential 42 attached to template 10");
    expect(wrapped.metadata).toEqual(mockResponse);
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling — API Error
     ══════════════════════════════════════════════════════════════════ */

  it("returns error output when API returns an error", async () => {
    (mockAwxClient.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Credential not found." }), {
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

    const result = await hooks.tool!["awx-attach-credential"]!.execute(
      { job_template_id: 10, credential_id: 99999 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("awx-attach-credential error");
    expect((result as { output: string }).output).toContain("Credential not found");
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

    const result = await hooks.tool!["awx-attach-credential"]!.execute(
      { job_template_id: 10, credential_id: 42 },
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

    const result = await hooks.tool!["awx-attach-credential"]!.execute(
      { job_template_id: 10, credential_id: 42 },
      mockToolContext({ abort: controller.signal }),
    );

    expect((result as { output: string }).output).toBe("Request was aborted.");
  });
});
