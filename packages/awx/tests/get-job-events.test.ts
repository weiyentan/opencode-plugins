/**
 * Get Job Events Tool Tests
 *
 * Tests for the awxGetJobEvents tool: registration, basic fetch,
 * event filtering, pagination, and error handling.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
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

/**
 * Create mock AWX client with a controllable request function.
 */
function mockAwxClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

/**
 * Create a mock Response from the AWX API.
 */
function mockJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Extract metadata from a standardised tool result { output, metadata }.
 */
function getMetadata(result: unknown): Record<string, unknown> {
  const obj = result as { output: string; metadata?: Record<string, unknown> };
  return obj.metadata ?? {};
}

describe("AWX Get Job Events Tool", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  /* ══════════════════════════════════════════════════════════════════
     Tool Registration
     ══════════════════════════════════════════════════════════════════ */

  it('hooks.tool contains "awx-get-job-events" tool', async () => {
    const hooks = await createHooks(mockPluginInput());

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-get-job-events"]).toBeDefined();
    expect(typeof hooks.tool!["awx-get-job-events"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════════
     Basic Events Fetch
     ══════════════════════════════════════════════════════════════════ */

  it("returns structured output with count, results, and next_page", async () => {
    const mockClient = mockAwxClient();
    (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({
        count: 3,
        next: null,
        previous: null,
        results: [
          { id: 1, event: "playbook_on_start", job: 42 },
          { id: 2, event: "playbook_on_task_start", job: 42 },
          { id: 3, event: "runner_on_ok", job: 42 },
        ],
      }),
    );

    vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi
      .fn()
      .mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42 },
      mockToolContext(),
    );

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(3);
    expect(parsed.results).toHaveLength(3);
    expect((parsed.results as Record<string, unknown>[])[0].event).toBe("playbook_on_start");
    expect(parsed.next_page).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination
     ══════════════════════════════════════════════════════════════════ */

  it("extracts next_page when the API response includes a next URL", async () => {
    const mockClient = mockAwxClient();
    (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({
        count: 501,
        next: "https://aap.example.com/api/v2/jobs/42/job_events/?page=2",
        previous: null,
        results: Array.from({ length: 500 }, (_, i) => ({
          id: i + 1,
          event: "runner_on_ok",
          job: 42,
        })),
      }),
    );

    vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi
      .fn()
      .mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42 },
      mockToolContext(),
    );

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(501);
    expect(parsed.results).toHaveLength(500);
    expect(parsed.next_page).toBe(2);
  });

  it("passes page parameter to the API", async () => {
    const mockClient = mockAwxClient();
    (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({
        count: 501,
        next: "https://aap.example.com/api/v2/jobs/42/job_events/?page=3",
        previous: "https://aap.example.com/api/v2/jobs/42/job_events/?page=1",
        results: Array.from({ length: 1 }, (_, i) => ({
          id: 501 + i,
          event: "runner_on_ok",
          job: 42,
        })),
      }),
    );

    vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi
      .fn()
      .mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42, page: 2 },
      mockToolContext(),
    );

    // Verify the page parameter was sent
    const requestPath = (mockClient.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestPath).toContain("page=2");

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(501);
    expect(parsed.next_page).toBe(3);
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling
     ══════════════════════════════════════════════════════════════════ */

  it("returns error when AWX client is not available (no baseUrl)", async () => {
    const input = mockPluginInput();
    // No baseUrl configured
    const hooks = await createHooks(input);

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42 },
      mockToolContext(),
    );

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(0);
    expect(parsed.results).toHaveLength(0);
    expect(parsed.next_page).toBeNull();
    expect(parsed.error).toContain("AWX client not available");
  });

  it("returns error when AWX client is not available (no token)", async () => {
    const input = mockPluginInput();
    // getSecret returns null (default)
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42 },
      mockToolContext(),
    );

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(0);
    expect(parsed.results).toHaveLength(0);
    expect(parsed.next_page).toBeNull();
    expect(parsed.error).toContain("AWX client not available");
  });

  it("returns error when API returns non-OK status", async () => {
    const mockClient = mockAwxClient();
    (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("Not Found", {
        status: 404,
        statusText: "Not Found",
      }),
    );

    vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi
      .fn()
      .mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 999 },
      mockToolContext(),
    );

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(0);
    expect(parsed.results).toHaveLength(0);
    expect(parsed.next_page).toBeNull();
    expect(parsed.error).toContain("404");
  });

  it("returns error when request throws (network failure)", async () => {
    const mockClient = mockAwxClient();
    (mockClient.request as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi
      .fn()
      .mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42 },
      mockToolContext(),
    );

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(0);
    expect(parsed.results).toHaveLength(0);
    expect(parsed.next_page).toBeNull();
    expect(parsed.error).toContain("Network error");
  });

  it("returns error when job_id is not found (404)", async () => {
    const mockClient = mockAwxClient();
    (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ detail: "Not found." }, 404),
    );

    vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi
      .fn()
      .mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 99999 },
      mockToolContext(),
    );

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(0);
    expect(parsed.results).toHaveLength(0);
    expect(parsed.next_page).toBeNull();
    expect(parsed.error).toContain("404");
  });

  /* ══════════════════════════════════════════════════════════════════
     Abort Signal
     ══════════════════════════════════════════════════════════════════ */

  it("returns abort message when signal is aborted", async () => {
    const hooks = await createHooks(mockPluginInput());

    const aborted = new AbortController();
    aborted.abort();

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42 },
      mockToolContext({ abort: aborted.signal }),
    );

    expect((result as { output: string }).output).toContain("aborted");
  });

  /* ══════════════════════════════════════════════════════════════════
     Event Filtering
     ══════════════════════════════════════════════════════════════════ */

  it("passes event_filter as query parameter to the API", async () => {
    const mockClient = mockAwxClient();
    (mockClient.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [
          { id: 5, event: "playbook_on_task_start", job: 42 },
        ],
      }),
    );

    vi.spyOn(clientModule, "createClient").mockReturnValue(mockClient);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi
      .fn()
      .mockResolvedValue("test-token");

    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-get-job-events"]!.execute(
      { job_id: 42, event_filter: "playbook_on_task_start" },
      mockToolContext(),
    );

    // Verify the request was made with the event filter in the path
    const requestPath = (mockClient.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestPath).toContain("event=playbook_on_task_start");

    const parsed = getMetadata(result);
    expect(parsed.count).toBe(1);
    expect(parsed.results).toHaveLength(1);
    expect((parsed.results as Record<string, unknown>[])[0].event).toBe("playbook_on_task_start");
    expect(parsed.next_page).toBeNull();
  });
});
