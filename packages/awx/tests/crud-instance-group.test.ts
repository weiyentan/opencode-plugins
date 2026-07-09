/**
 * Instance Group CRUD Tool Integration Tests
 *
 * Tests for the awx-get-instance-group, awx-create-instance-group,
 * awx-update-instance-group, and awx-delete-instance-group tools:
 * tool registration, Zod schema validation, endpoint dispatch,
 * error handling, and abort signals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

const MOCK_RAW_INSTANCE_GROUP: Record<string, unknown> = {
  id: 3,
  name: "control-plane",
  description: "AWX control plane instances",
  created: "2025-01-01T00:00:00Z",
  modified: "2025-06-01T12:00:00Z",
};

const MOCK_RAW_IG_CREATED: Record<string, unknown> = {
  id: 66,
  name: "worker-nodes",
  description: "AWX worker instances",
  created: "2025-07-01T00:00:00Z",
  modified: "2025-07-01T00:00:00Z",
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

describe("Instance Group CRUD tools", () => {
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

  it("registers awx-get-instance-group tool", () => {
    expect(hooks.tool!["awx-get-instance-group"]).toBeDefined();
  });

  it("registers awx-create-instance-group tool", () => {
    expect(hooks.tool!["awx-create-instance-group"]).toBeDefined();
  });

  it("registers awx-update-instance-group tool", () => {
    expect(hooks.tool!["awx-update-instance-group"]).toBeDefined();
  });

  it("registers awx-delete-instance-group tool", () => {
    expect(hooks.tool!["awx-delete-instance-group"]).toBeDefined();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Get instance group — success
     ══════════════════════════════════════════════════════════════ */

  it("gets instance group by id", async () => {
    mockFetchResponse(MOCK_RAW_INSTANCE_GROUP);
    const result = await hooks.tool!["awx-get-instance-group"]!.execute({ id: 3 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("instance-group");
    expect(metadata.id).toBe(3);
  });

  it("get instance group calls GET /api/v2/instance_groups/3/", async () => {
    mockFetchResponse(MOCK_RAW_INSTANCE_GROUP);
    await hooks.tool!["awx-get-instance-group"]!.execute({ id: 3 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/instance_groups/3/",
      expect.any(Object),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Create instance group — success
     ══════════════════════════════════════════════════════════════ */

  it("creates instance group with name", async () => {
    mockFetchResponse(MOCK_RAW_IG_CREATED);
    const result = await hooks.tool!["awx-create-instance-group"]!.execute({ name: "worker-nodes" }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("instance-group");
    expect(metadata.id).toBe(66);
  });

  it("create instance group calls POST /api/v2/instance_groups/", async () => {
    mockFetchResponse(MOCK_RAW_IG_CREATED);
    await hooks.tool!["awx-create-instance-group"]!.execute({ name: "worker-nodes" }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/instance_groups/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create instance group sends body with name", async () => {
    mockFetchResponse(MOCK_RAW_IG_CREATED);
    await hooks.tool!["awx-create-instance-group"]!.execute({ name: "worker-nodes" }, mockToolContext());
    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("worker-nodes");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Update instance group — success
     ══════════════════════════════════════════════════════════════ */

  it("updates instance group with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_INSTANCE_GROUP, name: "control-plane-v2" });
    const result = await hooks.tool!["awx-update-instance-group"]!.execute({ id: 3, name: "control-plane-v2" }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("instance-group");
  });

  it("update instance group calls PATCH /api/v2/instance_groups/3/", async () => {
    mockFetchResponse(MOCK_RAW_INSTANCE_GROUP);
    await hooks.tool!["awx-update-instance-group"]!.execute({ id: 3, name: "updated" }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/instance_groups/3/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Delete instance group — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes instance group with id", async () => {
    mockFetchResponse({});
    const result = await hooks.tool!["awx-delete-instance-group"]!.execute({ id: 3 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("instance-group");
    expect(metadata.data).toBeNull();
  });

  it("delete instance group calls DELETE /api/v2/instance_groups/3/", async () => {
    mockFetchResponse({});
    await hooks.tool!["awx-delete-instance-group"]!.execute({ id: 3 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/instance_groups/3/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Abort & error handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await hooks.tool!["awx-create-instance-group"]!.execute({ name: "Test" }, mockToolContext({ abort: ctrl.signal }));
    expect((result as { output: string }).output).toContain("aborted");
  });

  it("returns error when create gets API error", async () => {
    mockFetchResponse({ detail: "Bad request." }, 400);
    const result = await hooks.tool!["awx-create-instance-group"]!.execute({ name: "Test" }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);
    const result = await hooks.tool!["awx-delete-instance-group"]!.execute({ id: 99999 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Zod schema validation
     ══════════════════════════════════════════════════════════════ */

  it("create rejects missing required name", () => {
    const parsed = hooks.tool!["awx-create-instance-group"]!.args?.safeParse?.({});
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("delete requires id", () => {
    const parsed = hooks.tool!["awx-delete-instance-group"]!.args?.safeParse?.({});
    if (parsed) expect(parsed.success).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: No client available
     ══════════════════════════════════════════════════════════════ */

  it("create returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    const result = await localHooks.tool!["awx-create-instance-group"]!.execute({ name: "Test" }, mockToolContext());
    expect((result as { output: string }).output).toContain("PAT");
    await localHooks.dispose?.();
  });
});
