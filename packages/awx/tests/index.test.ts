/**
 * Plugin Index Tests
 *
 * Validates the AWX plugin entry point: lazy client resolution,
 * cached client reuse, dispose hook, and tool registrations.
 *
 * Follows the same patterns as tests/plugin.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";
import * as clientModule from "../src/client.js";
import * as listTemplatesModule from "../src/list-templates.js";
import * as listProjectsModule from "../src/list-projects.js";
import * as listJobsModule from "../src/list-jobs.js";

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
 * Create hooks by calling AwxPlugin() directly.
 * When baseUrl is provided, it sets process.env.AWX_BASE_URL via vi.stubEnv.
 */
async function createHooks(
  input: PluginInput,
  options?: { baseUrl?: string },
): Promise<Hooks> {
  if (options?.baseUrl) {
    vi.stubEnv("AWX_BASE_URL", options.baseUrl);
  } else {
    vi.stubEnv("AWX_BASE_URL", undefined);
  }
  // Ensure AWX_TOKEN is not set in the environment so tests don't accidentally
  // pick up a real credential and attempt HTTP connections that hang.
  vi.stubEnv("AWX_TOKEN", undefined);
  return AwxPlugin(input);
}

describe("AWX Plugin Index", () => {
  /* ── Clean up after each test ─────────────────────────────────── */
  afterEach(async () => {
    vi.restoreAllMocks();
  });

  /* ══════════════════════════════════════════════════════════════════
     Tool Registrations
     ══════════════════════════════════════════════════════════════════ */

  describe("tool registrations", () => {
    it("hooks.tool contains hello tool", async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!.hello).toBeDefined();
      expect(typeof hooks.tool!.hello!.description).toBe("string");
    });

    it('hooks.tool contains "awx-list-templates" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-list-templates"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-templates"]!.description).toBe("string");
    });

    it('hooks.tool contains "awx-list-projects" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-list-projects"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-projects"]!.description).toBe("string");
    });

    it('hooks.tool contains "awx-list-jobs" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-list-jobs"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-jobs"]!.description).toBe("string");
    });

    it('hooks.tool contains "awx-launch-job" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-launch-job"]).toBeDefined();
      expect(typeof hooks.tool!["awx-launch-job"]!.description).toBe("string");
    });

    it('hooks.tool contains "awx-debug-env" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-debug-env"]).toBeDefined();
      expect(typeof hooks.tool!["awx-debug-env"]!.description).toBe("string");
      expect(hooks.tool!["awx-debug-env"]!.args).toBeDefined();
    });

    it('hooks.tool contains "awx-list-workflow-templates" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-list-workflow-templates"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-workflow-templates"]!.description).toBe("string");
    });

    it('hooks.tool contains "awx-launch-workflow" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-launch-workflow"]).toBeDefined();
      expect(typeof hooks.tool!["awx-launch-workflow"]!.description).toBe("string");
    });

    it('hooks.tool contains "awx-list-instance-groups" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-list-instance-groups"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-instance-groups"]!.description).toBe("string");
      expect(hooks.tool!["awx-list-instance-groups"]!.args).toBeDefined();
    });

    it('hooks.tool contains "awx-list-execution-environments" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-list-execution-environments"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-execution-environments"]!.description).toBe("string");
      expect(hooks.tool!["awx-list-execution-environments"]!.args).toBeDefined();
    });

    it('hooks.tool contains "awx-ping" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-ping"]).toBeDefined();
      expect(typeof hooks.tool!["awx-ping"]!.description).toBe("string");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Dispose Hook
     ══════════════════════════════════════════════════════════════════ */

  describe("hooks.dispose", () => {
    it("exists and is a function", async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.dispose).toBeDefined();
      expect(typeof hooks.dispose).toBe("function");
    });

    it("can be called without throwing", async () => {
      const hooks = await createHooks(mockPluginInput());

      await expect(hooks.dispose!()).resolves.toBeUndefined();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Lazy Client Resolution — getAwxClient() via awx-list-templates tool
     ══════════════════════════════════════════════════════════════════ */

  describe('lazy client resolution (via "awx-list-templates")', () => {
    it("returns error message when no baseUrl configured", async () => {
      const input = mockPluginInput();
      const hooks = await createHooks(input);

      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("AWX_BASE_URL");
    });

    it("returns error message when no token stored (getSecret returns null)", async () => {
      const input = mockPluginInput();
      // getSecret already returns null by default in mockPluginInput
      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("PAT");
    });

    it("returns structured output when token and baseUrl are set", async () => {
      const input = mockPluginInput();
      (input.client as any).getSecret = vi
        .fn()
        .mockResolvedValue("my-test-token");

      // Spy on listTemplates to avoid real HTTP request
      const listTemplatesSpy = vi.spyOn(listTemplatesModule, "listTemplates")
        .mockResolvedValue({
          count: 0,
          results: [],
        });

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext(),
      );

      const obj = result as { output: string; metadata: Record<string, unknown> };
      expect(obj.metadata).toHaveProperty("count");
      expect(obj.metadata).toHaveProperty("results");

      listTemplatesSpy.mockRestore();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     listProjects Tool — Resolution & Execution
     ══════════════════════════════════════════════════════════════════ */

  describe('"awx-list-projects" tool execution', () => {
    it("returns error message when no baseUrl configured", async () => {
      const input = mockPluginInput();
      const hooks = await createHooks(input);

      const result = await hooks.tool!["awx-list-projects"]!.execute(
        {},
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("AWX_BASE_URL");
    });

    it("returns error message when no token stored", async () => {
      const input = mockPluginInput();
      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-projects"]!.execute(
        {},
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("PAT");
    });

    it("calls listProjects and returns structured result when client is available", async () => {
      // Spy on listProjects to verify it's called
      const listProjectsSpy = vi.spyOn(listProjectsModule, "listProjects")
        .mockResolvedValue({
          count: 2,
          results: [
            { id: 1, name: "alpha", type: "project", url: "/api/v2/projects/1/", summary_fields: {}, created: "", modified: "", description: "", scm_type: "git", status: "successful" },
            { id: 2, name: "beta", type: "project", url: "/api/v2/projects/2/", summary_fields: {}, created: "", modified: "", description: "", scm_type: "git", status: "successful" },
          ],
        });

      const input = mockPluginInput();
      (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-projects"]!.execute(
        { maxPages: 3, pageSize: 25, timeout: 15_000 },
        mockToolContext(),
      );

      // Verify listProjects was called with the right args
      expect(listProjectsSpy).toHaveBeenCalledTimes(1);
      expect(listProjectsSpy).toHaveBeenCalledWith(
        expect.any(Object), // AwxClient
        expect.objectContaining({
          maxPages: 3,
          pageSize: 25,
          timeout: 15_000,
          abortSignal: expect.any(AbortSignal),
        }),
      );

      // Verify structured output with pipe-table format
      const expectedTable = [
        "| ID | Name | Description | SCM | Status | Branch | Org | Updated |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | alpha |  | git | successful |  |  |  |",
        "| 2 | beta |  | git | successful |  |  |  |",
      ].join("\n");
      expect(result).toEqual({
        output: `Found 2 project(s).\n\n${expectedTable}`,
        metadata: {
          count: 2,
          results: expect.arrayContaining([
            expect.objectContaining({ name: "alpha" }),
            expect.objectContaining({ name: "beta" }),
          ]),
        },
      });

      listProjectsSpy.mockRestore();
    });

    it("handles error from listProjects and returns error metadata", async () => {
      const listProjectsSpy = vi.spyOn(listProjectsModule, "listProjects")
        .mockRejectedValue(new Error("API connection refused"));

      const input = mockPluginInput();
      (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-projects"]!.execute(
        {},
        mockToolContext(),
      );

      expect(result).toEqual({
        output: "Failed to list projects: API connection refused",
        metadata: { error: "API connection refused" },
      });

      listProjectsSpy.mockRestore();
    });

    it("passes filter arg through to listProjects", async () => {
      const listProjectsSpy = vi.spyOn(listProjectsModule, "listProjects")
        .mockResolvedValue({
          count: 0,
          results: [],
        });

      const input = mockPluginInput();
      (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      await hooks.tool!["awx-list-projects"]!.execute(
        { filter: ["name__icontains=workspace"] },
        mockToolContext(),
      );

      expect(listProjectsSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          filters: ["name__icontains=workspace"],
        }),
      );

      listProjectsSpy.mockRestore();
    });

    it("passes filter and timeout arg through to listTemplates", async () => {
      const listTemplatesSpy = vi.spyOn(
        listTemplatesModule,
        "listTemplates",
      ).mockResolvedValue({
        count: 0,
        results: [],
      });

      const input = mockPluginInput();
      (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      await hooks.tool!["awx-list-templates"]!.execute(
        { filter: ["name__icontains=test"], timeout: 15_000 },
        mockToolContext(),
      );

      expect(listTemplatesSpy).toHaveBeenCalledWith(
        expect.any(Object),
        15_000,
        expect.objectContaining({
          filters: ["name__icontains=test"],
        }),
        expect.any(AbortSignal),
      );

      listTemplatesSpy.mockRestore();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     listJobs Tool — Resolution & Execution
     ══════════════════════════════════════════════════════════════════ */

  describe('"awx-list-jobs" tool execution', () => {
    it("returns error message when no baseUrl configured", async () => {
      const input = mockPluginInput();
      const hooks = await createHooks(input);

      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        {},
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("AWX_BASE_URL");
    });

    it("returns error message when no token stored", async () => {
      const input = mockPluginInput();
      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        {},
        mockToolContext(),
      );

      expect((result as { output: string }).output).toContain("PAT");
    });

    it("calls listJobs and returns structured result when client is available", async () => {
      // Spy on listJobs to verify it's called
      const listJobsSpy = vi.spyOn(listJobsModule, "listJobs")
        .mockResolvedValue({
          schema_version: "1.0",
          total_jobs: 2,
          results: [
            { id: 1, name: "job-alpha", job_type: "run", status: "successful", created: "2024-06-01T00:00:00Z", started: "2024-06-01T00:00:05Z", finished: "2024-06-01T00:30:00Z", launched_by: "admin", job_template_id: 10, job_template_name: "job-alpha" },
            { id: 2, name: "job-beta", job_type: "check", status: "failed", created: "2024-05-01T00:00:00Z", started: "2024-05-01T00:00:05Z", finished: "2024-05-01T00:15:00Z", launched_by: "operator", job_template_id: 11, job_template_name: "job-beta" },
          ],
          pages_fetched: 1,
        });

      const input = mockPluginInput();
      (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        { maxPages: 3, pageSize: 25, timeout: 15_000 },
        mockToolContext(),
      );

      // Verify listJobs was called with the right args
      expect(listJobsSpy).toHaveBeenCalledTimes(1);
      expect(listJobsSpy).toHaveBeenCalledWith(
        expect.any(Object), // AwxClient
        15_000,
        expect.objectContaining({
          maxPages: 3,
          pageSize: 25,
          filters: undefined,
        }),
        expect.any(AbortSignal),
      );

      // Verify structured output with pipe-table format
      const expectedTable = [
        "| ID | Name | Job Type | Status | Created | Started | Finished | Launched By |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| 1 | job-alpha | run | successful | 2024-06-01T00:00:00Z | 2024-06-01T00:00:05Z | 2024-06-01T00:30:00Z | admin |",
        "| 2 | job-beta | check | failed | 2024-05-01T00:00:00Z | 2024-05-01T00:00:05Z | 2024-05-01T00:15:00Z | operator |",
      ].join("\n");
      expect(result).toEqual({
        output: `Found 2 job(s).\n\n${expectedTable}`,
        metadata: {
          schema_version: "1.0",
          total_jobs: 2,
          results: expect.arrayContaining([
            expect.objectContaining({ name: "job-alpha" }),
            expect.objectContaining({ name: "job-beta" }),
          ]),
          pages_fetched: 1,
        },
      });

      listJobsSpy.mockRestore();
    });

    it("handles error from listJobs and returns error metadata", async () => {
      const listJobsSpy = vi.spyOn(listJobsModule, "listJobs")
        .mockRejectedValue(new Error("API connection refused"));

      const input = mockPluginInput();
      (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        {},
        mockToolContext(),
      );

      expect(result).toEqual({
        output: "Failed to fetch jobs: API connection refused",
        metadata: {
          schema_version: "1.0",
          total_jobs: 0,
          results: [],
          pages_fetched: 0,
          warning: "Failed to fetch jobs: API connection refused",
        },
      });

      listJobsSpy.mockRestore();
    });

    it("passes filter arg through to listJobs", async () => {
      const listJobsSpy = vi.spyOn(listJobsModule, "listJobs")
        .mockResolvedValue({
          schema_version: "1.0",
          total_jobs: 0,
          results: [],
          pages_fetched: 0,
        });

      const input = mockPluginInput();
      (input.client as any).getSecret = vi.fn().mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      await hooks.tool!["awx-list-jobs"]!.execute(
        { filter: ["name__icontains=workspace"] },
        mockToolContext(),
      );

      expect(listJobsSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Number),
        expect.objectContaining({
          filters: ["name__icontains=workspace"],
        }),
        expect.any(AbortSignal),
      );

      listJobsSpy.mockRestore();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Cached Client Reuse
     ══════════════════════════════════════════════════════════════════ */

  describe("cached client reuse", () => {
    it("reuses the same AwxClient when token is unchanged", async () => {
      const createClientSpy = vi.spyOn(clientModule, "createClient");
      // Spy on listTemplates to avoid real HTTP request hanging
      const listTemplatesSpy = vi.spyOn(listTemplatesModule, "listTemplates")
        .mockResolvedValue({
          count: 0,
          results: [],
        });

      const input = mockPluginInput();
      (input.client as any).getSecret = vi
        .fn()
        .mockResolvedValue("my-test-token");

      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      // First call — should create a new client
      await hooks.tool!["awx-list-templates"]!.execute({}, mockToolContext());
      expect(createClientSpy).toHaveBeenCalledTimes(1);

      // Second call with same token — should reuse cached client
      await hooks.tool!["awx-list-templates"]!.execute({}, mockToolContext());
      expect(createClientSpy).toHaveBeenCalledTimes(1); // still 1, not 2

      listTemplatesSpy.mockRestore();
      createClientSpy.mockRestore();
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Tool Arguments — awx-list-templates
     ══════════════════════════════════════════════════════════════════ */

  describe('"awx-list-templates" args schema', () => {
    it("is registered and has a description", async () => {
      const hooks = await createHooks(mockPluginInput());
      expect(hooks.tool!["awx-list-templates"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-templates"]!.description).toBe("string");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     listTemplates Function — Core Unit Tests
     ══════════════════════════════════════════════════════════════════ */

  describe("listTemplates core function", () => {
    /** Create a mock AwxClient that resolves with canned page data */
    function mockClient(
      pages: Array<{
        count: number;
        results: Array<{ id: number; name: string; description: string }>;
        next: string | null;
      }>,
    ): clientModule.AwxClient {
      let callIndex = 0;
      return {
        async request(
          _toolName: string,
          _path: string,
          _init?: RequestInit,
          _abortSignal?: AbortSignal,
        ): Promise<Response> {
          const page = pages[callIndex];
          if (!page) {
            return new Response(
              JSON.stringify({ count: 0, results: [], next: null }),
              { status: 200 },
            );
          }
          callIndex++;
          return new Response(JSON.stringify(page), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      };
    }

    it("fetches a single page and returns sorted results", async () => {
      const client = mockClient([
        {
          count: 2,
          results: [
            { id: 2, name: "Z Template", description: "Last" },
            { id: 1, name: "A Template", description: "First" },
          ],
          next: null,
        },
      ]);

      const result = await listTemplatesModule.listTemplates(client, 30_000, { maxPages: 1 });
      expect(result.count).toBe(2);
      expect(result.results[0]!.name).toBe("A Template");
      expect(result.results[1]!.name).toBe("Z Template");
      expect(result.warning).toBeUndefined();
    });

    it("iterates multiple pages when next URL is provided", async () => {
      const client = mockClient([
        {
          count: 4,
          results: [
            { id: 1, name: "B Template", description: "" },
            { id: 2, name: "A Template", description: "" },
          ],
          next: "/api/v2/job_templates/?page=2&page_size=50",
        },
        {
          count: 4,
          results: [
            { id: 3, name: "D Template", description: "" },
            { id: 4, name: "C Template", description: "" },
          ],
          next: null,
        },
      ]);

      const result = await listTemplatesModule.listTemplates(client, 30_000, { maxPages: 5 });
      expect(result.count).toBe(4);
      // Results should be sorted by name across all pages
      expect(result.results.map((r) => r.name)).toEqual([
        "A Template",
        "B Template",
        "C Template",
        "D Template",
      ]);
      expect(result.warning).toBeUndefined();
    });

    it("respects page cap and emits warning when cap exceeded", async () => {
      // Create 3 pages of data, but maxPages = 2
      const makePage = (n: number) => ({
        count: 6,
        results: [
          { id: n * 2 + 1, name: `Template ${n * 2 + 1}`, description: "" },
          { id: n * 2 + 2, name: `Template ${n * 2 + 2}`, description: "" },
        ],
        next:
          n < 2
            ? `/api/v2/job_templates/?page=${n + 2}&page_size=50`
            : null,
      });

      const client = mockClient([makePage(0), makePage(1), makePage(2)]);

      const result = await listTemplatesModule.listTemplates(client, 30_000, { maxPages: 2 });
      expect(result.count).toBe(4); // 2 pages × 2 items
      expect(result.warning).toContain("Page cap of 2 pages reached");
    });

    it("fetches all pages when maxPages is 0 (no cap)", async () => {
      const client = mockClient([
        {
          count: 3,
          results: [{ id: 1, name: "Only", description: "" }],
          next: "/api/v2/job_templates/?page=2&page_size=50",
        },
        {
          count: 3,
          results: [{ id: 2, name: "Other", description: "" }],
          next: "/api/v2/job_templates/?page=3&page_size=50",
        },
        {
          count: 3,
          results: [{ id: 3, name: "Another", description: "" }],
          next: null,
        },
      ]);

      const result = await listTemplatesModule.listTemplates(client, 30_000, { maxPages: 0 });
      expect(result.count).toBe(3);
      expect(result.warning).toBeUndefined();
    });

    it("uses default maxPages=5 and pageSize=50 when no options provided", async () => {
      const client = mockClient([
        {
          count: 1,
          results: [{ id: 1, name: "Default", description: "" }],
          next: null,
        },
      ]);

      const result = await listTemplatesModule.listTemplates(client, 30_000);
      expect(result.count).toBe(1);
    });

    it("propagates client errors as exceptions", async () => {
      const errorClient: clientModule.AwxClient = {
        async request(): Promise<Response> {
          return new Response("Not Found", {
            status: 404,
            statusText: "Not Found",
          });
        },
      };

      await expect(
        listTemplatesModule.listTemplates(errorClient, 30_000),
      ).rejects.toThrow("AWX API error: 404 Not Found");
    });

    it("includes filter params in the initial request URL", async () => {
      const client = mockClient([
        {
          count: 1,
          results: [{ id: 1, name: "Filtered", description: "" }],
          next: null,
        },
      ]);

      // We need to inspect the path passed to client.request
      const requestSpy = vi.spyOn(client, "request");

      await listTemplatesModule.listTemplates(client, 30_000, {
        filters: ["name__icontains=workspace"],
      });

      expect(requestSpy).toHaveBeenCalledWith(
        "awx-list-templates",
        "/api/v2/job_templates/?page_size=50&name__icontains=workspace",
        undefined,
        expect.any(AbortSignal),
      );
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Module Export Contract
     ══════════════════════════════════════════════════════════════════ */

  describe("module export", () => {
    it("exports a valid Plugin function", () => {
      expect(AwxPlugin).toBeDefined();
      expect(typeof AwxPlugin).toBe("function");
    });

    it("export surface contains only AwxPlugin and default", async () => {
      // Dynamic import to get the raw module export surface
      const importedModule = await import("../src/index.js");
      const keys = Object.keys(importedModule).sort();
      expect(keys).toEqual(["AwxPlugin", "default"].sort());
    });
  });
});
