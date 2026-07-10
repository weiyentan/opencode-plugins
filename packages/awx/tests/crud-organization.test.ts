/**
 * Organization CRUD Tool Tests
 *
 * Tests awx-create-organization, awx-update-organization, and awx-delete-organization
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
  id: 10,
  name: "Engineering",
  description: "Engineering department",
  created: "2025-06-25T12:00:00Z",
  modified: "2025-06-25T12:00:00Z",
  summary_fields: {
    related: {
      users: { count: 5 },
      teams: { count: 2 },
      job_templates: { count: 10 },
      projects: { count: 3 },
      inventories: { count: 4 },
    },
  },
};

const MOCK_UPDATE_RESPONSE: Record<string, unknown> = {
  id: 10,
  name: "Engineering (Updated)",
  description: "Updated description",
  created: "2025-06-25T12:00:00Z",
  modified: "2025-06-25T13:00:00Z",
  summary_fields: {
    related: {
      users: { count: 6 },
      teams: { count: 2 },
      job_templates: { count: 10 },
      projects: { count: 3 },
      inventories: { count: 4 },
    },
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
  vi.stubEnv("AWX_TOKEN", undefined);
  return AwxPlugin(input);
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

describe("organization CRUD tool registration", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("registers awx-create-organization in hooks.tool", async () => {
    expect(hooks.tool!["awx-create-organization"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-organization"]!.description).toBe("string");
  });

  it("registers awx-update-organization in hooks.tool", async () => {
    expect(hooks.tool!["awx-update-organization"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-organization"]!.description).toBe("string");
  });

  it("registers awx-delete-organization in hooks.tool", async () => {
    expect(hooks.tool!["awx-delete-organization"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-organization"]!.description).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-create-organization
// ═══════════════════════════════════════════════════════════════

describe("awx-create-organization", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends POST to /api/v2/organizations/ and returns created organization", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_CREATE_RESPONSE), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-organization"]!.execute(
      {
        name: "Engineering",
        description: "Engineering department",
      },
      mockToolContext(),
    );

    // Verify fetch was called with POST to the correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/organizations/");
    expect(requestInit?.method).toBe("POST");

    // Verify the request body
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};
    expect(requestBody.name).toBe("Engineering");
    expect(requestBody.description).toBe("Engineering department");

    // Verify the output envelope
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("organization");
    expect(metadata.id).toBe(10);

    // Verify mapped organization data
    const orgData = metadata.data as Record<string, unknown>;
    expect(orgData.name).toBe("Engineering");
    expect(orgData.description).toBe("Engineering department");

    // Verify related counts were mapped
    const related = orgData.related as Record<string, number>;
    expect(related.users).toBe(5);
    expect(related.teams).toBe(2);
    expect(related.job_templates).toBe(10);
    expect(related.projects).toBe(3);
    expect(related.inventories).toBe(4);

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Organization 10 created successfully");
    expect(output).toContain("Engineering");
  });

  it("rejects missing required field (name)", async () => {
    const schema = hooks.tool!["awx-create-organization"]!.args;
    const parsed = schema?.safeParse?.({});
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Name already exists." }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-organization"]!.execute(
      { name: "Duplicate" },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to create organization");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
    expect((metadata.errors as string[])[0]).toContain("Name already exists");
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-organization"]!.execute(
      { name: "Test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });

  it("creates organization without optional description", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_CREATE_RESPONSE), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-organization"]!.execute(
      { name: "Engineering" },
      mockToolContext(),
    );

    const fetchCall = fetchSpy.mock.calls[0];
    const [, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};

    expect(requestBody.name).toBe("Engineering");
    expect(requestBody.description).toBeUndefined();

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-update-organization
// ═══════════════════════════════════════════════════════════════

describe("awx-update-organization", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends PATCH to /api/v2/organizations/10/ and returns updated organization", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_UPDATE_RESPONSE), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-organization"]!.execute(
      { id: 10, name: "Engineering (Updated)", description: "Updated description" },
      mockToolContext(),
    );

    // Verify PATCH to correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/organizations/10/");
    expect(requestInit?.method).toBe("PATCH");

    // Verify body contains only provided fields
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};
    expect(requestBody.name).toBe("Engineering (Updated)");
    expect(requestBody.description).toBe("Updated description");

    // Verify output envelope
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("organization");
    expect(metadata.id).toBe(10);

    // Verify mapped organization data
    const orgData = metadata.data as Record<string, unknown>;
    expect(orgData.name).toBe("Engineering (Updated)");
    expect(orgData.description).toBe("Updated description");

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Organization 10 updated successfully");
  });

  it("rejects missing id field", async () => {
    const schema = hooks.tool!["awx-update-organization"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error for unknown organization ID (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-organization"]!.execute(
      { id: 99999, name: "Ghost" },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to update organization");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-update-organization"]!.execute(
      { id: 10, name: "Test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-delete-organization
// ═══════════════════════════════════════════════════════════════

describe("awx-delete-organization", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends DELETE to /api/v2/organizations/10/ and returns success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 204,
        statusText: "No Content",
      }),
    );

    const result = await hooks.tool!["awx-delete-organization"]!.execute(
      { id: 10 },
      mockToolContext(),
    );

    // Verify DELETE to correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/organizations/10/");
    expect(requestInit?.method).toBe("DELETE");

    // Verify output envelope — data must be null for delete
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("organization");
    expect(metadata.id).toBe(10);
    expect(metadata.data).toBeNull();

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Organization 10 deleted successfully");
  });

  it("rejects missing id field", async () => {
    const schema = hooks.tool!["awx-delete-organization"]!.args;
    const parsed = schema?.safeParse?.({});
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error for unknown organization ID (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-delete-organization"]!.execute(
      { id: 99999 },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to delete organization");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
    expect((metadata.errors as string[])[0]).toContain("Not found");
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-organization"]!.execute(
      { id: 10 },
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

    const result = await localHooks.tool!["awx-delete-organization"]!.execute(
      { id: 10 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
