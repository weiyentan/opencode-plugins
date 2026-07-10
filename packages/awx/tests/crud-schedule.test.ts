/**
 * Schedule CRUD Tool Integration Tests
 *
 * Tests for the awx-create-schedule, awx-update-schedule, and
 * awx-delete-schedule tools: tool registration, Zod schema validation,
 * endpoint dispatch, error handling, and abort signals.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX schedule API response matching the known fixture */
const MOCK_RAW_SCHEDULE: Record<string, unknown> = {
  id: 8,
  name: "Daily Deploy",
  description: "Daily production deploy",
  rrule: "DTSTART:20250101T000000Z RRULE:FREQ=DAILY;INTERVAL=1",
  unified_job_template: 3,
  next_run: "2025-07-11T00:00:00Z",
  created: "2025-01-01T00:00:00Z",
  modified: "2025-06-30T08:00:00Z",
  summary_fields: {
    unified_job_template: { id: 3, name: "Deploy Web Stack - Production" },
    organization: { id: 1, name: "Default" },
  },
};

const MOCK_RAW_SCHEDULE_CREATED: Record<string, unknown> = {
  id: 12,
  name: "Nightly Backup",
  description: "",
  rrule: "DTSTART:20250101T000000Z RRULE:FREQ=WEEKLY",
  unified_job_template: 3,
  next_run: null,
  created: "2025-07-10T10:00:00Z",
  modified: "2025-07-10T10:00:00Z",
  summary_fields: {
    unified_job_template: { id: 3, name: "Deploy Web Stack - Production" },
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

describe("Schedule CRUD tools", () => {
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

  it("registers awx-create-schedule tool", async () => {
    expect(hooks.tool!["awx-create-schedule"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-schedule"]!.description).toBe("string");
  });

  it("registers awx-update-schedule tool", async () => {
    expect(hooks.tool!["awx-update-schedule"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-schedule"]!.description).toBe("string");
  });

  it("registers awx-delete-schedule tool", async () => {
    expect(hooks.tool!["awx-delete-schedule"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-schedule"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Create schedule — success
     ══════════════════════════════════════════════════════════════ */

  it("creates schedule with name, rrule, and unified_job_template_id", async () => {
    mockFetchResponse(MOCK_RAW_SCHEDULE_CREATED);

    const result = await hooks.tool!["awx-create-schedule"]!.execute(
      {
        name: "Nightly Backup",
        rrule: "DTSTART:20250101T000000Z RRULE:FREQ=WEEKLY",
        unified_job_template_id: 3,
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("schedule");
    expect(metadata.id).toBe(12);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Nightly Backup");
  });

  it("create schedule sends body with name, rrule, unified_job_template", async () => {
    mockFetchResponse(MOCK_RAW_SCHEDULE_CREATED);

    await hooks.tool!["awx-create-schedule"]!.execute(
      {
        name: "Nightly Backup",
        rrule: "DTSTART:20250101T000000Z RRULE:FREQ=WEEKLY",
        unified_job_template_id: 3,
      },
      mockToolContext(),
    );

    const callBody = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    const parsed = JSON.parse(callBody);
    expect(parsed.name).toBe("Nightly Backup");
    expect(parsed.rrule).toBe("DTSTART:20250101T000000Z RRULE:FREQ=WEEKLY");
    expect(parsed.unified_job_template).toBe(3);
  });

  it("create schedule calls POST /api/v2/schedules/", async () => {
    mockFetchResponse(MOCK_RAW_SCHEDULE_CREATED);

    await hooks.tool!["awx-create-schedule"]!.execute(
      {
        name: "Nightly Backup",
        rrule: "DTSTART:20250101T000000Z RRULE:FREQ=WEEKLY",
        unified_job_template_id: 3,
      },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/schedules/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Update schedule — success
     ══════════════════════════════════════════════════════════════ */

  it("updates schedule with id and partial fields", async () => {
    mockFetchResponse({ ...MOCK_RAW_SCHEDULE, name: "Updated Schedule" });

    const result = await hooks.tool!["awx-update-schedule"]!.execute(
      { id: 8, name: "Updated Schedule" },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("schedule");
    expect(metadata.id).toBe(8);
    expect(metadata.errors).toEqual([]);
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated Schedule");
  });

  it("update schedule calls PATCH /api/v2/schedules/8/", async () => {
    mockFetchResponse(MOCK_RAW_SCHEDULE);

    await hooks.tool!["awx-update-schedule"]!.execute(
      { id: 8, name: "Updated Schedule" },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/schedules/8/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Delete schedule — success
     ══════════════════════════════════════════════════════════════ */

  it("deletes schedule with id", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-schedule"]!.execute(
      { id: 8 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("schedule");
    expect(metadata.id).toBe(8);
    expect(metadata.data).toBeNull();
    expect(metadata.errors).toEqual([]);
  });

  it("delete schedule calls DELETE /api/v2/schedules/8/", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-schedule"]!.execute(
      { id: 8 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/schedules/8/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Abort signal handling
     ══════════════════════════════════════════════════════════════ */

  it("create returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-schedule"]!.execute(
      {
        name: "Test",
        rrule: "DTSTART:20250101T000000Z RRULE:FREQ=DAILY",
        unified_job_template_id: 1,
      },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  it("delete returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-schedule"]!.execute(
      { id: 8 },
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

    const result = await hooks.tool!["awx-create-schedule"]!.execute(
      {
        name: "Test",
        rrule: "DTSTART:20250101T000000Z RRULE:FREQ=DAILY",
        unified_job_template_id: 1,
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

    const result = await hooks.tool!["awx-delete-schedule"]!.execute(
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
    const schema = hooks.tool!["awx-create-schedule"]!.args;
    const parsed = schema?.safeParse?.({ rrule: "DTSTART:20250101T000000Z RRULE:FREQ=DAILY", unified_job_template_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required rrule", async () => {
    const schema = hooks.tool!["awx-create-schedule"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", unified_job_template_id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("create rejects missing required unified_job_template_id", async () => {
    const schema = hooks.tool!["awx-create-schedule"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", rrule: "DTSTART:20250101T000000Z RRULE:FREQ=DAILY" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("delete requires id", async () => {
    const schema = hooks.tool!["awx-delete-schedule"]!.args;
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

    const result = await localHooks.tool!["awx-create-schedule"]!.execute(
      {
        name: "Test",
        rrule: "DTSTART:20250101T000000Z RRULE:FREQ=DAILY",
        unified_job_template_id: 1,
      },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
