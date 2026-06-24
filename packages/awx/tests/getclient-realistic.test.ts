/**
 * Realistic client mock test for getAwxClient()
 *
 * This test simulates the REAL runtime behavior where the OpenCode server
 * does NOT inject `getSecret` into the `PluginInput.client` object at
 * runtime — the method literally doesn't exist on OpencodeClient.
 *
 * ## The Bug
 *
 * `getAwxClient()` calls `input.client.getSecret?.("awx")` to retrieve
 * a PAT token. But the real `@opencode-ai/sdk@1.17.8` OpencodeClient
 * does NOT have a `getSecret` method. The optional chaining `?.` masks
 * this at TypeScript level, so `getAwxClient()` always returns `undefined`,
 * and all tools fail with "AWX client not available."
 *
 * All existing tests mock `getSecret` as `vi.fn().mockResolvedValue(...)`,
 * so they pass but never catch this bug. This test intentionally OMITS
 * `getSecret` from the mock client — just like the real server does.
 *
 * ## Feedback Loop
 *
 * This test PASSES right now (confirming the bug exists). Once the auth
 * flow is fixed to use the correct secret-retrieval API, this test will
 * need updating to reflect the new behavior — that's the point.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";
import { setCustomConfig } from "../src/runtime-config.js";

/* ── Minimal ToolContext mock ────────────────────────────────────── */

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

/* ── Realistic PluginInput mock ──────────────────────────────────── */

/**
 * Create a PluginInput that matches what the real OpenCode server sends.
 *
 * The real `@opencode-ai/sdk` OpencodeClient (v1.17.8) has NO `getSecret`
 * method on its type or at runtime. This mock deliberately omits it to
 * reproduce the actual bug.
 */
function mockRealisticPluginInput(): PluginInput {
  const mockLog = vi.fn();
  return {
    client: {
      // The real OpencodeClient only has namespaced sub-objects like
      // `app`, `auth`, `tool`, `session`, etc. and does NOT include
      // `getSecret`. We only stub `app.log` because the plugin calls
      // `input.client.app.log(...)` for error/info logging.
      app: { log: mockLog },
      // NOTE: No `getSecret` here — this is the REAL runtime behavior
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

/* ── Hooks factory ───────────────────────────────────────────────── */

async function createHooks(
  input: PluginInput,
  options?: { baseUrl?: string },
): Promise<Hooks> {
  if (options?.baseUrl) {
    vi.stubEnv("AWX_BASE_URL", options.baseUrl);
  }
  return AwxPlugin(input);
}

/* ═══════════════════════════════════════════════════════════════════
   Test Suite: getAwxClient() with realistic (getSecret-free) client
   ═══════════════════════════════════════════════════════════════════ */

describe("getAwxClient() — realistic client (no getSecret)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /* ── Smoke test: tool returns error when getSecret is missing ─── */

  it("awx-list-templates: returns 'AWX client not available' because getSecret is missing from the real client", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("PAT");
  });

  it("awx-list-projects: returns 'AWX client not available' because getSecret is missing from the real client", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-projects"]!.execute(
      {},
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });

  it("awx-launch-job: returns 'AWX client not available' because getSecret is missing from the real client", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 1 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });

  it("awx-job-status: returns 'AWX client not available' because getSecret is missing from the real client", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 1 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });

  it("awx-sync-project: returns 'AWX client not available' because getSecret is missing from the real client", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-sync-project"]!.execute(
      { project_id: 1 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });

  it("awx-wait-job: returns 'AWX client not available' because getSecret is missing from the real client", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-wait-job"]!.execute(
      { job_id: 1 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });

  it("awx-get-job-events: returns 'AWX client not available' because getSecret is missing from the real client", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 1 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════
   H4 Probe: env var fallback
   ═══════════════════════════════════════════════════════════════════ */

describe("getAwxClient() — H4 probe: AWX_TOKEN env var fallback", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("awx-list-templates: creates client successfully via AWX_TOKEN env var when getSecret is unavailable", async () => {
    // H4 PROBE: simulate the env var fallback path
    vi.stubEnv("AWX_TOKEN", "probe-token-from-env");

    // Mock fetch so the HTTP client can make a successful API call
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        count: 1,
        results: [{ id: 1, name: "Test Template", type: "job_template" }],
      }),
    }));

    const input = mockRealisticPluginInput(); // no getSecret on client
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // Client was created — output should NOT contain the "not available" error
    expect((result as { output: string }).output).not.toContain(
      "PAT",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════
   H1 Probe: Module-level setCustomConfig bypasses getSecret
   ═══════════════════════════════════════════════════════════════════ */

describe("getAwxClient() — H1 probe: setCustomConfig bypasses getSecret", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // Clear the module-level config between tests so they don't leak state
    setCustomConfig(undefined);
    // Also clear AWX_TOKEN env var to isolate each test
  });

  it("setCustomConfig({ token: '...' }) before hook creation: creates client successfully (bypasses getSecret)", async () => {
    // H1 PROBE: module-level token set before plugin invocation
    setCustomConfig({ token: "probe-token-h1" });

    // Mock fetch so the HTTP client can make a successful API call
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        count: 1,
        results: [{ id: 42, name: "H1 Probe Template", type: "job_template" }],
      }),
    }));

    const input = mockRealisticPluginInput(); // no getSecret on client
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // Client was created via customConfig → output should NOT contain the error
    expect((result as { output: string }).output).not.toContain(
      "PAT",
    );
  });

  it("without setCustomConfig, falls through to other sources (getSecret unavailable, AWX_TOKEN unset) → no client", async () => {
    // No setCustomConfig call, no getSecret, no AWX_TOKEN env var
    // → all three sources are empty → client not available

    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // All sources are empty — expect the "not available" error
    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });

  it("setCustomConfig(undefined) clears the stored config → client not available", async () => {
    // Set a token first, then clear it
    setCustomConfig({ token: "will-be-cleared" });
    setCustomConfig(undefined);

    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // Config was cleared — expect the "not available" error
    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });

  it("setCustomConfig takes priority over AWX_TOKEN env var", async () => {
    // Both customConfig token and AWX_TOKEN are set — customConfig should win
    setCustomConfig({ token: "custom-wins" });
    vi.stubEnv("AWX_TOKEN", "env-fallback");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        count: 1,
        results: [{ id: 99, name: "Priority Test", type: "job_template" }],
      }),
    }));

    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // Client was created — output should NOT contain the error
    expect((result as { output: string }).output).not.toContain(
      "PAT",
    );
    // Verify fetch was called with the customConfig token as the Authorization header
    // Use the last fetch call (tool execution) — earlier calls may include
    // init-time validation with the real AWX_TOKEN env var
    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalled();
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const headers = (lastCall[1] as RequestInit)?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer custom-wins");
  });
});

