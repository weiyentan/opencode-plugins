/**
 * Job Status Tool Tests
 *
 * Tests for the awx-job-status tool: basic status retrieval, stdout
 * inclusion, related URL resolution, and error handling.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";
import { JobDetailOutputSchema } from "../src/contracts/job-detail.js";

// ─── Mock AWX API Responses ───────────────────────────────────

/**
 * Mock AWX API response for GET /api/v2/jobs/142/
 * This is the RAW AWX API shape (not the output contract shape).
 */
function mockAwxApiJobResponse(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
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
    inventory: 1,
    project: 5,
    job_template: 3,
    instance_group: 1,
    created_by: 1,
    summary_fields: {
      inventory: { id: 1, name: "Production" },
      project: { id: 5, name: "Web Stack Deploy" },
      job_template: { id: 3, name: "Deploy Web Stack" },
      instance_group: { id: 1, name: "default" },
      created_by: { id: 1, username: "svc_admin_ansible" },
      credentials: [
        { id: 10, name: "SSH Key — Production" },
        { id: 11, name: "Vault Password" },
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
      changed: 7,
      unreachable: 0,
      skipped: 0,
    },
    extra_vars: "---\napp_version: v2.1.0\nenvironment: production\n",
    ...overrides,
  };
}

/** Mock AWX API response for GET /api/v2/jobs/142/stdout/?format=txt */
const MOCK_STDOUT_TEXT =
  "PLAY [Deploy Web Stack] ***********************************************************\n\n" +
  "TASK [Gathering Facts] *********************************************************\n" +
  "ok: [web-01]\nok: [web-02]\n\n" +
  "TASK [Deploy application] ******************************************************\n" +
  "changed: [web-01]\nchanged: [web-02]\n\n" +
  "PLAY RECAP *********************************************************************\n" +
  "web-01 : ok=5 changed=3 unreachable=0 failed=0 skipped=0\n" +
  "web-02 : ok=5 changed=4 unreachable=0 failed=0 skipped=0\n";

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
  }
  return AwxPlugin(input);
}

function mockFetchResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────

