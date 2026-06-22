/**
 * awx-wait-job Tool Tests
 *
 * Validates the non-blocking AWX job status check tool:
 * - Tool registration and description
 * - Non-blocking behavior (returns immediately, no polling)
 * - Structured output matching JobDetailOutput contract
 * - Error handling (404, network errors)
 * - Abort signal respect
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import awxPluginModule from "../src/index.js";
import * as clientModule from "../src/client.js";
import type { AwxClient } from "../src/client.js";
import { __setAwxToken } from "../src/auth.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = resolve(__dirname, "fixtures");

/** Load a fixture JSON file */
function loadFixture(name: string): Record<string, unknown> {
  const path = resolve(fixturesDir, name);
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
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
  const serverFn = awxPluginModule.server as (
    input: PluginInput,
    options?: any,
  ) => Promise<Hooks>;
  return serverFn(input, options);
}

/**
 * Create a mock AWX client that returns a controlled response.
 * Returns the mock client and the request spy for assertions.
 */
function createMockClient(
  responseBody: unknown,
  status = 200,
): { client: AwxClient; requestSpy: ReturnType<typeof vi.fn> } {
  const mockResponse = new Response(JSON.stringify(responseBody), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const requestSpy = vi.fn().mockResolvedValue(mockResponse);
  const client: AwxClient = { request: requestSpy };
  return { client, requestSpy };
}

/**
 * Shortcut: create hooks with a configured mock client.
 * Returns hooks and the request spy for assertions.
 */
async function createHooksWithMockClient(
  responseBody: unknown,
  status = 200,
): Promise<{
  hooks: Hooks;
  requestSpy: ReturnType<typeof vi.fn>;
}> {
  const { client, requestSpy } = createMockClient(responseBody, status);
  const createClientSpy = vi.spyOn(clientModule, "createClient");
  createClientSpy.mockReturnValue(client as any);

  const input = mockPluginInput();
  const hooks = await createHooks(input, {
    baseUrl: "https://aap.example.com",
  });
  __setAwxToken("my-test-token");

  return { hooks, requestSpy };
}

describe("awx-wait-job tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __setAwxToken(undefined);
  });

  /* ══════════════════════════════════════════════════════════════════
     Tool Registration
     ══════════════════════════════════════════════════════════════════ */

  describe("tool registration", () => {
    it("is registered in hooks.tool", async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!["awx-wait-job"]).toBeDefined();
    });

    it("has a description string", async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(typeof hooks.tool!["awx-wait-job"]!.description).toBe("string");
      expect(hooks.tool!["awx-wait-job"]!.description.length).toBeGreaterThan(0);
    });

    it("description documents NON-BLOCKING behavior", async () => {
      const hooks = await createHooks(mockPluginInput());

      const desc = hooks.tool!["awx-wait-job"]!.description;
      expect(desc).toMatch(/non.blocking/i);
      expect(desc).toMatch(/returns immediately/i);
    });

    it("description warns about orphaned jobs", async () => {
      const hooks = await createHooks(mockPluginInput());

      const desc = hooks.tool!["awx-wait-job"]!.description;
      expect(desc).toMatch(/orphaned/i);
      expect(desc).toMatch(/continues running/i);
    });

    it("accepts job_id as a required number argument", async () => {
      const hooks = await createHooks(mockPluginInput());

      // @ts-expect-error args is internal — we check the tool definition
      const args = hooks.tool!["awx-wait-job"].args;
      expect(args).toBeDefined();
      expect(args.job_id).toBeDefined();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Client Unavailable
     ══════════════════════════════════════════════════════════════════ */

  describe("client not available", () => {
    it("returns error message when no baseUrl configured", async () => {
      const hooks = await createHooks(mockPluginInput());

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 42 },
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("AWX client not available");
    });

    it("returns error message when no token stored", async () => {
      const hooks = await createHooks(mockPluginInput(), {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 42 },
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("AWX client not available");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Basic Status Check
     ══════════════════════════════════════════════════════════════════ */

  describe("basic status check", () => {
    const successFixture = loadFixture("raw_awx_job_success.json");

    it("calls GET /api/v2/jobs/<id>/ on AWX API", async () => {
      const { hooks, requestSpy } = await createHooksWithMockClient(
        successFixture,
      );

      await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 142 },
        mockToolContext(),
      );

      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(requestSpy).toHaveBeenCalledWith(
        "awx-wait-job",
        "/api/v2/jobs/142/",
        undefined,
        expect.any(AbortSignal),
      );
    });

    it("returns structured output containing schema_version 1.0", async () => {
      const { hooks } = await createHooksWithMockClient(successFixture);

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 142 },
        mockToolContext(),
      );

      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("output");
      const parsed = (result as { metadata: Record<string, unknown> }).metadata;
      expect(parsed.schema_version).toBe("1.0");
    });

    it("returns job core metadata including id, name, status", async () => {
      const { hooks } = await createHooksWithMockClient(successFixture);

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 142 },
        mockToolContext(),
      );

      const parsed = (result as { metadata: Record<string, unknown> }).metadata;
      const job = parsed.job as Record<string, unknown>;
      expect(job).toBeDefined();
      expect(job.id).toBe(142);
      expect(job.name).toBeDefined();
      expect(job.status).toBeDefined();
      expect(job.job_type).toBeDefined();
    });

    it("returns current status without waiting for completion", async () => {
      // Use the partial/running fixture to verify non-blocking
      const partialFixture = loadFixture("raw_awx_job_partial.json");
      partialFixture.status = "running";
      partialFixture.finished = null;
      partialFixture.elapsed = null;

      const { hooks } = await createHooksWithMockClient(partialFixture);

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 205 },
        mockToolContext(),
      );

      const parsed = (result as { metadata: Record<string, unknown> }).metadata;
      const job = parsed.job as Record<string, unknown>;
      expect(job.status).toBe("running");
      expect(job.finished).toBeNull();
    });

    it("returns job output that matches JobDetailOutput contract shape", async () => {
      const { hooks } = await createHooksWithMockClient(successFixture);

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 142 },
        mockToolContext(),
      );

      const parsed = (result as { metadata: Record<string, unknown> }).metadata;
      expect(parsed).toHaveProperty("schema_version");
      expect(parsed).toHaveProperty("job");
      expect(parsed).toHaveProperty("related");
      expect(parsed).toHaveProperty("host_status_counts");
      expect(parsed).toHaveProperty("derived");
      expect(parsed).toHaveProperty("warnings");
      expect(parsed).toHaveProperty("errors");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Non-Blocking Behavior Verification
     ══════════════════════════════════════════════════════════════════ */

  describe("non-blocking behavior", () => {
    it("returns immediately without polling (single API call)", async () => {
      const { hooks, requestSpy } = await createHooksWithMockClient(
        loadFixture("raw_awx_job_success.json"),
      );

      await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 142 },
        mockToolContext(),
      );

      // Exactly one API call — no polling loop
      expect(requestSpy).toHaveBeenCalledTimes(1);
    });

    it("does not loop or wait for status change (returns current state)", async () => {
      // Even when status is "running" (not terminal), tool returns immediately
      const partialFixture = loadFixture("raw_awx_job_partial.json");
      partialFixture.status = "running";
      partialFixture.finished = null;
      partialFixture.elapsed = null;

      const { hooks, requestSpy } = await createHooksWithMockClient(
        partialFixture,
      );

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 205 },
        mockToolContext(),
      );

      // Single call, no retry/poll for completion
      expect(requestSpy).toHaveBeenCalledTimes(1);

      const parsed = (result as { metadata: Record<string, unknown> }).metadata;
      const job = parsed.job as Record<string, unknown>;
      expect(job.status).toBe("running");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling
     ══════════════════════════════════════════════════════════════════ */

  describe("error handling", () => {
    it("returns not-found message on 404", async () => {
      const { hooks } = await createHooksWithMockClient({}, 404);

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 99999 },
        mockToolContext(),
      );

      const output = (result as { output: string }).output;
      expect(output).toContain("404");
    });

    it("returns HTTP error message on 500", async () => {
      const { hooks } = await createHooksWithMockClient(
        { detail: "Internal error" },
        500,
      );

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 42 },
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("500");
    });

    it("returns HTTP error message on 401", async () => {
      const { hooks } = await createHooksWithMockClient(
        { detail: "Unauthorized" },
        401,
      );

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 42 },
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("401");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Abort Signal
     ══════════════════════════════════════════════════════════════════ */

  describe("abort signal", () => {
    it("returns abort message when signal is aborted", async () => {
      const hooks = await createHooks(mockPluginInput());

      const aborted = new AbortController();
      aborted.abort();

      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: 42 },
        mockToolContext({ abort: aborted.signal }),
      );

      expect((result as { output: string }).output).toContain("aborted");
    });
  });
});
