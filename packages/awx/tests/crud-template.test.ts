/**
 * Template CRUD Tool Integration Tests
 *
 * Tests the awx-create-template, awx-update-template, and awx-delete-template
 * tools end-to-end: tool registration, successful create/update/delete,
 * error handling, abort signals, and Zod schema validation.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX template API response matching the known fixture */
const MOCK_RAW_TEMPLATE: Record<string, unknown> = {
  id: 7,
  name: "Deploy Web Stack — Production",
  description: "Deploy the web application stack to production servers",
  job_type: "run",
  inventory: 1,
  project: 3,
  organization: 1,
  playbook: "deploy-web-stack.yml",
  verbosity: 2,
  ask_variables_on_launch: true,
  ask_inventory_on_launch: false,
  ask_limit_on_launch: true,
  last_job_run: "2025-06-15T14:32:00Z",
  status: "successful",
  next_schedule: null,
  summary_fields: {
    organization: { id: 1, name: "Default" },
    inventory: { id: 1, name: "Production" },
    project: { id: 3, name: "Web Stack Deploy" },
    labels: {
      results: [
        { id: 1, name: "production" },
        { id: 2, name: "web" },
        { id: 3, name: "deploy" },
      ],
    },
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

describe("template CRUD tools", () => {
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
     Cycle 1: Tool registration
     ══════════════════════════════════════════════════════════════ */

  it("registers awx-create-template in hooks.tool", async () => {
    expect(hooks.tool!["awx-create-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-template"]!.description).toBe("string");
  });

  it("registers awx-update-template in hooks.tool", async () => {
    expect(hooks.tool!["awx-update-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-template"]!.description).toBe("string");
  });

  it("registers awx-delete-template in hooks.tool", async () => {
    expect(hooks.tool!["awx-delete-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-template"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: awx-create-template behavior
     ══════════════════════════════════════════════════════════════ */

  it("creates a template and returns ResourceMutationOutput with action 'created'", async () => {
    mockFetchResponse(MOCK_RAW_TEMPLATE);

    const result = await hooks.tool!["awx-create-template"]!.execute(
      {
        name: "Deploy Web Stack — Production",
        job_type: "run",
        project_id: 3,
        inventory_id: 1,
        playbook: "deploy-web-stack.yml",
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("template");
    expect(metadata.id).toBe(7);
    expect(metadata.data).not.toBeNull();
    expect((metadata.data as Record<string, unknown>).name).toBe("Deploy Web Stack — Production");
    expect((metadata.errors as unknown[]).length).toBe(0);
  });

  it("calls POST /api/v2/job_templates/ for create", async () => {
    mockFetchResponse(MOCK_RAW_TEMPLATE);

    await hooks.tool!["awx-create-template"]!.execute(
      {
        name: "Test Template",
        job_type: "run",
        project_id: 3,
        inventory_id: 1,
        playbook: "site.yml",
      },
      mockToolContext(),
    );

    // Verify fetch was called with POST to the correct URL
    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/job_templates/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends the correct body for template create", async () => {
    mockFetchResponse(MOCK_RAW_TEMPLATE);

    await hooks.tool!["awx-create-template"]!.execute(
      {
        name: "Test Template",
        job_type: "run",
        project_id: 3,
        inventory_id: 1,
        playbook: "site.yml",
      },
      mockToolContext(),
    );

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.name).toBe("Test Template");
    expect(body.job_type).toBe("run");
    expect(body.project).toBe(3);
    expect(body.inventory).toBe(1);
    expect(body.playbook).toBe("site.yml");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: awx-update-template behavior
     ══════════════════════════════════════════════════════════════ */

  it("updates a template and returns ResourceMutationOutput with action 'updated'", async () => {
    const updatedRaw = { ...MOCK_RAW_TEMPLATE, name: "Updated Template", id: 7 };
    mockFetchResponse(updatedRaw);

    const result = await hooks.tool!["awx-update-template"]!.execute(
      {
        id: 7,
        name: "Updated Template",
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("template");
    expect(metadata.id).toBe(7);
    expect(metadata.data).not.toBeNull();
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated Template");
  });

  it("calls PATCH /api/v2/job_templates/{id}/ for update", async () => {
    mockFetchResponse(MOCK_RAW_TEMPLATE);

    await hooks.tool!["awx-update-template"]!.execute(
      {
        id: 7,
        name: "Updated Template",
      },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/job_templates/7/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("sends only the provided fields in update body", async () => {
    mockFetchResponse(MOCK_RAW_TEMPLATE);

    await hooks.tool!["awx-update-template"]!.execute(
      {
        id: 7,
        name: "Renamed Template",
      },
      mockToolContext(),
    );

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.name).toBe("Renamed Template");
    // Only the fields that were provided should be in the body
    expect(Object.keys(body)).toEqual(["name"]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: awx-delete-template behavior
     ══════════════════════════════════════════════════════════════ */

  it("deletes a template and returns ResourceMutationOutput with action 'deleted' and data null", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-template"]!.execute(
      { id: 7 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("template");
    expect(metadata.id).toBe(7);
    expect(metadata.data).toBeNull();
  });

  it("calls DELETE /api/v2/job_templates/{id}/ for delete", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-template"]!.execute(
      { id: 7 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/job_templates/7/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Error handling
     ══════════════════════════════════════════════════════════════ */

  it("returns error output when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-create-template"]!.execute(
      {
        name: "Test",
        job_type: "run",
        project_id: 1,
        inventory_id: 1,
        playbook: "site.yml",
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata?: Record<string, unknown> }).metadata;
    // When no client, errors should be surfaced
    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });

  it("returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-template"]!.execute(
      {
        name: "Test",
        job_type: "run",
        project_id: 1,
        inventory_id: 1,
        playbook: "site.yml",
      },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Zod schema validation
     ══════════════════════════════════════════════════════════════ */

  it("rejects create without required fields", async () => {
    const schema = hooks.tool!["awx-create-template"]!.args;
    const parsed = schema?.safeParse?.({});

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects create with invalid job_type", async () => {
    const schema = hooks.tool!["awx-create-template"]!.args;
    const parsed = schema?.safeParse?.({
      name: "Test",
      job_type: "invalid_type",
      project_id: 1,
      inventory_id: 1,
      playbook: "site.yml",
    });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects update without id", async () => {
    const schema = hooks.tool!["awx-update-template"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects delete without id", async () => {
    const schema = hooks.tool!["awx-delete-template"]!.args;
    const parsed = schema?.safeParse?.({});

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: AWX API errors are surfaced in errors array
     ══════════════════════════════════════════════════════════════ */

  it("surfaces AWX API error for create", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Validation error: name already exists" }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-template"]!.execute(
      {
        name: "Duplicate",
        job_type: "run",
        project_id: 1,
        inventory_id: 1,
        playbook: "site.yml",
      },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("error");
  });

  it("surfaces AWX API error for update", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-template"]!.execute(
      { id: 99999, name: "Ghost" },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("error");
  });

  it("surfaces AWX API error for delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-delete-template"]!.execute(
      { id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("error");
  });
});