describe("awx-job-status tool", () => {
  let hooks: Hooks;

  beforeEach(async () => {
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");
    hooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await hooks.dispose?.();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic Job Status Retrieval
     ══════════════════════════════════════════════════════════════ */

  it("returns job status matching the JobDetailOutput contract for a successful job", async () => {
    // Arrange: mock the AWX API response
    mockFetchResponse(mockAwxApiJobResponse());

    // Act
    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    // Assert: result metadata should be a valid JobDetailOutput
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    const validation = JobDetailOutputSchema.safeParse(metadata);
    expect(validation.success).toBe(true);
    if (validation.success) {
      expect(metadata.schema_version).toBe("1.0");
      expect((metadata.job as Record<string, unknown>).id).toBe(142);
      expect((metadata.job as Record<string, unknown>).status).toBe("successful");
      expect((metadata.related as Record<string, unknown>).inventory_name).toBe("Production");
      expect((metadata.related as Record<string, unknown>).job_template_name).toBe("Deploy Web Stack");
      expect((metadata.related as Record<string, unknown>).created_by).toBe("svc_admin_ansible");
      expect((metadata.related as Record<string, unknown>).credential_names).toEqual([
        "SSH Key — Production",
        "Vault Password",
      ]);
      expect((metadata.related as Record<string, unknown>).label_names).toEqual(["production", "web"]);
      expect((metadata.host_status_counts as Record<string, unknown>).ok).toBe(12);
      expect((metadata.host_status_counts as Record<string, unknown>).failed).toBe(0); // mapped from AWX `failures`
      expect((metadata.derived as Record<string, unknown>).is_successful).toBe(true);
      expect((metadata.derived as Record<string, unknown>).is_failed).toBe(false);
      expect((metadata.derived as Record<string, unknown>).has_unreachable_hosts).toBe(false);
    }
  });

  it("reports tool is registered in hooks.tool", async () => {
    expect(hooks.tool!["awx-job-status"]).toBeDefined();
    expect(typeof hooks.tool!["awx-job-status"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Stdout Inclusion
     ══════════════════════════════════════════════════════════════ */

  it("returns stdout when include_stdout is true", async () => {
    // Mock fetch for job detail (first call) and stdout (second call)
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(mockAwxApiJobResponse()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(MOCK_STDOUT_TEXT, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        }),
      );

    // Act
    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142, include_stdout: true },
      mockToolContext(),
    );

    // Assert
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    const validation = JobDetailOutputSchema.safeParse(metadata);
    expect(validation.success).toBe(true);
    if (validation.success) {
      expect(metadata.stdout).toBeDefined();
      expect(typeof metadata.stdout).toBe("string");
      expect(metadata.stdout).toContain("PLAY [Deploy Web Stack]");
    }
  });

  it("omits stdout when include_stdout is false or not provided", async () => {
    mockFetchResponse(mockAwxApiJobResponse());

    // Act — no include_stdout
    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    // Assert
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.stdout).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1); // only job detail, not stdout
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Error Handling
     ══════════════════════════════════════════════════════════════ */

  it("returns error string when job_id is not found (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("awx-job-status error");
    expect(out).toContain("AWX API error (404)");
  });

  it("returns error string when unauthorized (401)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "Invalid authentication credentials." }),
        {
          status: 401,
          statusText: "Unauthorized",
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("awx-job-status error");
    expect(out).toContain("AWX API error (401)");
  });

  it("returns error string on server error (500)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "Internal server error." }),
        {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("awx-job-status error");
    expect(out).toContain("AWX API error (500)");
  });

  it("returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    // getSecret returns null by default — no token available
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-job-status"]!.execute(
      { job_id: 142 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("AWX client not available");

    await localHooks.dispose?.();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Partial / Failed Job Fixtures
     ══════════════════════════════════════════════════════════════ */

  it("returns partial status with unreachable hosts", async () => {
    const partialJob = mockAwxApiJobResponse({
      id: 205,
      name: "Patch All Servers — Staging",
      status: "successful",
      failed: false,
      host_summary: {
        ok: 45,
        failures: 0,
        changed: 38,
        unreachable: 3,
        skipped: 2,
      },
      summary_fields: {
        inventory: { id: 2, name: "Staging" },
        project: { id: 10, name: "Server Patching" },
        job_template: { id: 8, name: "Patch Servers" },
        instance_group: { id: 1, name: "default" },
        created_by: { id: 1, username: "svc_admin_ansible" },
        credentials: [{ id: 20, name: "SSH Key — Staging" }],
        labels: {
          results: [
            { id: 3, name: "staging" },
            { id: 4, name: "maintenance" },
          ],
        },
      },
    });

    mockFetchResponse(partialJob);

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 205 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    const validation = JobDetailOutputSchema.safeParse(metadata);
    expect(validation.success).toBe(true);
    if (validation.success) {
      expect((metadata.host_status_counts as Record<string, unknown>).unreachable).toBe(3);
      expect((metadata.derived as Record<string, unknown>).has_unreachable_hosts).toBe(true);
      expect((metadata.derived as Record<string, unknown>).is_failed).toBe(false);
      expect((metadata.derived as Record<string, unknown>).is_successful).toBe(true);
      expect((metadata.errors as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("returns failed job status with errors", async () => {
    const failedJob = mockAwxApiJobResponse({
      id: 318,
      name: "Deploy Database Migration — QA",
      status: "failed",
      failed: true,
      host_summary: {
        ok: 1,
        failures: 1,
        changed: 0,
        unreachable: 0,
        skipped: 0,
      },
      summary_fields: {
        inventory: { id: 3, name: "QA" },
        project: { id: 15, name: "Database Operations" },
        job_template: { id: 12, name: "Run DB Migration" },
        instance_group: { id: 1, name: "default" },
        created_by: { id: 2, username: "db_admin" },
        credentials: [
          { id: 30, name: "SSH Key — QA" },
          { id: 31, name: "DB Admin Credentials" },
        ],
        labels: {
          results: [
            { id: 5, name: "qa" },
            { id: 6, name: "database" },
          ],
        },
      },
    });

    mockFetchResponse(failedJob);

    const result = await hooks.tool!["awx-job-status"]!.execute(
      { job_id: 318 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    const validation = JobDetailOutputSchema.safeParse(metadata);
    expect(validation.success).toBe(true);
    if (validation.success) {
      expect((metadata.derived as Record<string, unknown>).is_failed).toBe(true);
      expect((metadata.derived as Record<string, unknown>).is_successful).toBe(false);
      expect((metadata.errors as unknown[]).length).toBeGreaterThan(0);
    }
  });
});
