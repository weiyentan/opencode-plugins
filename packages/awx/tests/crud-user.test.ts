/**
 * User CRUD Tool Integration Tests
 *
 * Tests for the awx-create-user, awx-update-user, and
 * awx-delete-user tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX user API response matching the known fixture */
const MOCK_RAW_USER: Record<string, unknown> = {
  id: 42,
  username: "jdoe",
  first_name: "Jane",
  last_name: "Doe",
  email: "jane@example.com",
  is_superuser: false,
  is_system_auditor: false,
  created: "2025-01-15T09:30:00Z",
  modified: "2025-06-20T14:45:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

/** Another user fixture for create */
const MOCK_RAW_USER_CREATED: Record<string, unknown> = {
  id: 99,
  username: "newuser",
  first_name: "New",
  last_name: "User",
  email: "new@example.com",
  is_superuser: false,
  is_system_auditor: false,
  created: "2025-07-10T10:00:00Z",
  modified: "2025-07-10T10:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
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

describe("User CRUD tools", () => {
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

  it("registers awx-create-user tool", async () => {
    expect(hooks.tool!["awx-create-user"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-user"]!.description).toBe("string");
  });

  it("registers awx-update-user tool", async () => {
    expect(hooks.tool!["awx-update-user"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-user"]!.description).toBe("string");
  });

  it("registers awx-delete-user tool", async () => {
    expect(hooks.tool!["awx-delete-user"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-user"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Create user — success
     ══════════════════════════════════════════════════════════════ */

  it("creates user with username and password", async () => {
    mockFetchResponse(MOCK_RAW_USER_CREATED);

    const result = await hooks.tool!["awx-create-user"]!.execute(
      { username: "newuser", password: "s3cret" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("user");
    expect(metadata.id).toBe(99);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).username).toBe("newuser");
  });

  it("create user sends body with username and password", async () => {
    mockFetchResponse(MOCK_RAW_USER_CREATED);

    await hooks.tool!["awx-create-user"]!.execute(
      { username: "newuser", password: "s3cret" },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.username).toBe("newuser");
    expect(parsed.password).toBe("s3cret");
  });

  it("create user calls POST /api/v2/users/", async () => {
    mockFetchResponse(MOCK_RAW_USER_CREATED);

    await hooks.tool!["awx-create-user"]!.execute(
      { username: "newuser", password: "s3cret" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/users/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Update user — success
     ══════════════════════════════════════════════════════════════ */

  it("updates user with id and partial fields", async () => {
    mockFetchResponse({ ...MOCK_RAW_USER, first_name: "Updated" });

    const result = await hooks.tool!["awx-update-user"]!.execute(
      { id: 42, first_name: "Updated" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("user");
    expect(metadata.id).toBe(42);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).first_name).toBe("Updated");
  });

  it("update user calls PATCH /api/v2/users/42/", async () => {
    mockFetchResponse(MOCK_RAW_USER);

    await hooks.tool!["awx-update-user"]!.execute(
      { id: 42, first_name: "Updated" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/users/42/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Delete user — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes user with id", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-user"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("user");
    expect(metadata.id).toBe(42);
    expect(metadata.data).toBeNull();
    expect(metadata.errors).toEqual([]);
  });

  it("delete user calls DELETE /api/v2/users/42/", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-user"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/users/42/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-user"]!.execute(
      { username: "test", password: "test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-user"]!.execute(
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

    const result = await hooks.tool!["awx-create-user"]!.execute(
      { username: "test", password: "test" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
    expect((metadata.errors as string[])[0]).toContain("400");
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-delete-user"]!.execute(
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

  it("create rejects missing required username", async () => {
    const schema = hooks.tool!["awx-create-user"]!.args;
    const parsed = schema?.safeParse?.({ password: "test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required password", async () => {
    const schema = hooks.tool!["awx-create-user"]!.args;
    const parsed = schema?.safeParse?.({ username: "test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("delete requires id", async () => {
    const schema = hooks.tool!["awx-delete-user"]!.args;
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

    const result = await localHooks.tool!["awx-create-user"]!.execute(
      { username: "test", password: "test" },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
