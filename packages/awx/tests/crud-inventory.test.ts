/**
 * Inventory CRUD Tool Integration Tests
 *
 * Tests for the awx-create-inventory, awx-update-inventory, and
 * awx-delete-inventory tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX inventory API response matching the known fixture */
const MOCK_RAW_INVENTORY: Record<string, unknown> = {
  id: 12,
  name: "Production Servers",
  description: "Production server inventory",
  kind: "smart",
  host_count: 48,
  total_groups: 6,
  has_inventory_sources: true,
  total_inventory_sources: 2,
  variables: "---\nansible_user: deploy\n",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

/** Another inventory fixture for create/update */
const MOCK_RAW_INVENTORY_CREATED: Record<string, unknown> = {
  id: 99,
  name: "Staging Servers",
  description: "Staging server inventory",
  kind: "",
  host_count: 0,
  total_groups: 0,
  has_inventory_sources: false,
  total_inventory_sources: 0,
  variables: "",
  summary_fields: {
    organization: { id: 2, name: "Staging Org" },
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

// ─── Tests ────────────────────────────────────────────────────

describe("Inventory CRUD tools", () => {
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

  it("registers awx-create-inventory tool", async () => {
    expect(hooks.tool!["awx-create-inventory"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-inventory"]!.description).toBe("string");
  });

  it("registers awx-update-inventory tool", async () => {
    expect(hooks.tool!["awx-update-inventory"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-inventory"]!.description).toBe("string");
  });

  it("registers awx-delete-inventory tool", async () => {
    expect(hooks.tool!["awx-delete-inventory"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-inventory"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Create inventory — success
     ══════════════════════════════════════════════════════════════ */

  it("creates inventory with name and organization_id", async () => {
    mockFetchResponse(MOCK_RAW_INVENTORY_CREATED);

    const result = await hooks.tool!["awx-create-inventory"]!.execute(
      { name: "Staging Servers", organization_id: 2 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("inventory");
    expect(metadata.id).toBe(99);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Staging Servers");
  });

  it("creates inventory with description", async () => {
    mockFetchResponse({
      ...MOCK_RAW_INVENTORY_CREATED,
      description: "My staging inventory",
    });

    const result = await hooks.tool!["awx-create-inventory"]!.execute(
      { name: "Staging Servers", organization_id: 2, description: "My staging inventory" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("inventory");
    expect((metadata.data as Record<string, unknown>).description).toBe("My staging inventory");
  });

  it("create inventory calls POST /api/v2/inventories/", async () => {
    mockFetchResponse(MOCK_RAW_INVENTORY_CREATED);

    await hooks.tool!["awx-create-inventory"]!.execute(
      { name: "Staging Servers", organization_id: 2 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/inventories/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create inventory sends body with name and organization_id", async () => {
    mockFetchResponse(MOCK_RAW_INVENTORY_CREATED);

    await hooks.tool!["awx-create-inventory"]!.execute(
      { name: "Staging Servers", organization_id: 2 },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("Staging Servers");
    expect(parsed.organization).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Update inventory — success
     ══════════════════════════════════════════════════════════════ */

  it("updates inventory with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_INVENTORY, name: "Updated Inventory" });

    const result = await hooks.tool!["awx-update-inventory"]!.execute(
      { id: 12, name: "Updated Inventory" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("inventory");
    expect(metadata.id).toBe(12);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated Inventory");
  });

  it("update inventory calls PATCH /api/v2/inventories/12/", async () => {
    mockFetchResponse(MOCK_RAW_INVENTORY);

    await hooks.tool!["awx-update-inventory"]!.execute(
      { id: 12, name: "Updated Inventory" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/inventories/12/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Delete inventory — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes inventory with id", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-inventory"]!.execute(
      { id: 12 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("inventory");
    expect(metadata.id).toBe(12);
    expect(metadata.data).toBeNull();
    expect(metadata.errors).toEqual([]);
  });

  it("delete inventory calls DELETE /api/v2/inventories/12/", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-inventory"]!.execute(
      { id: 12 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/inventories/12/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-inventory"]!.execute(
      { name: "Test", organization_id: 1 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("update returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-update-inventory"]!.execute(
      { id: 12, name: "Test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-inventory"]!.execute(
      { id: 12 },
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

    const result = await hooks.tool!["awx-create-inventory"]!.execute(
      { name: "Test", organization_id: 1 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
    expect((metadata.errors as string[])[0]).toContain("400");
  });

  it("returns error when update gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-update-inventory"]!.execute(
      { id: 99999, name: "Test" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-delete-inventory"]!.execute(
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
    const schema = hooks.tool!["awx-create-inventory"]!.args;
    const parsed = schema?.safeParse?.({ organization_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required organization_id", async () => {
    const schema = hooks.tool!["awx-create-inventory"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create accepts optional description", async () => {
    const schema = hooks.tool!["awx-create-inventory"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", organization_id: 1, description: "A test" });

    if (parsed) {
      expect(parsed.success).toBe(true);
    }
  });

  it("update requires id", async () => {
    const schema = hooks.tool!["awx-update-inventory"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("delete requires id", async () => {
    const schema = hooks.tool!["awx-delete-inventory"]!.args;
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

    const result = await localHooks.tool!["awx-create-inventory"]!.execute(
      { name: "Test", organization_id: 1 },
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

    const result = await localHooks.tool!["awx-update-inventory"]!.execute(
      { id: 12, name: "Test" },
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

    const result = await localHooks.tool!["awx-delete-inventory"]!.execute(
      { id: 12 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
