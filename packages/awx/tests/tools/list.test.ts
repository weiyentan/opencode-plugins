/**
 * List Tools Integration Tests
 *
 * Tests for awx-list-templates, awx-list-projects, and awx-list-jobs tools:
 * registration, execution with table output, error handling, abort handling,
 * and parameter passing.
 *
 * Follows the same patterns as tests/tools/hello.test.ts and tests/index.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../../src/index.js";
import * as listTemplatesModule from "../../src/list-templates.js";
import * as listProjectsModule from "../../src/list-projects.js";
import * as listJobsModule from "../../src/list-jobs.js";

/* ── Helpers ────────────────────────────────────────────────────── */

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
 * When baseUrl is provided, sets process.env.AWX_BASE_URL via vi.stubEnv
 * so that getAwxClient() can resolve a base URL without a real environment.
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

/* ── Mock data factories ─────────────────────────────────────────── */

function createMockTemplateResult(
  overrides?: Partial<listTemplatesModule.TemplateResult>,
): listTemplatesModule.TemplateResult {
  return {
    id: 1,
    name: "Template 1",
    description: "desc1",
    job_type: "run",
    playbook: "site.yml",
    status: "active",
    project_name: "Proj1",
    inventory_name: "Inv1",
    ...overrides,
  };
}

function createMockProjectResult(
  overrides?: Partial<listProjectsModule.Project>,
): listProjectsModule.Project {
  return {
    id: 1,
    name: "project-alpha",
    type: "project",
    url: "/api/v2/projects/1/",
    summary_fields: {
      organization: { id: 1, name: "Default Org" },
    },
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    description: "Test project",
    scm_type: "git",
    scm_branch: "main",
    last_updated: "2024-06-01T00:00:00Z",
    status: "successful",
    ...overrides,
  };
}

function createMockJobResult(
  overrides?: Partial<listJobsModule.JobResult>,
): listJobsModule.JobResult {
  return {
    id: 1,
    name: "job-alpha",
    job_type: "run",
    status: "successful",
    created: "2024-06-01T12:00:00Z",
    started: "2024-06-01T12:00:05Z",
    finished: "2024-06-01T12:30:00Z",
    launched_by: "admin",
    job_template_id: 10,
    job_template_name: "job-alpha",
    ...overrides,
  };
}

/* ════════════════════════════════════════════════════════════════════
   awx-list-templates Tool
   ════════════════════════════════════════════════════════════════════ */

