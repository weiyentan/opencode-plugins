/**
 * Job Lifecycle Tool Tests
 *
 * Tests for the three job lifecycle tool factories from
 * src/tools/job-status.ts:
 *   - awx-launch-job  (createLaunchJobTool)
 *   - awx-job-status  (createJobStatusTool)
 *   - awx-wait-job    (createWaitJobTool)
 *
 * Each group covers: tool registration, success path, error
 * handling, abort signal, and client-unavailable scenarios.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../../src/index.js";
import * as clientModule from "../../src/client.js";
import type { AwxClient } from "../../src/client.js";

// ─── Test Helpers ─────────────────────────────────────────────

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
  (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");
  const hooks = await createHooks(input, {
    baseUrl: "https://aap.example.com",
  });

  return { hooks, requestSpy };
}

// ─── Success Fixture ──────────────────────────────────────────

const SUCCESS_JOB_FIXTURE = {
  id: 142,
  name: "Deploy Web Stack — Production",
  status: "successful",
  failed: false,
  job_type: "run",
  playbook: "deploy-web-stack.yml",
  created: "2025-06-15T14:32:00Z",
  started: "2025-06-15T14:32:05Z",
  finished: "2025-06-15T14:34:12Z",
  elapsed: 127.0,
  execution_node: "awx-exec-01.tanscloud-internal.com",
  controller_node: "awx-controller-01.tanscloud-internal.com",
  scm_branch: "main",
  verbosity: 0,
  forks: 5,
  limit: "",
  summary_fields: {
    inventory: { id: 1, name: "Production" },
    project: { id: 3, name: "Web Stack Deploy" },
    job_template: { id: 7, name: "Deploy Web Stack" },
    instance_group: { id: 1, name: "default" },
    created_by: { id: 2, username: "svc_admin_ansible" },
    credentials: [
      { id: 5, name: "SSH Key — Production" },
      { id: 8, name: "Vault Password" },
    ],
    labels: {
      results: [
        { id: 1, name: "production" },
        { id: 2, name: "web" },
      ],
    },
  },
  host_summary: {
    ok: 12,
    failures: 0,
    skipped: 0,
    changed: 7,
    unreachable: 0,
  },
};

// ─── Launch Response Fixture ──────────────────────────────────

const LAUNCH_SUCCESS_FIXTURE = {
  id: 456,
  status: "pending",
  type: "job",
  url: "/api/v2/jobs/456/",
  related: {},
  summary_fields: {},
  created: "2025-06-15T14:32:00Z",
  name: "Test Job Launch",
  job_template: 10,
  inventory: 1,
};

// ══════════════════════════════════════════════════════════════
// awx-launch-job
// ══════════════════════════════════════════════════════════════

describe("awx-launch-job tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── Tool Registration ──────────────────────────────────── */

  it("is registered in hooks.tool", async () => {
    const hooks = await createHooks(mockPluginInput());

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-launch-job"]).toBeDefined();
    expect(typeof hooks.tool!["awx-launch-job"]!.description).toBe("string");
  });

  /* ── Successful Launch ──────────────────────────────────── */

  it("launches a job and returns job ID and metadata", async () => {
    const { hooks, requestSpy } = await createHooksWithMockClient(
      LAUNCH_SUCCESS_FIXTURE,
      201,
    );

    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 10, extra_vars: { inventory: "prod" } },
      mockToolContext(),
    );

    // Verify output contains the job ID as JSON
    const outputStr = (result as { output: string }).output;
    const outputParsed = JSON.parse(outputStr);
    expect(outputParsed.id).toBe(456);
    expect(outputParsed.status).toBe("pending");

    // Verify metadata matches the fixture
    const metadata = (result as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.id).toBe(456);
    expect(metadata.status).toBe("pending");
    expect(metadata.name).toBe("Test Job Launch");

    // Verify the API call was made
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith(
      "awx-launch-job",
      "/api/v2/job_templates/10/launch/",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
      expect.any(AbortSignal),
    );
  });

  /* ── extra_vars Passthrough ─────────────────────────────── */

  it("passes extra_vars in the request body", async () => {
    const { hooks, requestSpy } = await createHooksWithMockClient(
      LAUNCH_SUCCESS_FIXTURE,
      201,
    );

    const extraVars = {
      inventory: "prod",
      scm_branch: "refs/heads/main",
      custom_flag: true,
    };

    await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 10, extra_vars: extraVars },
      mockToolContext(),
    );

    expect(requestSpy).toHaveBeenCalledWith(
      "awx-launch-job",
      "/api/v2/job_templates/10/launch/",
      expect.objectContaining({
        body: JSON.stringify({ extra_vars: extraVars }),
      }),
      expect.any(AbortSignal),
    );
  });

  it("omits extra_vars from request body when none provided", async () => {
    const { hooks, requestSpy } = await createHooksWithMockClient(
      LAUNCH_SUCCESS_FIXTURE,
      201,
    );

    await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 10 },
      mockToolContext(),
    );

    expect(requestSpy).toHaveBeenCalledWith(
      "awx-launch-job",
      "/api/v2/job_templates/10/launch/",
      expect.objectContaining({
        body: JSON.stringify({}),
      }),
      expect.any(AbortSignal),
    );
  });

  /* ── HTTP Error Handling ────────────────────────────────── */

  it("returns error message on 404 from invalid template_id", async () => {
    const { hooks } = await createHooksWithMockClient(
      { detail: "Not found." },
      404,
    );

    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 99999, extra_vars: { inventory: "prod" } },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("Failed to launch job");
    expect(out).toContain("404");
  });

  it("returns error message on server error (500)", async () => {
    const { hooks } = await createHooksWithMockClient(
      { detail: "Internal error" },
      500,
    );

    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 10, extra_vars: { inventory: "prod" } },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("Failed to launch job");
    expect(out).toContain("500");
  });

  /* ── Abort Signal ───────────────────────────────────────── */

  it("returns abort message when signal is already aborted", async () => {
    const hooks = await createHooks(mockPluginInput());

    const aborted = new AbortController();
    aborted.abort();

    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 10, extra_vars: { inventory: "prod" } },
      mockToolContext({ abort: aborted.signal }),
    );

    expect((result as { output: string }).output).toContain("aborted");
  });

  /* ── Client Creation Failure ────────────────────────────── */

  it("returns error message when no baseUrl configured", async () => {
    const hooks = await createHooks(mockPluginInput());

    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 10, extra_vars: { inventory: "prod" } },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("AWX_BASE_URL");
  });

  it("returns error message when no token available", async () => {
    const hooks = await createHooks(mockPluginInput(), {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: 10, extra_vars: { inventory: "prod" } },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("PAT");
  });
});

