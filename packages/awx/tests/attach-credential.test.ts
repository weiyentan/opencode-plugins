/**
 * Attach Credential Tool Tests
 *
 * Validates the attachCredential thin-proxy behavior and the
 * awx-attach-credential tool registration and execution.
 *
 * 25 tests covering:
 *   - Thin proxy function (attachCredential): single-credential and per-credential multi-POST success, error paths, abort, edge cases
 *   - Registered tool (awx-attach-credential): registration, single-credential and multi-credential success, error, abort
 *   - Integration tests (env-guarded) against real AWX
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

/**
 * Create a mock Response object for a successful credential attachment.
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
 * Create a mock Response object for a failed credential attachment.
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
// attachCredential — Thin proxy function
// ============================================================================

describe("attachCredential", () => {
  it("sends POST to /api/v2/job_templates/{id}/credentials/ with credential_id", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 42, name: "My Credential" }),
    );

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

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse(awxResponse),
    );

    const result = await attachCredential(client, 10, 42);

    expect(result).toEqual(awxResponse);
  });

  it("throws clear error on HTTP error with detail message", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockErrorResponse(400, "Bad Request", "Invalid credential ID."),
    );

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
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOkResponse({ id: 42 }),
    );

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

  // ── Multi-credential — per-credential individual POSTs ──────────

  it("makes 3 individual POSTs (one per credential ID)", async () => {
    const client = mockClient();
    // Mock 3 individual responses, one for each credential ID
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockOkResponse({ id: 1, name: "Vault" }))
      .mockResolvedValueOnce(mockOkResponse({ id: 2, name: "SSH Key" }))
      .mockResolvedValueOnce(mockOkResponse({ id: 3, name: "Cloud" }));

    await attachCredential(client, 10, [1, 2, 3]);

    // Three individual POSTs, not a single array-payload POST
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(
      1,
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1 }),
      },
      undefined,
    );
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 2 }),
      },
      undefined,
    );
    expect(client.request).toHaveBeenNthCalledWith(
      3,
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 3 }),
      },
      undefined,
    );
  });

  it("returns composite { count, results } for multi-credential success", async () => {
    const client = mockClient();
    const vaultResp = { id: 1, name: "Vault Credential" };
    const sshResp = { id: 2, name: "SSH Key" };
    const cloudResp = { id: 3, name: "Cloud Credential" };

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockOkResponse(vaultResp))
      .mockResolvedValueOnce(mockOkResponse(sshResp))
      .mockResolvedValueOnce(mockOkResponse(cloudResp));

    const result = await attachCredential(client, 10, [1, 2, 3]);

    expect(result).toEqual({
      count: 3,
      results: [vaultResp, sshResp, cloudResp],
    });
  });

  it("throws partial-failure error identifying which credential ID failed", async () => {
    const client = mockClient();
    // Credential 1 succeeds, credential 2 fails, credential 3 succeeds
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockOkResponse({ id: 1, name: "Vault" }))
      .mockResolvedValueOnce(
        mockErrorResponse(404, "Not Found", "Credential not found."),
      )
      .mockResolvedValueOnce(mockOkResponse({ id: 3, name: "Cloud" }));

    await expect(
      attachCredential(client, 10, [1, 2, 3]),
    ).rejects.toThrow(
      "Partial failure attaching credentials: credential 2: AWX attach credential failed: HTTP 404: Credential not found.",
    );

    expect(client.request).toHaveBeenCalledTimes(3);
  });

  it("throws all-failures error when every credential POST fails", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockErrorResponse(404, "Not Found", "Credential not found."),
      )
      .mockResolvedValueOnce(
        mockErrorResponse(400, "Bad Request", "Already attached."),
      );

    await expect(
      attachCredential(client, 10, [1, 2]),
    ).rejects.toThrow(
      /Failed to attach credentials: credential 1:.*credential 2:.*/,
    );

    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("forwards AbortSignal to every individual POST", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockOkResponse({ id: 1 }))
      .mockResolvedValueOnce(mockOkResponse({ id: 2 }))
      .mockResolvedValueOnce(mockOkResponse({ id: 3 }));

    const controller = new AbortController();
    await attachCredential(client, 10, [1, 2, 3], controller.signal);

    // Each of the 3 calls should receive the abort signal
    expect(client.request).toHaveBeenCalledTimes(3);
    for (let i = 1; i <= 3; i++) {
      expect(client.request).toHaveBeenNthCalledWith(
        i,
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        controller.signal,
      );
    }
  });

  it("re-throws AbortError immediately in multi-credential loop", async () => {
    const client = mockClient();
    // First credential succeeds, then abort
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockOkResponse({ id: 1 }))
      .mockRejectedValueOnce(
        new DOMException("The operation was aborted.", "AbortError"),
      );

    await expect(
      attachCredential(client, 10, [1, 2, 3]),
    ).rejects.toThrow("aborted");

    // Should not have tried the 3rd credential
    expect(client.request).toHaveBeenCalledTimes(2);
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

  /* ══════════════════════════════════════════════════════════════════
     Multi-Credential — Per-Credential Individual POSTs
     ══════════════════════════════════════════════════════════════════ */

  it("returns success output and metadata when multiple credentials are attached", async () => {
    const vaultResp = { id: 1, name: "Vault" };
    const sshResp = { id: 2, name: "SSH Key" };
    const cloudResp = { id: 3, name: "Cloud" };

    (mockAwxClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(vaultResp), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(sshResp), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(cloudResp), {
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
      { job_template_id: 10, credential_id: [1, 2, 3] },
      mockToolContext(),
    );

    const wrapped = result as { output: string; metadata: Record<string, unknown> };
    expect(wrapped.output).toContain("Credentials [1, 2, 3] attached to template 10");
    expect(wrapped.metadata).toEqual({
      count: 3,
      results: [vaultResp, sshResp, cloudResp],
    });
  });

  it("verifies 3 individual POST bodies when credential_id is an array", async () => {
    (mockAwxClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 2 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 3 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    await hooks.tool!["awx-attach-credential"]!.execute(
      { job_template_id: 10, credential_id: [1, 2, 3] },
      mockToolContext(),
    );

    // Each call should have an individual single-ID body, not an array
    expect(mockAwxClient.request).toHaveBeenCalledTimes(3);
    expect(mockAwxClient.request).toHaveBeenNthCalledWith(
      1,
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1 }),
      }),
      expect.any(AbortSignal),
    );
    expect(mockAwxClient.request).toHaveBeenNthCalledWith(
      2,
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 2 }),
      }),
      expect.any(AbortSignal),
    );
    expect(mockAwxClient.request).toHaveBeenNthCalledWith(
      3,
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 3 }),
      }),
      expect.any(AbortSignal),
    );
  });

  it("handles abort signal before execution with array credential_id", async () => {
    const controller = new AbortController();
    controller.abort();

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-attach-credential"]!.execute(
      { job_template_id: 10, credential_id: [1, 2, 3] },
      mockToolContext({ abort: controller.signal }),
    );

    expect((result as { output: string }).output).toBe("Request was aborted.");
  });

  it("returns error output when API fails with array credential_id", async () => {
    // Credential 1 succeeds, credential 2 fails, credential 3 succeeds
    (mockAwxClient.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "Credential 2 not found." }), {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 3 }), {
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
      { job_template_id: 10, credential_id: [1, 2, 3] },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("awx-attach-credential error");
    expect((result as { output: string }).output).toContain("Partial failure attaching credentials");
    expect((result as { output: string }).output).toContain("credential 2");
    expect((result as { output: string }).output).toContain("Credential 2 not found");
  });
});