describe('"awx-list-templates" tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── Tool Registration ─────────────────────────────────────────── */

  it("is registered in hooks.tool", async () => {
    const hooks = await createHooks(mockPluginInput());
    try {
      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!["awx-list-templates"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-templates"]!.description).toBe("string");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Returns templates with table output ───────────────────────── */

  it("returns templates with table output including count", async () => {
    const listTemplatesSpy = vi
      .spyOn(listTemplatesModule, "listTemplates")
      .mockResolvedValue({
        count: 2,
        results: [
          createMockTemplateResult({ id: 1, name: "Template A" }),
          createMockTemplateResult({
            id: 2,
            name: "Template B",
            description: "desc2",
            job_type: "check",
            playbook: "deploy.yml",
            status: "successful",
            project_name: "Proj2",
            inventory_name: "Inv2",
          }),
        ],
      });

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext(),
      );

      const output = (result as { output: string }).output;
      expect(output).toContain("Found 2 template(s).");
      expect(output).toContain("| ID | Name | Description | Job Type | Playbook | Status | Project | Inventory |");
      expect(output).toContain("| --- | --- | --- | --- | --- | --- | --- | --- |");
      expect(output).toContain("Template A");
      expect(output).toContain("Template B");

      const metadata = (result as { metadata: Record<string, unknown> }).metadata;
      expect(metadata.count).toBe(2);
      expect(metadata.results).toHaveLength(2);

      listTemplatesSpy.mockRestore();
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Handles client error gracefully ───────────────────────────── */

  it("handles client error and returns error in output", async () => {
    const listTemplatesSpy = vi
      .spyOn(listTemplatesModule, "listTemplates")
      .mockRejectedValue(new Error("Connection timeout"));

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext(),
      );

      expect(result).toEqual({
        output: "Failed to fetch templates: Connection timeout",
        metadata: {
          count: 0,
          results: [],
          warning: "Failed to fetch templates: Connection timeout",
        },
      });

      listTemplatesSpy.mockRestore();
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Handles abort ─────────────────────────────────────────────── */

  it("returns abort message when signal is already aborted", async () => {
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const aborted = new AbortController();
      aborted.abort();

      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext({ abort: aborted.signal }),
      );

      expect((result as { output: string }).output).toBe("Request was aborted.");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Uses timeout and filter parameters ────────────────────────── */

  it("passes timeout and filter args to listTemplates", async () => {
    const listTemplatesSpy = vi
      .spyOn(listTemplatesModule, "listTemplates")
      .mockResolvedValue({
        count: 0,
        results: [],
      });

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      await hooks.tool!["awx-list-templates"]!.execute(
        { filter: ["name__icontains=workspace"], timeout: 15_000 },
        mockToolContext(),
      );

      expect(listTemplatesSpy).toHaveBeenCalledWith(
        expect.any(Object),
        15_000,
        expect.objectContaining({
          filters: ["name__icontains=workspace"],
        }),
        expect.any(AbortSignal),
      );

      listTemplatesSpy.mockRestore();
    } finally {
      await hooks.dispose?.();
    }
  });
});

/* ════════════════════════════════════════════════════════════════════
   awx-list-projects Tool
   ════════════════════════════════════════════════════════════════════ */

describe('"awx-list-projects" tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── Tool Registration ─────────────────────────────────────────── */

  it("is registered in hooks.tool", async () => {
    const hooks = await createHooks(mockPluginInput());
    try {
      expect(hooks.tool!["awx-list-projects"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-projects"]!.description).toBe("string");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Returns projects with table output ────────────────────────── */

  it("returns projects with table output including count", async () => {
    const listProjectsSpy = vi
      .spyOn(listProjectsModule, "listProjects")
      .mockResolvedValue({
        count: 2,
        results: [
          createMockProjectResult({
            id: 1,
            name: "alpha",
            scm_type: "git",
            status: "successful",
          }),
          createMockProjectResult({
            id: 2,
            name: "beta",
            description: "Beta project",
            scm_type: "manual",
            scm_branch: "",
            status: "pending",
            summary_fields: {},
            last_updated: null,
          }),
        ],
      });

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const result = await hooks.tool!["awx-list-projects"]!.execute(
        {},
        mockToolContext(),
      );

      const output = (result as { output: string }).output;
      expect(output).toContain("Found 2 project(s).");
      expect(output).toContain("| ID | Name | Description | SCM | Status | Branch | Org | Updated |");
      expect(output).toContain("| --- | --- | --- | --- | --- | --- | --- | --- |");
      expect(output).toContain("alpha");
      expect(output).toContain("beta");
      expect(output).toContain("Default Org");

      const metadata = (result as { metadata: Record<string, unknown> }).metadata;
      expect(metadata.count).toBe(2);

      listProjectsSpy.mockRestore();
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Handles client error ──────────────────────────────────────── */

  it("handles client error and returns error message", async () => {
    const listProjectsSpy = vi
      .spyOn(listProjectsModule, "listProjects")
      .mockRejectedValue(new Error("API connection refused"));

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const result = await hooks.tool!["awx-list-projects"]!.execute(
        {},
        mockToolContext(),
      );

      expect(result).toEqual({
        output: "Failed to list projects: API connection refused",
        metadata: { error: "API connection refused" },
      });

      listProjectsSpy.mockRestore();
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Handles abort ─────────────────────────────────────────────── */

  it("returns abort message when signal is already aborted", async () => {
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const aborted = new AbortController();
      aborted.abort();

      const result = await hooks.tool!["awx-list-projects"]!.execute(
        {},
        mockToolContext({ abort: aborted.signal }),
      );

      expect((result as { output: string }).output).toBe("Request was aborted.");
    } finally {
      await hooks.dispose?.();
    }
  });
});

/* ════════════════════════════════════════════════════════════════════
   awx-list-jobs Tool
   ════════════════════════════════════════════════════════════════════ */

describe('"awx-list-jobs" tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* ── Tool Registration ─────────────────────────────────────────── */

  it("is registered in hooks.tool", async () => {
    const hooks = await createHooks(mockPluginInput());
    try {
      expect(hooks.tool!["awx-list-jobs"]).toBeDefined();
      expect(typeof hooks.tool!["awx-list-jobs"]!.description).toBe("string");
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Returns jobs with table output ────────────────────────────── */

  it("returns jobs with table output including count", async () => {
    const listJobsSpy = vi
      .spyOn(listJobsModule, "listJobs")
      .mockResolvedValue({
        schema_version: "1.0",
        total_jobs: 2,
        results: [
          createMockJobResult({
            id: 1,
            name: "job-alpha",
            job_type: "run",
            status: "successful",
            launched_by: "admin",
          }),
          createMockJobResult({
            id: 2,
            name: "job-beta",
            job_type: "check",
            status: "failed",
            created: "2024-05-01T08:00:00Z",
            started: "2024-05-01T08:00:05Z",
            finished: "2024-05-01T08:15:00Z",
            launched_by: "operator",
          }),
        ],
        pages_fetched: 1,
      });

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        {},
        mockToolContext(),
      );

      const output = (result as { output: string }).output;
      expect(output).toContain("Found 2 job(s).");
      expect(output).toContain("| ID | Name | Job Type | Status | Created | Started | Finished | Launched By |");
      expect(output).toContain("| --- | --- | --- | --- | --- | --- | --- | --- |");
      expect(output).toContain("job-alpha");
      expect(output).toContain("job-beta");
      expect(output).toContain("admin");
      expect(output).toContain("operator");

      const metadata = (result as { metadata: Record<string, unknown> }).metadata;
      expect(metadata.schema_version).toBe("1.0");
      expect(metadata.total_jobs).toBe(2);
      expect(metadata.pages_fetched).toBe(1);

      listJobsSpy.mockRestore();
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Handles client error ──────────────────────────────────────── */

  it("handles client error and returns error in metadata", async () => {
    const listJobsSpy = vi
      .spyOn(listJobsModule, "listJobs")
      .mockRejectedValue(new Error("Connection timeout"));

    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        {},
        mockToolContext(),
      );

      expect(result).toEqual({
        output: "Failed to fetch jobs: Connection timeout",
        metadata: {
          schema_version: "1.0",
          total_jobs: 0,
          results: [],
          pages_fetched: 0,
          warning: "Failed to fetch jobs: Connection timeout",
        },
      });

      listJobsSpy.mockRestore();
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ── Handles abort ─────────────────────────────────────────────── */

  it("returns abort message when signal is already aborted", async () => {
    const input = mockPluginInput();
    (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");

    const hooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    try {
      const aborted = new AbortController();
      aborted.abort();

      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        {},
        mockToolContext({ abort: aborted.signal }),
      );

      expect((result as { output: string }).output).toBe("Request was aborted.");
    } finally {
      await hooks.dispose?.();
    }
  });
});