// ══════════════════════════════════════════════════════════════
// awx-job-status
// ══════════════════════════════════════════════════════════════

describe("awx-job-status tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── Tool Registration ──────────────────────────────────── */

  it("is registered in hooks.tool", async () => {
    const hooks = await createHooks(mockPluginInput());

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-job-status"]).toBeDefined();
    expect(typeof hooks.tool!["awx-job-status"]!.description).toBe("string");
  });

  /* ── Successful Status Fetch ────────────────────────────── */

  it("returns structured job detail output for a successful job", async () => {
    const { hooks } = await createHooksWithMockClient(SUCCESS_JOB_FIXTURE);

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    // Verify metadata is a valid JobDetailOutput
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect((metadata.job as Record<string, unknown>).id).toBe(142);
    expect((metadata.job as Record<string, unknown>).status).toBe("successful");
    expect((metadata.related as Record<string, unknown>).inventory_name).toBe("Production");
    expect((metadata.related as Record<string, unknown>).job_template_name).toBe("Deploy Web Stack");
    expect((metadata.related as Record<string, unknown>).created_by).toBe("svc_admin_ansible");
    expect((metadata.host_status_counts as Record<string, unknown>).ok).toBe(12);
    expect((metadata.derived as Record<string, unknown>).is_successful).toBe(true);
    expect((metadata.derived as Record<string, unknown>).is_failed).toBe(false);

    // Verify output field also contains the full contract
    const outputStr = (result as { output: string }).output;
    const outputParsed = JSON.parse(outputStr);
    expect(outputParsed.schema_version).toBe("1.0");
    expect(outputParsed.job.id).toBe(142);
    expect(outputParsed.job.status).toBe("successful");
  });

  /* ── include_stdout Passthrough ─────────────────────────── */

  it("fetches stdout when include_stdout is true", async () => {
    const mockStdout = "PLAY [Deploy Web Stack] *************************\nok: [web-01]\n";

    // Mock two responses: job detail (success) and stdout (text)
    const mockJobResponse = new Response(JSON.stringify(SUCCESS_JOB_FIXTURE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const mockStdoutResponse = new Response(mockStdout, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });

    const requestSpy = vi
      .fn()
      .mockResolvedValueOnce(mockJobResponse)
      .mockResolvedValueOnce(mockStdoutResponse);

    const client: AwxClient = { request: requestSpy };
    const createClientSpy = vi.spyOn(clientModule, "createClient");
    createClientSpy.mockReturnValue(client as any);

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");
    const hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142, include_stdout: true },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.stdout).toBeDefined();
    expect(typeof metadata.stdout).toBe("string");
    expect(metadata.stdout as string).toContain("PLAY [Deploy Web Stack]");

    // Verify output field also includes stdout
    const outputStr = (result as { output: string }).output;
    const outputParsed = JSON.parse(outputStr);
    expect(outputParsed.stdout).toBeDefined();
    expect(outputParsed.stdout as string).toContain("PLAY [Deploy Web Stack]");

    // Verify two API calls: job detail and stdout
    expect(requestSpy).toHaveBeenCalledTimes(2);
  });

  it("omits stdout when include_stdout is not provided", async () => {
    const { hooks, requestSpy } = await createHooksWithMockClient(SUCCESS_JOB_FIXTURE);

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.stdout).toBeUndefined();
    expect(requestSpy).toHaveBeenCalledTimes(1); // only job detail, not stdout
  });

  /* ── Error Handling ─────────────────────────────────────── */

  it("returns error message on 404", async () => {
    const { hooks } = await createHooksWithMockClient(
      { detail: "Not found." },
      404,
    );

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("awx-job-status error");
    expect(out).toContain("404");
  });

  it("returns error message on unauthorized (401)", async () => {
    const { hooks } = await createHooksWithMockClient(
      { detail: "Invalid authentication credentials." },
      401,
    );

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("awx-job-status error");
    expect(out).toContain("401");
  });

  it("returns error message on server error (500)", async () => {
    const { hooks } = await createHooksWithMockClient(
      { detail: "Internal error" },
      500,
    );

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("awx-job-status error");
    expect(out).toContain("500");
  });

  /* ── Abort Signal ───────────────────────────────────────── */

  it("returns abort message when signal is already aborted", async () => {
    const hooks = await createHooks(mockPluginInput());

    const aborted = new AbortController();
    aborted.abort();

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext({ abort: aborted.signal }),
    );

    expect((result as { output: string }).output).toContain("aborted");
  });

  /* ── Client Creation Failure ────────────────────────────── */

  it("returns error message when no token available", async () => {
    const hooks = await createHooks(mockPluginInput(), {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("PAT");
  });
});