// ══════════════════════════════════════════════════════════════════
// Integration Tests — run against real AWX (env-guarded)
// ══════════════════════════════════════════════════════════════════
//
// Run with: AWX_INTEGRATION_TEST=1 npm test -- attach-credential
//
// Requires:
//   AWX_INTEGRATION_TEST=1  — must be set to run
//   AWX_BASE_URL            — full AWX URL (e.g. https://aap.example.com)
//   AWX_TOKEN               — AWX Personal Access Token (PAT)
//   AWX_TEST_TEMPLATE_ID    — ID of a real job template to attach to
//   AWX_TEST_CREDENTIAL_ID  — ID of a real credential to attach
//   AWX_TEST_CREDENTIAL_2   — (optional) second credential for multi-attach

const integrationTest = process.env.AWX_INTEGRATION_TEST ? it : it.skip;

describe("awx-attach-credential integration", () => {
  integrationTest(
    "attaches multiple credentials individually via POST to real AWX",
    async () => {
      const baseUrl = process.env.AWX_BASE_URL;
      const token = process.env.AWX_TOKEN;
      const templateId = process.env.AWX_TEST_TEMPLATE_ID;
      const credentialId1 = process.env.AWX_TEST_CREDENTIAL_ID;
      const credentialId2 = process.env.AWX_TEST_CREDENTIAL_2;

      if (!baseUrl || !token) {
        throw new Error(
          "AWX_BASE_URL and AWX_TOKEN environment variables must be set for integration tests",
        );
      }
      if (!templateId || !credentialId1) {
        throw new Error(
          "AWX_TEST_TEMPLATE_ID and AWX_TEST_CREDENTIAL_ID must be set",
        );
      }

      // Import createClient directly (bypass the tool layer)
      const { createClient } = await import("../src/client.js");
      const client = createClient({ baseUrl, token });

      const credentialIds: number[] = [Number(credentialId1)];
      if (credentialId2) {
        credentialIds.push(Number(credentialId2));
      }

      // Attach credentials using the thin-proxy function
      const result = await attachCredential(
        client,
        Number(templateId),
        credentialIds,
      );

      // Verify composite shape
      expect(result).toBeDefined();
      expect(result.count).toBe(credentialIds.length);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results).toHaveLength(credentialIds.length);

      // Each result should have at least an id field
      for (const r of result.results) {
        expect(r).toHaveProperty("id");
      }
    },
    30000, // 30 second timeout for real network calls
  );
});
