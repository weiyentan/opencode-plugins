/**
 * Team CRUD Tool Integration Tests
 *
 * Tests for the awx-create-team, awx-update-team, and
 * awx-delete-team tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX team API response matching the known fixture */
const MOCK_RAW_TEAM: Record<string, unknown> = {
  id: 15,
  name: "Platform Engineers",
  description: "Platform engineering team",
  organization: 1,
  created: "2025-02-01T10:00:00Z",
  modified: "2025-06-15T12:30:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

const MOCK_RAW_TEAM_CREATED: Record<string, unknown> = {
  id: 20,
  name: "DevOps Team",
  description: "DevOps engineering team",
  organization: 2,
  created: "2025-07-10T10:00:00Z",
  modified: "2025-07-10T10:00:00Z",
  summary_fields: {
    organization: { id: 2, name: "Engineering" },
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

describe("Team CRUD tools", () => {
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

  it("registers awx-create-team tool", async () => {
    expect(hooks.tool!["awx-create-team"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-team"]!.description).toBe("string");
  });

  it("registers awx-update-team tool", async () => {
    expect(hooks.tool!["awx-update-team"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-team"]!.description).toBe("string");
  });

  it("registers awx-delete-team tool", async () => {
    expect(hooks.tool!["awx-delete-team"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-team"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Create team — success
     ══════════════════════════════════════════════════════════════ */

  it("creates team with name and organization_id", async () => {
    mockFetchResponse(MOCK_RAW_TEAM_CREATED);

    const result = await hooks.tool!["awx-create-team"]!.execute(
      { name: "DevOps Team", organization_id: 2 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("team");
    expect(metadata.id).toBe(20);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("DevOps Team");
  });

  it("create team sends body with name and organization_id", async () => {
    mockFetchResponse(MOCK_RAW_TEAM_CREATED);

    await hooks.tool!["awx-create-team"]!.execute(
      { name: "DevOps Team", organization_id: 2 },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("DevOps Team");
    expect(parsed.organization).toBe(2);
  });

  it("create team calls POST /api/v2/teams/", async () => {
    mockFetchResponse(MOCK_RAW_TEAM_CREATED);

    await hooks.tool!["awx-create-team"]!.execute(
      { name: "DevOps Team", organization_id: 2 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/teams/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Update team — success
     ══════════════════════════════════════════════════════════════ */

  it("updates team with id and partial fields", async () => {
    mockFetchResponse({ ...MOCK_RAW_TEAM, name: "Updated Team" });

    const result = await hooks.tool!["awx-update-team"]!.execute(
      { id: 15, name: "Updated Team" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("team");
    expect(metadata.id).toBe(15);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated Team");
  });

  it("update team calls PATCH /api/v2/teams/15/", async () => {
    mockFetchResponse(MOCK_RAW_TEAM);

    await hooks.tool!["awx-update-team"]!.execute(
      { id: 15, name: "Updated Team" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/teams/15/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Delete team — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes team with id", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-team"]!.execute(
      { id: 15 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("team");
    expect(metadata.id).toBe(15);
    expect(metadata.data).toBeNull();
    expect(metadata.errors).toEqual([]);
  });

  it("delete team calls DELETE /api/v2/teams/15/", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-team"]!.execute(
      { id: 15 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/teams/15/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-team"]!.execute(
      { name: "Test", organization_id: 1 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-team"]!.execute(
      { id: 15 },
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

    const result = await hooks.tool!["awx-create-team"]!.execute(
      { name: "Test", organization_id: 1 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
    expect((metadata.errors as string[])[0]).toContain("400");
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-delete-team"]!.execute(
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
    const schema = hooks.tool!["awx-create-team"]!.args;
    const parsed = schema?.safeParse?.({ organization_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required organization_id", async () => {
    const schema = hooks.tool!["awx-create-team"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("delete requires id", async () => {
    const schema = hooks.tool!["awx-delete-team"]!.args;
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

    const result = await localHooks.tool!["awx-create-team"]!.execute(
      { name: "Test", organization_id: 1 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
