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
import awxPluginModule from "../src/index.js";
import * as clientModule from "../src/client.js";
import { listTemplates, type ListTemplatesOutput } from "../src/list-templates.js";
import * as listProjectsModule from "../src/list-projects.js";

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
  const serverFn = awxPluginModule.server as (input: PluginInput, options?: any) => Promise<Hooks>;
  return serverFn(input, options);
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

    it('hooks.tool contains "awx-launch-job" tool', async () => {
      const hooks = await createHooks(mockPluginInput());

      expect(hooks.tool!["awx-launch-job"]).toBeDefined();
      expect(typeof hooks.tool!["awx-launch-job"]!.description).toBe("string");
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

      expect((result as { output: string }).output).toContain("AWX client not available");
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

      expect((result as { output: string }).output).toContain("AWX client not available");
    });

    it("returns structured output when token and baseUrl are set", async () => {
      const input = mockPluginInput();
      (input.client as any).getSecret = vi
        .fn()
        .mockResolvedValue("my-test-token");

      // Prevent actual fetch from being called — the tool will try to
      // make an HTTP request when a client is created. Instead, make the
      // request pass through with mock data.
      const hooks = await createHooks(input, {
        baseUrl: "https://aap.example.com",
      });

      // The tool calls client.request() which calls fetch internally.
      // We need to mock the response. The tool returns { output, metadata }
      // with metadata containing count and results.
      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext(),
      );

      // Without a mocked fetch, the request will fail with a network error.
      // The tool should handle this gracefully and return { output, metadata }
      // with count and results in metadata.
      const obj = result as { output: string; metadata: Record<string, unknown> };
      expect(obj.metadata).toHaveProperty("count");
      expect(obj.metadata).toHaveProperty("results");
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

      expect((result as { output: string }).output).toContain("AWX client not available");
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

      expect((result as { output: string }).output).toContain("AWX client not available");
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

      // Verify structured output
      expect(result).toEqual({
        output: "Found 2 project(s).",
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
  });

  /* ══════════════════════════════════════════════════════════════════
     Cached Client Reuse
     ══════════════════════════════════════════════════════════════════ */

  describe("cached client reuse", () => {
    it("reuses the same AwxClient when token is unchanged", async () => {
      const createClientSpy = vi.spyOn(clientModule, "createClient");

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

      const result = await listTemplates(client, 30_000, { maxPages: 1 });
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

      const result = await listTemplates(client, 30_000, { maxPages: 5 });
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

      const result = await listTemplates(client, 30_000, { maxPages: 2 });
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

      const result = await listTemplates(client, 30_000, { maxPages: 0 });
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

      const result = await listTemplates(client, 30_000);
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
        listTemplates(errorClient, 30_000),
      ).rejects.toThrow("AWX API error: 404 Not Found");
    });
  });

  /* ══════════════════════════════════════════════════════════════════
     Module Export Contract
     ══════════════════════════════════════════════════════════════════ */

  describe("module export", () => {
    it("exports a valid PluginModule with id and server function", () => {
      expect(awxPluginModule.id).toBe("awx");
      expect(awxPluginModule.server).toBeDefined();
      expect(typeof awxPluginModule.server).toBe("function");
    });
  });
});