// ══════════════════════════════════════════════════════════════
// awx-wait-job
// ══════════════════════════════════════════════════════════════

describe("awx-wait-job tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── Tool Registration ──────────────────────────────────── */

  it("is registered in hooks.tool", async () => {
    const hooks = await createHooks(mockPluginInput());

    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-wait-job"]).toBeDefined();
    expect(typeof hooks.tool!["awx-wait-job"]!.description).toBe("string");
  });

  /* ── Current Status Fetch (Non-blocking) ────────────────── */

  it("returns current job status matching JobDetailOutput contract", async () => {
    const { hooks } = await createHooksWithMockClient(SUCCESS_JOB_FIXTURE);

    const result = await hooks.tool!["awx-wait-job"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect((metadata.job as Record<string, unknown>).id).toBe(142);
    expect((metadata.job as Record<string, unknown>).status).toBe("successful");
    expect((metadata.related as Record<string, unknown>).inventory_name).toBe("Production");
    expect((metadata.derived as Record<string, unknown>).is_successful).toBe(true);

    // Verify output field also contains the full contract
    const outputStr = (result as { output: string }).output;
    const outputParsed = JSON.parse(outputStr);
    expect(outputParsed.schema_version).toBe("1.0");
    expect(outputParsed.job.id).toBe(142);
  });

  it("returns job status without waiting for completion (non-blocking)", async () => {
    const runningFixture = { ...SUCCESS_JOB_FIXTURE, status: "running", finished: null, elapsed: null };
    const { hooks, requestSpy } = await createHooksWithMockClient(runningFixture);

    const result = await hooks.tool!["awx-wait-job"]!.execute(
      { job_id: 205 },
      mockToolContext(),
    );

    // Single API call — no polling loop
    expect(requestSpy).toHaveBeenCalledTimes(1);

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    const job = metadata.job as Record<string, unknown>;
    expect(job.status).toBe("running");
    expect(job.finished).toBeNull();
  });

  /* ── Error Handling ─────────────────────────────────────── */

  it("returns error message on 404", async () => {
    const { hooks } = await createHooksWithMockClient({}, 404);

    const result = await hooks.tool!["awx-wait-job"]!.execute(
      { job_id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("awx-wait-job error");
    expect(out).toContain("404");
  });

  /* ── Abort Signal ───────────────────────────────────────── */

  it("returns abort message when signal is already aborted", async () => {
    const hooks = await createHooks(mockPluginInput());

    const aborted = new AbortController();
    aborted.abort();

    const result = await hooks.tool!["awx-wait-job"]!.execute(
      { job_id: 42 },
      mockToolContext({ abort: aborted.signal }),
    );

    expect((result as { output: string }).output).toContain("aborted");
  });

  /* ── Client Creation Failure ────────────────────────────── */

  it("returns error message when no token available", async () => {
    const hooks = await createHooks(mockPluginInput(), {
      baseUrl: "https://aap.example.com",
    });

    const result = await hooks.tool!["awx-wait-job"]!.execute(
      { job_id: 42 },
      mockToolContext(),
    );

    expect((result as { output: string }).output).toContain("PAT");
  });
});
