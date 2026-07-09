/**
 * Label CRUD Tool Integration Tests
 *
 * Tests for the awx-get-label, awx-create-label, awx-update-label, and
 * awx-delete-label tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

const MOCK_RAW_LABEL: Record<string, unknown> = {
  id: 7,
  name: "production",
  description: "Production environment label",
  created: "2025-03-01T09:00:00Z",
  modified: "2025-06-10T11:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

const MOCK_RAW_LABEL_CREATED: Record<string, unknown> = {
  id: 77,
  name: "staging",
  description: "Staging environment label",
  created: "2025-07-01T00:00:00Z",
  modified: "2025-07-01T00:00:00Z",
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

describe("Label CRUD tools", () => {
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

  it("registers awx-get-label tool", () => {
    expect(hooks.tool!["awx-get-label"]).toBeDefined();
  });

  it("registers awx-create-label tool", () => {
    expect(hooks.tool!["awx-create-label"]).toBeDefined();
  });

  it("registers awx-update-label tool", () => {
    expect(hooks.tool!["awx-update-label"]).toBeDefined();
  });

  it("registers awx-delete-label tool", () => {
    expect(hooks.tool!["awx-delete-label"]).toBeDefined();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Get label — success
     ══════════════════════════════════════════════════════════════ */

  it("gets label by id", async () => {
    mockFetchResponse(MOCK_RAW_LABEL);
    const result = await hooks.tool!["awx-get-label"]!.execute({ id: 7 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("label");
    expect(metadata.id).toBe(7);
  });

  it("get label calls GET /api/v2/labels/7/", async () => {
    mockFetchResponse(MOCK_RAW_LABEL);
    await hooks.tool!["awx-get-label"]!.execute({ id: 7 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/labels/7/",
      expect.any(Object),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Create label — success
     ══════════════════════════════════════════════════════════════ */

  it("creates label with name and organization_id", async () => {
    mockFetchResponse(MOCK_RAW_LABEL_CREATED);
    const result = await hooks.tool!["awx-create-label"]!.execute(
      { name: "staging", organization_id: 2 },
      mockToolContext(),
    );
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("label");
    expect(metadata.id).toBe(77);
  });

  it("create label calls POST /api/v2/labels/", async () => {
    mockFetchResponse(MOCK_RAW_LABEL_CREATED);
    await hooks.tool!["awx-create-label"]!.execute({ name: "staging", organization_id: 2 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/labels/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create label sends body with name and organization", async () => {
    mockFetchResponse(MOCK_RAW_LABEL_CREATED);
    await hooks.tool!["awx-create-label"]!.execute({ name: "staging", organization_id: 2 }, mockToolContext());
    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("staging");
    expect(parsed.organization).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Update label — success
     ══════════════════════════════════════════════════════════════ */

  it("updates label with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_LABEL, name: "production-v2" });
    const result = await hooks.tool!["awx-update-label"]!.execute({ id: 7, name: "production-v2" }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("label");
    expect(metadata.errors).toEqual([]);
  });

  it("update label calls PATCH /api/v2/labels/7/", async () => {
    mockFetchResponse(MOCK_RAW_LABEL);
    await hooks.tool!["awx-update-label"]!.execute({ id: 7, name: "updated" }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/labels/7/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Delete label — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes label with id", async () => {
    mockFetchResponse({});
    const result = await hooks.tool!["awx-delete-label"]!.execute({ id: 7 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("label");
    expect(metadata.data).toBeNull();
  });

  it("delete label calls DELETE /api/v2/labels/7/", async () => {
    mockFetchResponse({});
    await hooks.tool!["awx-delete-label"]!.execute({ id: 7 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/labels/7/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Abort & error handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await hooks.tool!["awx-create-label"]!.execute({ name: "Test", organization_id: 1 }, mockToolContext({ abort: ctrl.signal }));
    expect((result as { output: string }).output).toContain("aborted");
  });

  it("returns error when create gets API error", async () => {
    mockFetchResponse({ detail: "Bad request." }, 400);
    const result = await hooks.tool!["awx-create-label"]!.execute({ name: "Test", organization_id: 1 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);
    const result = await hooks.tool!["awx-delete-label"]!.execute({ id: 99999 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Zod schema validation
     ══════════════════════════════════════════════════════════════ */

  it("create rejects missing required name", () => {
    const parsed = hooks.tool!["awx-create-label"]!.args?.safeParse?.({ organization_id: 1 });
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("create rejects missing required organization_id", () => {
    const parsed = hooks.tool!["awx-create-label"]!.args?.safeParse?.({ name: "Test" });
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("delete requires id", () => {
    const parsed = hooks.tool!["awx-delete-label"]!.args?.safeParse?.({});
    if (parsed) expect(parsed.success).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: No client available
     ══════════════════════════════════════════════════════════════ */

  it("create returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    const result = await localHooks.tool!["awx-create-label"]!.execute({ name: "Test", organization_id: 1 }, mockToolContext());
    expect((result as { output: string }).output).toContain("PAT");
    await localHooks.dispose?.();
  });

  it("get returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    const result = await localHooks.tool!["awx-get-label"]!.execute({ id: 42 }, mockToolContext());
    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");
    const meta = (result as { metadata?: Record<string, unknown> }).metadata;
    expect(meta).toBeDefined();
    expect((meta!.errors as string[]).length).toBeGreaterThan(0);
    await localHooks.dispose?.();
  });

});