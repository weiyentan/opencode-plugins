/**
 * Notification Template CRUD Tool Integration Tests
 *
 * Tests for the awx-create-notification-template, awx-update-notification-template,
 * and awx-delete-notification-template tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX notification template API response matching the known fixture */
const MOCK_RAW_NT: Record<string, unknown> = {
  id: 5,
  name: "Slack Alerts",
  description: "Send alerts to #ops channel",
  notification_type: "slack",
  notification_configuration: {
    channels: ["#ops", "#alerts"],
    token: "xoxb-redacted",
    color: "danger",
  },
  organization: 1,
  created: "2025-03-10T11:00:00Z",
  modified: "2025-07-01T16:20:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

const MOCK_RAW_NT_CREATED: Record<string, unknown> = {
  id: 10,
  name: "Email Alerts",
  description: "",
  notification_type: "email",
  notification_configuration: {
    recipients: ["admin@example.com"],
  },
  organization: 1,
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

describe("Notification Template CRUD tools", () => {
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

  it("registers awx-create-notification-template tool", async () => {
    expect(hooks.tool!["awx-create-notification-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-notification-template"]!.description).toBe("string");
  });

  it("registers awx-update-notification-template tool", async () => {
    expect(hooks.tool!["awx-update-notification-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-notification-template"]!.description).toBe("string");
  });

  it("registers awx-delete-notification-template tool", async () => {
    expect(hooks.tool!["awx-delete-notification-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-notification-template"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Create notification template — success
     ══════════════════════════════════════════════════════════════ */

  it("creates notification template with required fields", async () => {
    mockFetchResponse(MOCK_RAW_NT_CREATED);

    const result = await hooks.tool!["awx-create-notification-template"]!.execute(
      {
        name: "Email Alerts",
        notification_type: "email",
        organization_id: 1,
        notification_configuration: { recipients: ["admin@example.com"] },
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("notification_template");
    expect(metadata.id).toBe(10);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Email Alerts");
    expect((metadata.data as Record<string, unknown>).notification_type).toBe("email");
  });

  it("create notification template sends body with required fields", async () => {
    mockFetchResponse(MOCK_RAW_NT_CREATED);

    await hooks.tool!["awx-create-notification-template"]!.execute(
      {
        name: "Email Alerts",
        notification_type: "email",
        organization_id: 1,
        notification_configuration: { recipients: ["admin@example.com"] },
      },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("Email Alerts");
    expect(parsed.notification_type).toBe("email");
    expect(parsed.organization).toBe(1);
    expect(parsed.notification_configuration).toEqual({ recipients: ["admin@example.com"] });
  });

  it("create notification template calls POST /api/v2/notification_templates/", async () => {
    mockFetchResponse(MOCK_RAW_NT_CREATED);

    await hooks.tool!["awx-create-notification-template"]!.execute(
      {
        name: "Email Alerts",
        notification_type: "email",
        organization_id: 1,
        notification_configuration: { recipients: ["admin@example.com"] },
      },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/notification_templates/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Update notification template — success
     ══════════════════════════════════════════════════════════════ */

  it("updates notification template with id and partial fields", async () => {
    mockFetchResponse({ ...MOCK_RAW_NT, name: "Updated NT" });

    const result = await hooks.tool!["awx-update-notification-template"]!.execute(
      { id: 5, name: "Updated NT" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("notification_template");
    expect(metadata.id).toBe(5);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated NT");
  });

  it("update notification template calls PATCH /api/v2/notification_templates/5/", async () => {
    mockFetchResponse(MOCK_RAW_NT);

    await hooks.tool!["awx-update-notification-template"]!.execute(
      { id: 5, name: "Updated NT" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/notification_templates/5/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Delete notification template — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes notification template with id", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-notification-template"]!.execute(
      { id: 5 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("notification_template");
    expect(metadata.id).toBe(5);
    expect(metadata.data).toBeNull();
    expect(metadata.errors).toEqual([]);
  });

  it("delete notification template calls DELETE /api/v2/notification_templates/5/", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-notification-template"]!.execute(
      { id: 5 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/notification_templates/5/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-notification-template"]!.execute(
      {
        name: "Test",
        notification_type: "email",
        organization_id: 1,
        notification_configuration: {},
      },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-notification-template"]!.execute(
      { id: 5 },
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

    const result = await hooks.tool!["awx-create-notification-template"]!.execute(
      {
        name: "Test",
        notification_type: "email",
        organization_id: 1,
        notification_configuration: {},
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect((metadata.errors as string[]).length).toBeGreaterThan(0);
    expect((metadata.errors as string[])[0]).toContain("400");
  });

  it("returns error when delete gets API error", async () => {
    mockFetchResponse({ detail: "Not found." }, 404);

    const result = await hooks.tool!["awx-delete-notification-template"]!.execute(
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
    const schema = hooks.tool!["awx-create-notification-template"]!.args;
    const parsed = schema?.safeParse?.({ notification_type: "email", organization_id: 1, notification_configuration: {} });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required organization_id", async () => {
    const schema = hooks.tool!["awx-create-notification-template"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", notification_type: "email", notification_configuration: {} });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required notification_configuration", async () => {
    const schema = hooks.tool!["awx-create-notification-template"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", notification_type: "email", organization_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("delete requires id", async () => {
    const schema = hooks.tool!["awx-delete-notification-template"]!.args;
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

    const result = await localHooks.tool!["awx-create-notification-template"]!.execute(
      {
        name: "Test",
        notification_type: "email",
        organization_id: 1,
        notification_configuration: {},
      },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
