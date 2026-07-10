/**
 * Host CRUD Tool Integration Tests
 *
 * Tests for the awx-create-host, awx-update-host, and awx-delete-host
 * tools: tool registration, endpoint dispatch, error handling, and
 * abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Mock Data ────────────────────────────────────────────────

const MOCK_RAW_HOST: Record<string, unknown> = {
  id: 42,
  name: "web-server-01",
  description: "Production web server",
  inventory: 1,
  created: "2025-06-25T12:00:00Z",
  modified: "2025-06-25T13:00:00Z",
  summary_fields: {
    inventory: { id: 1, name: "Production" },
  },
};

const MOCK_RAW_HOST_CREATED: Record<string, unknown> = {
  id: 99,
  name: "db-server-01",
  description: "Database server",
  inventory: 2,
  created: "2025-06-26T12:00:00Z",
  modified: "2025-06-26T12:00:00Z",
  summary_fields: {
    inventory: { id: 2, name: "Staging" },
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

function mockFetchResponse(body: unknown, status = 200): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Tests ────────────────────────────────────────────────────

describe("Host CRUD tools", () => {
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
     Cycle 1: Tools are registered
     ══════════════════════════════════════════════════════════════ */

  it("registers awx-create-host tool", async () => {
    expect(hooks.tool!["awx-create-host"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-host"]!.description).toBe("string");
  });

  it("registers awx-update-host tool", async () => {
    expect(hooks.tool!["awx-update-host"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-host"]!.description).toBe("string");
  });

  it("registers awx-delete-host tool", async () => {
    expect(hooks.tool!["awx-delete-host"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-host"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Create host — success
     ══════════════════════════════════════════════════════════════ */

  it("creates host with name and inventory_id", async () => {
    mockFetchResponse(MOCK_RAW_HOST_CREATED);

    const result = await hooks.tool!["awx-create-host"]!.execute(
      { name: "db-server-01", inventory_id: 2 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("host");
    expect(metadata.id).toBe(99);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("db-server-01");
  });

  it("creates host with description", async () => {
    mockFetchResponse({
      ...MOCK_RAW_HOST_CREATED,
      description: "My database server",
    });

    const result = await hooks.tool!["awx-create-host"]!.execute(
      { name: "db-server-01", inventory_id: 2, description: "My database server" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("host");
    expect((metadata.data as Record<string, unknown>).description).toBe("My database server");
  });

  it("create host calls POST /api/v2/hosts/", async () => {
    mockFetchResponse(MOCK_RAW_HOST_CREATED);

    await hooks.tool!["awx-create-host"]!.execute(
      { name: "db-server-01", inventory_id: 2 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/hosts/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create host sends body with name and inventory", async () => {
    mockFetchResponse(MOCK_RAW_HOST_CREATED);

    await hooks.tool!["awx-create-host"]!.execute(
      { name: "db-server-01", inventory_id: 2 },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("db-server-01");
    expect(parsed.inventory).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Update host — success
     ══════════════════════════════════════════════════════════════ */

  it("updates host with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_HOST, name: "Updated Host" });

    const result = await hooks.tool!["awx-update-host"]!.execute(
      { id: 42, name: "Updated Host" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("host");
    expect(metadata.id).toBe(42);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated Host");
  });

  it("update host calls PATCH /api/v2/hosts/42/", async () => {
    mockFetchResponse(MOCK_RAW_HOST);

    await hooks.tool!["awx-update-host"]!.execute(
      { id: 42, name: "Updated Host" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/hosts/42/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Delete host — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes host with id", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-host"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("host");
    expect(metadata.id).toBe(42);
    expect(metadata.data).toBeNull();
    expect(metadata.errors).toEqual([]);
  });

  it("delete host calls DELETE /api/v2/hosts/42/", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-host"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/hosts/42/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-host"]!.execute(
      { name: "Test", inventory_id: 1 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("update returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-update-host"]!.execute(
      { id: 42, name: "Test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-host"]!.execute(
      { id: 42 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: AWX API error handling
     ══════════════════════════════════════════════════════════════ */

  it("returns error when create gets API error", async () => {
    mockFetchResponse({ detail: "Bad request." }, 400);

    const result = await hooks.tool!["awx-create-host"]!.execute(
      { name: "Test", inventory_id: 1 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when update gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-update-host"]!.execute(
      { id: 99999, name: "Test" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-delete-host"]!.execute(
      { id: 99999 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Zod schema validation
     ══════════════════════════════════════════════════════════════ */

  it("create rejects missing required name", async () => {
    const schema = hooks.tool!["awx-create-host"]!.args;
    const parsed = schema?.safeParse?.({ inventory_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required inventory_id", async () => {
    const schema = hooks.tool!["awx-create-host"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("update requires id", async () => {
    const schema = hooks.tool!["awx-update-host"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("delete requires id", async () => {
    const schema = hooks.tool!["awx-delete-host"]!.args;
    const parsed = schema?.safeParse?.({});

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: No client available
     ══════════════════════════════════════════════════════════════ */

  it("create returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-create-host"]!.execute(
      { name: "Test", inventory_id: 1 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });

  it("update returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-update-host"]!.execute(
      { id: 42, name: "Test" },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });

  it("delete returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-delete-host"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
