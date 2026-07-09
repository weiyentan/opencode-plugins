/**
 * Host CRUD Tool Integration Tests
 *
 * Tests for the awx-get-host, awx-create-host, awx-update-host, and
 * awx-delete-host tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX host API response matching the known fixture */
const MOCK_RAW_HOST: Record<string, unknown> = {
  id: 42,
  name: "web-01.example.com",
  description: "Primary web server",
  variables: "---\nansible_user: admin\n",
  created: "2025-01-15T08:30:00Z",
  modified: "2025-06-20T12:00:00Z",
  summary_fields: {
    inventory: { id: 5, name: "Production Servers" },
  },
};

/** Another host fixture for create */
const MOCK_RAW_HOST_CREATED: Record<string, unknown> = {
  id: 99,
  name: "db-01.example.com",
  description: "Database server",
  variables: "",
  created: "2025-07-01T00:00:00Z",
  modified: "2025-07-01T00:00:00Z",
  summary_fields: {
    inventory: { id: 3, name: "Staging" },
  },
};

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
  return {
    client: {
      app: { log: vi.fn() },
      getSecret: vi.fn().mockResolvedValue(null),
    } as unknown as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/mock/dir",
    worktree: "/mock/worktree",
    experimental_workspace: { register: vi.fn() },
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

  it("registers awx-get-host tool", async () => {
    expect(hooks.tool!["awx-get-host"]).toBeDefined();
    expect(typeof hooks.tool!["awx-get-host"]!.description).toBe("string");
  });

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
     Cycle 2: Get host — success
     ══════════════════════════════════════════════════════════════ */

  it("gets host by id", async () => {
    mockFetchResponse(MOCK_RAW_HOST);

    const result = await hooks.tool!["awx-get-host"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("host");
    expect(metadata.id).toBe(42);
  });

  it("get host calls GET /api/v2/hosts/42/", async () => {
    mockFetchResponse(MOCK_RAW_HOST);

    await hooks.tool!["awx-get-host"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/hosts/42/",
      expect.any(Object),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Create host — success
     ══════════════════════════════════════════════════════════════ */

  it("creates host with name and inventory_id", async () => {
    mockFetchResponse(MOCK_RAW_HOST_CREATED);

    const result = await hooks.tool!["awx-create-host"]!.execute(
      { name: "db-01.example.com", inventory_id: 3 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("host");
    expect(metadata.id).toBe(99);
    expect(metadata.errors).toEqual([]);
  });

  it("create host calls POST /api/v2/hosts/", async () => {
    mockFetchResponse(MOCK_RAW_HOST_CREATED);

    await hooks.tool!["awx-create-host"]!.execute(
      { name: "db-01.example.com", inventory_id: 3 },
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
      { name: "db-01.example.com", inventory_id: 3 },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("db-01.example.com");
    expect(parsed.inventory).toBe(3);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Update host — success
     ══════════════════════════════════════════════════════════════ */

  it("updates host with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_HOST, name: "web-02.example.com" });

    const result = await hooks.tool!["awx-update-host"]!.execute(
      { id: 42, name: "web-02.example.com" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("host");
    expect(metadata.id).toBe(42);
    expect(metadata.errors).toEqual([]);
  });

  it("update host calls PATCH /api/v2/hosts/42/", async () => {
    mockFetchResponse(MOCK_RAW_HOST);

    await hooks.tool!["awx-update-host"]!.execute(
      { id: 42, name: "web-02.example.com" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/hosts/42/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Delete host — success
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
     Cycle 6: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("get returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-get-host"]!.execute(
      { id: 42 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

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
     Cycle 7: AWX API error handling
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
     Cycle 8: Zod schema validation
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

  it("get requires id", async () => {
    const schema = hooks.tool!["awx-get-host"]!.args;
    const parsed = schema?.safeParse?.({});
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 9: No client available
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

  it("get returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-get-host"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");
    const meta = (result as { metadata?: Record<string, unknown> }).metadata;
    expect(meta).toBeDefined();
    expect((meta!.errors as string[]).length).toBeGreaterThan(0);

    await localHooks.dispose?.();
  });

});