/* ═══════════════════════════════════════════════════════════════════
   3-Tier Fallback: setCustomConfig with token only, baseUrl only, and clear
   ═══════════════════════════════════════════════════════════════════ */

describe("getAwxClient() — 3-tier fallback with setCustomConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setCustomConfig(undefined);
  });

  it("setCustomConfig({ token: 'probe-token' }) creates client without getSecret or env var", async () => {
    setCustomConfig({ token: "probe-token" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        count: 1,
        results: [{ id: 1, name: "Probe Template", type: "job_template" }],
      }),
    }));

    const input = mockRealisticPluginInput(); // no getSecret
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // Client created via customConfig token — output should NOT contain the error
    expect((result as { output: string }).output).not.toContain(
      "PAT",
    );
  });

  it("setCustomConfig({ baseUrl, token }) overrides the AWX_BASE_URL env var", async () => {
    // Set a custom base URL via config that differs from the env var
    setCustomConfig({
      baseUrl: "https://custom.example.com",
      token: "override-token",
    });

    // Mock fetch to capture the called URL
    let capturedUrl: string | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          count: 0,
          results: [],
        }),
      });
    }));

    // The env var AWX_BASE_URL is set to something different
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://env-default.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // Client should be created (no "not available" error)
    expect((result as { output: string }).output).not.toContain(
      "PAT",
    );

    // The API call should go to custom.example.com, NOT env-default.example.com
    expect(capturedUrl).toBeDefined();
    expect(capturedUrl).toContain("custom.example.com");
  });

  it("setCustomConfig(undefined) clears config, falls back to no-client state", async () => {
    // Set a config first, then clear it
    setCustomConfig({ baseUrl: "https://temp.example.com", token: "temp-token" });
    setCustomConfig(undefined);

    // No getSecret, no AWX_TOKEN env var → no sources
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-list-templates"]!.execute(
      {},
      mockToolContext(),
    );

    // Config was cleared — expect the "not available" error
    expect((result as { output: string }).output).toContain(
      "PAT",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════
   awx-configure tool
   ═══════════════════════════════════════════════════════════════════ */

describe("awx-configure tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    setCustomConfig(undefined);
  });

  it("executes awx-configure with baseUrl + token and returns success message", async () => {
    // Mock fetch so the client can validate the connection
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
    }));

    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-configure"]!.execute(
      { baseUrl: "https://configured.example.com", token: "configured-token" },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toBe(
      "AWX client configured and ready.",
    );
  });

  it("awx-configure with missing args returns guidance message", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input);

    const result = await hooks.tool!["awx-configure"]!.execute(
      {},
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "Provide at least one of",
    );
  });

  it("awx-configure with only baseUrl (no token) stores config but client not ready", async () => {
    const input = mockRealisticPluginInput();
    const hooks = await createHooks(input);

    const result = await hooks.tool!["awx-configure"]!.execute(
      { baseUrl: "https://no-token.example.com" },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain(
      "Configuration stored",
    );
  });
});
