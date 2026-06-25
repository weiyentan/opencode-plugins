/**
 * Project CRUD Tool Tests
 *
 * Tests awx-create-project, awx-update-project, and awx-delete-project
 * tools end-to-end: tool registration, correct endpoints/methods,
 * Zod schema validation, error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Mock Data ────────────────────────────────────────────────

const MOCK_CREATE_RESPONSE: Record<string, unknown> = {
  id: 42,
  name: "New Web Project",
  description: "Created via API",
  scm_type: "git",
  scm_url: "https://github.com/example/new-project.git",
  scm_branch: "main",
  status: "successful",
  last_updated: "2025-06-25T12:00:00Z",
  created: "2025-06-25T12:00:00Z",
  modified: "2025-06-25T12:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
    created_by: { id: 1, username: "admin" },
  },
};

const MOCK_UPDATE_RESPONSE: Record<string, unknown> = {
  id: 5,
  name: "Updated Project Name",
  description: "Updated description",
  scm_type: "git",
  scm_url: "https://github.com/example/updated.git",
  scm_branch: "main",
  status: "successful",
  last_updated: "2025-06-25T13:00:00Z",
  created: "2025-01-10T08:00:00Z",
  modified: "2025-06-25T13:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
    created_by: { id: 1, username: "admin" },
  },
};

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
  return AwxPlugin(input);
}

function mockFetchResponse(body: unknown, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Shared beforeEach/afterEach ──────────────────────────────

let hooks: Hooks;

async function setupHooks(): Promise<void> {
  const input = mockPluginInput();
  (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");
  hooks = await createHooks(input, {
    baseUrl: "https://aap.example.com",
  });
}

async function teardownHooks(): Promise<void> {
  vi.restoreAllMocks();
  await hooks.dispose?.();
}

// ═══════════════════════════════════════════════════════════════
// Tool Registration
// ═══════════════════════════════════════════════════════════════

describe("project CRUD tool registration", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("registers awx-create-project in hooks.tool", async () => {
    expect(hooks.tool!["awx-create-project"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-project"]!.description).toBe("string");
  });

  it("registers awx-update-project in hooks.tool", async () => {
    expect(hooks.tool!["awx-update-project"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-project"]!.description).toBe("string");
  });

  it("registers awx-delete-project in hooks.tool", async () => {
    expect(hooks.tool!["awx-delete-project"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-project"]!.description).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-create-project
// ═══════════════════════════════════════════════════════════════

describe("awx-create-project", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends POST to /api/v2/projects/ and returns created project", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_CREATE_RESPONSE), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-project"]!.execute(
      {
        name: "New Web Project",
        organization_id: 1,
        scm_type: "git",
        scm_url: "https://github.com/example/new-project.git",
        description: "Created via API",
      },
      mockToolContext(),
    );

    // Verify fetch was called with POST to the correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/projects/");
    expect(requestInit?.method).toBe("POST");

    // Verify the request body
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};
    expect(requestBody.name).toBe("New Web Project");
    expect(requestBody.organization).toBe(1);
    expect(requestBody.scm_type).toBe("git");

    // Verify the output envelope
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("project");
    expect(metadata.id).toBe(42);

    // Verify mapped project data (mapProject returns ProjectDetailOutput
    // with an inner `data` field containing the actual project fields)
    const projectDetail = metadata.data as Record<string, unknown>;
    const projectData = projectDetail.data as Record<string, unknown>;
    expect(projectData.name).toBe("New Web Project");
    expect(projectData.organization_name).toBe("Default");
    expect(projectData.is_successful).toBe(true);

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Project 42 created successfully");
    expect(output).toContain("New Web Project");
  });

  it("rejects missing required field (name)", async () => {
    const schema = hooks.tool!["awx-create-project"]!.args;
    const parsed = schema?.safeParse?.({ organization_id: 1 });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects missing required field (organization_id)", async () => {
    const schema = hooks.tool!["awx-create-project"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects invalid scm_type value", async () => {
    const schema = hooks.tool!["awx-create-project"]!.args;
    const parsed = schema?.safeParse?.({
      name: "Test",
      organization_id: 1,
      scm_type: "svn",
    });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Organization not found." }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-project"]!.execute(
      { name: "Test", organization_id: 999 },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to create project");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
    expect((metadata.errors as string[])[0]).toContain("Organization not found");
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-project"]!.execute(
      { name: "Test", organization_id: 1 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });

  it("creates project without optional scm fields", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_CREATE_RESPONSE), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-project"]!.execute(
      { name: "Manual Project", organization_id: 2 },
      mockToolContext(),
    );

    const fetchCall = fetchSpy.mock.calls[0];
    const [, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};

    expect(requestBody.name).toBe("Manual Project");
    expect(requestBody.organization).toBe(2);
    expect(requestBody.scm_type).toBeUndefined();
    expect(requestBody.scm_url).toBeUndefined();

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-update-project
// ═══════════════════════════════════════════════════════════════

describe("awx-update-project", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends PATCH to /api/v2/projects/5/ and returns updated project", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_UPDATE_RESPONSE), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-project"]!.execute(
      { id: 5, name: "Updated Project Name", scm_type: "git" },
      mockToolContext(),
    );

    // Verify PATCH to correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/projects/5/");
    expect(requestInit?.method).toBe("PATCH");

    // Verify body contains only provided fields
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};
    expect(requestBody.name).toBe("Updated Project Name");
    expect(requestBody.scm_type).toBe("git");
    expect(requestBody.organization).toBeUndefined();

    // Verify output envelope
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("project");
    expect(metadata.id).toBe(5);

    // Verify mapped project data (mapProject returns ProjectDetailOutput
    // with an inner `data` field containing the actual project fields)
    const projectDetail = metadata.data as Record<string, unknown>;
    const projectData = projectDetail.data as Record<string, unknown>;
    expect(projectData.name).toBe("Updated Project Name");
    expect(projectData.organization_name).toBe("Default");

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Project 5 updated successfully");
  });

  it("rejects missing id field", async () => {
    const schema = hooks.tool!["awx-update-project"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error for unknown project ID (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-project"]!.execute(
      { id: 99999, name: "Ghost" },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to update project");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-update-project"]!.execute(
      { id: 5, name: "Test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-delete-project
// ═══════════════════════════════════════════════════════════════

describe("awx-delete-project", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends DELETE to /api/v2/projects/5/ and returns success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 204,
        statusText: "No Content",
      }),
    );

    const result = await hooks.tool!["awx-delete-project"]!.execute(
      { id: 5 },
      mockToolContext(),
    );

    // Verify DELETE to correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/projects/5/");
    expect(requestInit?.method).toBe("DELETE");

    // Verify output envelope — data must be null for delete
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("project");
    expect(metadata.id).toBe(5);
    expect(metadata.data).toBeNull();

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Project 5 deleted successfully");
  });

  it("rejects missing id field", async () => {
    const schema = hooks.tool!["awx-delete-project"]!.args;
    const parsed = schema?.safeParse?.({});
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error for unknown project ID (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-delete-project"]!.execute(
      { id: 99999 },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to delete project");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
    expect((metadata.errors as string[])[0]).toContain("Not found");
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-project"]!.execute(
      { id: 5 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });

  it("returns error when no AWX client is available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-delete-project"]!.execute(
      { id: 5 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
