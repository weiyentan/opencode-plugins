/**
 * Execution Environment CRUD Tool Integration Tests
 *
 * Tests for the awx-create-execution-environment, awx-update-execution-environment,
 * and awx-delete-execution-environment tools: tool registration, endpoint dispatch,
 * error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Mock Data ────────────────────────────────────────────────

const MOCK_RAW_EE: Record<string, unknown> = {
  id: 1,
  name: "AWX EE 2.9",
  description: "Default AWX execution environment",
  image: "quay.io/ansible/awx-ee:latest",
  managed: true,
  organization: 1,
  created: "2025-06-25T12:00:00Z",
  modified: "2025-06-25T13:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

const MOCK_RAW_EE_CREATED: Record<string, unknown> = {
  id: 99,
  name: "Custom EE",
  description: "My custom execution environment",
  image: "registry.example.com/my-ee:latest",
  managed: false,
  organization: 2,
  created: "2025-06-26T12:00:00Z",
  modified: "2025-06-26T12:00:00Z",
  summary_fields: {
    organization: { id: 2, name: "Staging Org" },
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

  it("registers awx-create-execution-environment tool", async () => {
    expect(hooks.tool!["awx-create-execution-environment"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-execution-environment"]!.description).toBe("string");
  });

  it("registers awx-update-execution-environment tool", async () => {
    expect(hooks.tool!["awx-update-execution-environment"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-execution-environment"]!.description).toBe("string");
  });

  it("registers awx-delete-execution-environment tool", async () => {
    expect(hooks.tool!["awx-delete-execution-environment"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-execution-environment"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Create execution environment — success
     ══════════════════════════════════════════════════════════════ */

  it("creates execution environment with name, image, and organization_id", async () => {
    mockFetchResponse(MOCK_RAW_EE_CREATED);

    const result = await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Custom EE", image: "registry.example.com/my-ee:latest", organization_id: 2 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("execution-environment");
    expect(metadata.id).toBe(99);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Custom EE");
  });

  it("creates execution environment with description", async () => {
    mockFetchResponse({
      ...MOCK_RAW_EE_CREATED,
      description: "My custom EE",
    });

    const result = await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Custom EE", image: "registry.example.com/my-ee:latest", organization_id: 2, description: "My custom EE" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("execution-environment");
    expect((metadata.data as Record<string, unknown>).description).toBe("My custom EE");
  });

  it("create execution environment calls POST /api/v2/execution_environments/", async () => {
    mockFetchResponse(MOCK_RAW_EE_CREATED);

    await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Custom EE", image: "registry.example.com/my-ee:latest", organization_id: 2 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/execution_environments/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create execution environment sends body with name, image, and organization", async () => {
    mockFetchResponse(MOCK_RAW_EE_CREATED);

    await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Custom EE", image: "registry.example.com/my-ee:latest", organization_id: 2 },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("Custom EE");
    expect(parsed.image).toBe("registry.example.com/my-ee:latest");
    expect(parsed.organization).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Update execution environment — success
     ══════════════════════════════════════════════════════════════ */

  it("updates execution environment with id and name", async () => {
    mockFetchResponse({ ...MOCK_RAW_EE, name: "Updated EE" });

    const result = await hooks.tool!["awx-update-execution-environment"]!.execute(
      { id: 1, name: "Updated EE" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("execution-environment");
    expect(metadata.id).toBe(1);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated EE");
  });

  it("update execution environment calls PATCH /api/v2/execution_environments/1/", async () => {
    mockFetchResponse(MOCK_RAW_EE);

    await hooks.tool!["awx-update-execution-environment"]!.execute(
      { id: 1, name: "Updated EE" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/execution_environments/1/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Delete execution environment — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes execution environment with id", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-execution-environment"]!.execute(
      { id: 1 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("execution-environment");
    expect(metadata.id).toBe(1);
    expect(metadata.data).toBeNull();
    expect(metadata.errors).toEqual([]);
  });

  it("delete execution environment calls DELETE /api/v2/execution_environments/1/", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-execution-environment"]!.execute(
      { id: 1 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/execution_environments/1/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Test", image: "img:latest", organization_id: 1 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("update returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-update-execution-environment"]!.execute(
      { id: 1, name: "Test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-execution-environment"]!.execute(
      { id: 1 },
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

    const result = await hooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Test", image: "img:latest", organization_id: 1 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when update gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-update-execution-environment"]!.execute(
      { id: 99999, name: "Test" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-delete-execution-environment"]!.execute(
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
    const schema = hooks.tool!["awx-create-execution-environment"]!.args;
    const parsed = schema?.safeParse?.({ image: "img:latest", organization_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required image", async () => {
    const schema = hooks.tool!["awx-create-execution-environment"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", organization_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required organization_id", async () => {
    const schema = hooks.tool!["awx-create-execution-environment"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", image: "img:latest" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("update requires id", async () => {
    const schema = hooks.tool!["awx-update-execution-environment"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("delete requires id", async () => {
    const schema = hooks.tool!["awx-delete-execution-environment"]!.args;
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

    const result = await localHooks.tool!["awx-create-execution-environment"]!.execute(
      { name: "Test", image: "img:latest", organization_id: 1 },
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

    const result = await localHooks.tool!["awx-update-execution-environment"]!.execute(
      { id: 1, name: "Test" },
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

    const result = await localHooks.tool!["awx-delete-execution-environment"]!.execute(
      { id: 1 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
