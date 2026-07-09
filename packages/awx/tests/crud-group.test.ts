/**
 * Group CRUD Tool Integration Tests
 *
 * Tests for the awx-get-group, awx-create-group, awx-update-group, and
 * awx-delete-group tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

const MOCK_RAW_GROUP: Record<string, unknown> = {
  id: 15,
  name: "web-servers",
  description: "Web server group",
  variables: "---\nhttp_port: 80\n",
  created: "2025-02-10T10:00:00Z",
  modified: "2025-06-15T14:30:00Z",
  summary_fields: {
    inventory: { id: 5, name: "Production Servers" },
  },
};

const MOCK_RAW_GROUP_CREATED: Record<string, unknown> = {
  id: 88,
  name: "db-servers",
  description: "Database server group",
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

describe("Group CRUD tools", () => {
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

  it("registers awx-get-group tool", () => {
    expect(hooks.tool!["awx-get-group"]).toBeDefined();
  });

  it("registers awx-create-group tool", () => {
    expect(hooks.tool!["awx-create-group"]).toBeDefined();
  });

  it("registers awx-update-group tool", () => {
    expect(hooks.tool!["awx-update-group"]).toBeDefined();
  });

  it("registers awx-delete-group tool", () => {
    expect(hooks.tool!["awx-delete-group"]).toBeDefined();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Get group — success
     ══════════════════════════════════════════════════════════════ */

  it("gets group by id", async () => {
    mockFetchResponse(MOCK_RAW_GROUP);
    const result = await hooks.tool!["awx-get-group"]!.execute({ id: 15 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("group");
    expect(metadata.id).toBe(15);
  });

  it("get group calls GET /api/v2/groups/15/", async () => {
    mockFetchResponse(MOCK_RAW_GROUP);
    await hooks.tool!["awx-get-group"]!.execute({ id: 15 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/groups/15/",
      expect.any(Object),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Create group — success
     ══════════════════════════════════════════════════════════════ */

  it("creates group with name and inventory_id", async () => {
    mockFetchResponse(MOCK_RAW_GROUP_CREATED);
    const result = await hooks.tool!["awx-create-group"]!.execute(
      { name: "db-servers", inventory_id: 3 },
      mockToolContext(),
    );
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("group");
    expect(metadata.id).toBe(88);
  });

  it("create group calls POST /api/v2/groups/", async () => {
    mockFetchResponse(MOCK_RAW_GROUP_CREATED);
    await hooks.tool!["awx-create-group"]!.execute(
      { name: "db-servers", inventory_id: 3 },
      mockToolContext(),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/groups/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create group sends body with name and inventory", async () => {
    mockFetchResponse(MOCK_RAW_GROUP_CREATED);
    await hooks.tool!["awx-create-group"]!.execute(
      { name: "db-servers", inventory_id: 3 },
      mockToolContext(),
    );
    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("db-servers");
    expect(parsed.inventory).toBe(3);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Update group — success
     ══════════════════════════════════════════════════════════════ */

  it("updates group with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_GROUP, name: "web-servers-v2" });
    const result = await hooks.tool!["awx-update-group"]!.execute(
      { id: 15, name: "web-servers-v2" },
      mockToolContext(),
    );
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("group");
    expect(metadata.errors).toEqual([]);
  });

  it("update group calls PATCH /api/v2/groups/15/", async () => {
    mockFetchResponse(MOCK_RAW_GROUP);
    await hooks.tool!["awx-update-group"]!.execute({ id: 15, name: "updated" }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/groups/15/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Delete group — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes group with id", async () => {
    mockFetchResponse({});
    const result = await hooks.tool!["awx-delete-group"]!.execute({ id: 15 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("group");
    expect(metadata.data).toBeNull();
  });

  it("delete group calls DELETE /api/v2/groups/15/", async () => {
    mockFetchResponse({});
    await hooks.tool!["awx-delete-group"]!.execute({ id: 15 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/groups/15/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("get returns abort message when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await hooks.tool!["awx-get-group"]!.execute({ id: 15 }, mockToolContext({ abort: ctrl.signal }));
    expect((result as { output: string }).output).toContain("aborted");
  });

  it("create returns abort message when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await hooks.tool!["awx-create-group"]!.execute({ name: "Test", inventory_id: 1 }, mockToolContext({ abort: ctrl.signal }));
    expect((result as { output: string }).output).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await hooks.tool!["awx-delete-group"]!.execute({ id: 15 }, mockToolContext({ abort: ctrl.signal }));
    expect((result as { output: string }).output).toContain("aborted");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: API error handling
     ══════════════════════════════════════════════════════════════ */

  it("returns error when create gets API error", async () => {
    mockFetchResponse({ detail: "Bad request." }, 400);
    const result = await hooks.tool!["awx-create-group"]!.execute({ name: "Test", inventory_id: 1 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);
    const result = await hooks.tool!["awx-delete-group"]!.execute({ id: 99999 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: Zod schema validation
     ══════════════════════════════════════════════════════════════ */

  it("create rejects missing required name", () => {
    const parsed = hooks.tool!["awx-create-group"]!.args?.safeParse?.({ inventory_id: 1 });
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("create rejects missing required inventory_id", () => {
    const parsed = hooks.tool!["awx-create-group"]!.args?.safeParse?.({ name: "Test" });
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("delete requires id", () => {
    const parsed = hooks.tool!["awx-delete-group"]!.args?.safeParse?.({});
    if (parsed) expect(parsed.success).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 9: No client available
     ══════════════════════════════════════════════════════════════ */

  it("create returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    const result = await localHooks.tool!["awx-create-group"]!.execute({ name: "Test", inventory_id: 1 }, mockToolContext());
    expect((result as { output: string }).output).toContain("PAT");
    await localHooks.dispose?.();
  });

  it("get returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    const result = await localHooks.tool!["awx-get-group"]!.execute({ id: 42 }, mockToolContext());
    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");
    const meta = (result as { metadata?: Record<string, unknown> }).metadata;
    expect(meta).toBeDefined();
    expect((meta!.errors as string[]).length).toBeGreaterThan(0);
    await localHooks.dispose?.();
  });

});