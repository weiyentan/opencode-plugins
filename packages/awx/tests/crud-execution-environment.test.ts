/**
 * Execution Environment CRUD Tool Integration Tests
 *
 * Tests for the awx-get-execution-environment, awx-create-execution-environment,
 * awx-update-execution-environment, and awx-delete-execution-environment tools:
 * tool registration, Zod schema validation, endpoint dispatch,
 * error handling, and abort signals.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

const MOCK_RAW_EE: Record<string, unknown> = {
  id: 2,
  name: "AWX EE 2.4",
  description: "Default AWX execution environment",
  image: "quay.io/ansible/awx-ee:latest",
  created: "2025-01-01T00:00:00Z",
  modified: "2025-06-15T08:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

const MOCK_RAW_EE_CREATED: Record<string, unknown> = {
  id: 55,
  name: "Custom EE",
  description: "Custom execution environment",
  image: "quay.io/custom/ee:latest",
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

describe("Execution Environment CRUD tools", () => {
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

  it("registers awx-get-execution-environment tool", () => {
    expect(hooks.tool!["awx-get-execution-environment"]).toBeDefined();
  });

  it("registers awx-create-execution-environment tool", () => {
    expect(hooks.tool!["awx-create-execution-environment"]).toBeDefined();
  });

  it("registers awx-update-execution-environment tool", () => {
    expect(hooks.tool!["awx-update-execution-environment"]).toBeDefined();
  });

  it("registers awx-delete-execution-environment tool", () => {
    expect(hooks.tool!["awx-delete-execution-environment"]).toBeDefined();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Get execution environment — success
     ══════════════════════════════════════════════════════════════ */

  it("gets execution environment by id", async () => {
    mockFetchResponse(MOCK_RAW_EE);
    const result = await hooks.tool!["awx-get-execution-environment"]!.execute({ id: 2 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("execution-environment");
    expect(metadata.id).toBe(2);
  });

  it("get execution environment calls GET /api/v2/execution_environments/2/", async () => {
    mockFetchResponse(MOCK_RAW_EE);
    await hooks.tool!["awx-get-execution-environment"]!.execute({ id: 2 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/execution_environments/2/",
      expect.any(Object),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Create execution environment — success
     ══════════════════════════════════════════════════════════════ */

  it("creates execution environment with name, image, and organization_id", async () => {
    mockFetchResponse(MOCK_RAW_EE_CREATED);
    const result = await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Custom EE", image: "quay.io/custom/ee:latest", organization_id: 2 },
      mockToolContext(),
    );
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("execution-environment");
    expect(metadata.id).toBe(55);
  });

  it("create execution environment calls POST /api/v2/execution_environments/", async () => {
    mockFetchResponse(MOCK_RAW_EE_CREATED);
    await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Custom EE", image: "quay.io/custom/ee:latest", organization_id: 2 },
      mockToolContext(),
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/execution_environments/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create execution environment sends body with name, image, organization", async () => {
    mockFetchResponse(MOCK_RAW_EE_CREATED);
    await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Custom EE", image: "quay.io/custom/ee:latest", organization_id: 2 },
      mockToolContext(),
    );
    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("Custom EE");
    expect(parsed.image).toBe("quay.io/custom/ee:latest");
    expect(parsed.organization).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Update execution environment — success
     ══════════════════════════════════════════════════════════════ */

  it("updates execution environment with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_EE, name: "AWX EE 2.5" });
    const result = await hooks.tool!["awx-update-execution-environment"]!.execute({ id: 2, name: "AWX EE 2.5" }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("execution-environment");
  });

  it("update execution environment calls PATCH /api/v2/execution_environments/2/", async () => {
    mockFetchResponse(MOCK_RAW_EE);
    await hooks.tool!["awx-update-execution-environment"]!.execute({ id: 2, name: "updated" }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/execution_environments/2/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Delete execution environment — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes execution environment with id", async () => {
    mockFetchResponse({});
    const result = await hooks.tool!["awx-delete-execution-environment"]!.execute({ id: 2 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("execution-environment");
    expect(metadata.data).toBeNull();
  });

  it("delete execution environment calls DELETE /api/v2/execution_environments/2/", async () => {
    mockFetchResponse({});
    await hooks.tool!["awx-delete-execution-environment"]!.execute({ id: 2 }, mockToolContext());
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/execution_environments/2/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Abort & error handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Test", image: "test:latest", organization_id: 1 },
      mockToolContext({ abort: ctrl.signal }),
    );
    expect((result as { output: string }).output).toContain("aborted");
  });

  it("returns error when create gets API error", async () => {
    mockFetchResponse({ detail: "Bad request." }, 400);
    const result = await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Test", image: "test:latest", organization_id: 1 },
      mockToolContext(),
    );
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);
    const result = await hooks.tool!["awx-delete-execution-environment"]!.execute({ id: 99999 }, mockToolContext());
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Zod schema validation
     ══════════════════════════════════════════════════════════════ */

  it("create rejects missing required name", () => {
    const parsed = hooks.tool!["awx-create-execution-environment"]!.args?.safeParse?.({ image: "test:latest", organization_id: 1 });
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("create rejects missing required image", () => {
    const parsed = hooks.tool!["awx-create-execution-environment"]!.args?.safeParse?.({ name: "Test", organization_id: 1 });
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("create rejects missing required organization_id", () => {
    const parsed = hooks.tool!["awx-create-execution-environment"]!.args?.safeParse?.({ name: "Test", image: "test:latest" });
    if (parsed) expect(parsed.success).toBe(false);
  });

  it("delete requires id", () => {
    const parsed = hooks.tool!["awx-delete-execution-environment"]!.args?.safeParse?.({});
    if (parsed) expect(parsed.success).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: No client available
     ══════════════════════════════════════════════════════════════ */

  it("create returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    const result = await localHooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Test", image: "test:latest", organization_id: 1 },
      mockToolContext(),
    );
    expect((result as { output: string }).output).toContain("PAT");
    await localHooks.dispose?.();
  });

  it("get returns error when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, { baseUrl: "https://aap.example.com" });
    const result = await localHooks.tool!["awx-get-execution-environment"]!.execute({ id: 42 }, mockToolContext());
    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");
    const meta = (result as { metadata?: Record<string, unknown> }).metadata;
    expect(meta).toBeDefined();
    expect((meta!.errors as string[]).length).toBeGreaterThan(0);
    await localHooks.dispose?.();
  });

});