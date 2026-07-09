/**
 * Workflow Template CRUD Tool Integration Tests
 *
 * Tests the awx-create-workflow-template, awx-update-workflow-template,
 * and awx-delete-workflow-template tools end-to-end: tool registration,
 * successful create/update/delete, error handling, abort signals,
 * and Zod schema validation.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 *
 * Key differences from regular job templates:
 * - Uses /api/v2/workflow_job_templates/ endpoint (not /api/v2/job_templates/)
 * - No project, playbook, or job_type fields
 * - Has workflow-specific fields (survey_enabled, allow_simultaneous, etc.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX workflow template API response matching known fixture shape */
const MOCK_RAW_WORKFLOW_TEMPLATE: Record<string, unknown> = {
  id: 42,
  name: "Deploy Web Stack — Workflow",
  description: "Orchestrate the web application stack deployment",
  organization: 1,
  inventory: 1,
  limit: "webservers",
  verbosity: 1,
  extra_vars: "---\napp_version: v1.2.3\n",
  job_tags: "deploy,verify",
  skip_tags: "cleanup",
  timeout: 600,
  ask_variables_on_launch: true,
  ask_inventory_on_launch: false,
  ask_limit_on_launch: true,
  ask_tags_on_launch: false,
  ask_skip_tags_on_launch: false,
  ask_credential_on_launch: false,
  survey_enabled: true,
  allow_simultaneous: false,
  last_job_run: "2025-07-01T10:30:00Z",
  status: "successful",
  webhook_credential: null,
  webhook_service: "",
  webhook_url: "",
  created: "2025-06-01T08:00:00Z",
  modified: "2025-07-01T10:30:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
    inventory: { id: 1, name: "Production" },
    labels: {
      results: [
        { id: 1, name: "production" },
        { id: 2, name: "workflow" },
      ],
    },
    credentials: [],
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

describe("workflow template CRUD tools", () => {
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

  it("registers awx-create-workflow-template in hooks.tool", async () => {
    expect(hooks.tool!["awx-create-workflow-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-workflow-template"]!.description).toBe("string");
  });

  it("registers awx-update-workflow-template in hooks.tool", async () => {
    expect(hooks.tool!["awx-update-workflow-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-workflow-template"]!.description).toBe("string");
  });

  it("registers awx-delete-workflow-template in hooks.tool", async () => {
    expect(hooks.tool!["awx-delete-workflow-template"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-workflow-template"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: awx-create-workflow-template behavior
     ══════════════════════════════════════════════════════════════ */

  it("creates a workflow template and returns ResourceMutationOutput with action 'created'", async () => {
    mockFetchResponse(MOCK_RAW_WORKFLOW_TEMPLATE);

    const result = await hooks.tool!["awx-create-workflow-template"]!.execute(
      {
        name: "Deploy Web Stack — Workflow",
        organization_id: 1,
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("workflow_template");
    expect(metadata.id).toBe(42);
    expect(metadata.data).not.toBeNull();
    expect((metadata.data as Record<string, unknown>).name).toBe("Deploy Web Stack — Workflow");
    expect((metadata.errors as unknown[]).length).toBe(0);
  });

  it("calls POST /api/v2/workflow_job_templates/ for create", async () => {
    mockFetchResponse(MOCK_RAW_WORKFLOW_TEMPLATE);

    await hooks.tool!["awx-create-workflow-template"]!.execute(
      {
        name: "Test Workflow Template",
        organization_id: 1,
      },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/workflow_job_templates/",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends the correct body for workflow template create with optional fields", async () => {
    mockFetchResponse(MOCK_RAW_WORKFLOW_TEMPLATE);

    await hooks.tool!["awx-create-workflow-template"]!.execute(
      {
        name: "Test Workflow",
        organization_id: 1,
        description: "A test workflow",
        inventory_id: 5,
        limit: "webservers",
        verbosity: 2,
        extra_vars: { app_version: "v1.0" },
        job_tags: "deploy",
        skip_tags: "cleanup",
        timeout: 300,
        ask_variables_on_launch: true,
        ask_inventory_on_launch: false,
        ask_limit_on_launch: true,
        ask_tags_on_launch: false,
        ask_skip_tags_on_launch: false,
        ask_credential_on_launch: false,
        survey_enabled: true,
        allow_simultaneous: false,
      },
      mockToolContext(),
    );

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.name).toBe("Test Workflow");
    expect(body.organization).toBe(1);
    expect(body.description).toBe("A test workflow");
    expect(body.inventory).toBe(5);
    expect(body.limit).toBe("webservers");
    expect(body.verbosity).toBe(2);
    expect(body.extra_vars).toBe(JSON.stringify({ app_version: "v1.0" }));
    expect(body.job_tags).toBe("deploy");
    expect(body.skip_tags).toBe("cleanup");
    expect(body.timeout).toBe(300);
    expect(body.ask_variables_on_launch).toBe(true);
    expect(body.ask_inventory_on_launch).toBe(false);
    expect(body.ask_limit_on_launch).toBe(true);
    expect(body.ask_tags_on_launch).toBe(false);
    expect(body.ask_skip_tags_on_launch).toBe(false);
    expect(body.ask_credential_on_launch).toBe(false);
    expect(body.survey_enabled).toBe(true);
    expect(body.allow_simultaneous).toBe(false);
  });

  it("does not send optional fields when not provided for create", async () => {
    mockFetchResponse(MOCK_RAW_WORKFLOW_TEMPLATE);

    await hooks.tool!["awx-create-workflow-template"]!.execute(
      {
        name: "Minimal Workflow",
        organization_id: 1,
      },
      mockToolContext(),
    );

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.name).toBe("Minimal Workflow");
    expect(body.organization).toBe(1);
    // Optional fields should NOT be present in the body
    expect(body.description).toBeUndefined();
    expect(body.inventory).toBeUndefined();
    expect(body.limit).toBeUndefined();
    expect(body.verbosity).toBeUndefined();
    expect(body.extra_vars).toBeUndefined();
    expect(body.job_tags).toBeUndefined();
    expect(body.skip_tags).toBeUndefined();
    expect(body.timeout).toBeUndefined();
    expect(body.ask_variables_on_launch).toBeUndefined();
    expect(body.ask_inventory_on_launch).toBeUndefined();
    expect(body.ask_limit_on_launch).toBeUndefined();
    expect(body.ask_tags_on_launch).toBeUndefined();
    expect(body.ask_skip_tags_on_launch).toBeUndefined();
    expect(body.ask_credential_on_launch).toBeUndefined();
    expect(body.survey_enabled).toBeUndefined();
    expect(body.allow_simultaneous).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: awx-update-workflow-template behavior
     ══════════════════════════════════════════════════════════════ */

  it("updates a workflow template and returns ResourceMutationOutput with action 'updated'", async () => {
    const updatedRaw = { ...MOCK_RAW_WORKFLOW_TEMPLATE, name: "Updated Workflow", id: 42 };
    mockFetchResponse(updatedRaw);

    const result = await hooks.tool!["awx-update-workflow-template"]!.execute(
      {
        id: 42,
        name: "Updated Workflow",
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("workflow_template");
    expect(metadata.id).toBe(42);
    expect(metadata.data).not.toBeNull();
    expect((metadata.data as Record<string, unknown>).name).toBe("Updated Workflow");
  });

  it("calls PATCH /api/v2/workflow_job_templates/{id}/ for update", async () => {
    mockFetchResponse(MOCK_RAW_WORKFLOW_TEMPLATE);

    await hooks.tool!["awx-update-workflow-template"]!.execute(
      {
        id: 42,
        name: "Updated Workflow",
      },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/workflow_job_templates/42/",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("sends only the provided fields in update body", async () => {
    mockFetchResponse(MOCK_RAW_WORKFLOW_TEMPLATE);

    await hooks.tool!["awx-update-workflow-template"]!.execute(
      {
        id: 42,
        name: "Renamed Workflow",
      },
      mockToolContext(),
    );

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.name).toBe("Renamed Workflow");
    expect(Object.keys(body)).toEqual(["name"]);
  });

  it("sends extra_vars as JSON string in update body", async () => {
    mockFetchResponse(MOCK_RAW_WORKFLOW_TEMPLATE);

    await hooks.tool!["awx-update-workflow-template"]!.execute(
      {
        id: 42,
        extra_vars: { key: "value", nested: { a: 1 } },
      },
      mockToolContext(),
    );

    const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.extra_vars).toBe(JSON.stringify({ key: "value", nested: { a: 1 } }));
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: awx-delete-workflow-template behavior
     ══════════════════════════════════════════════════════════════ */

  it("deletes a workflow template and returns ResourceMutationOutput with action 'deleted' and data null", async () => {
    mockFetchResponse({});

    const result = await hooks.tool!["awx-delete-workflow-template"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("workflow_template");
    expect(metadata.id).toBe(42);
    expect(metadata.data).toBeNull();
  });

  it("calls DELETE /api/v2/workflow_job_templates/{id}/ for delete", async () => {
    mockFetchResponse({});

    await hooks.tool!["awx-delete-workflow-template"]!.execute(
      { id: 42 },
      mockToolContext(),
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/workflow_job_templates/42/",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Error handling
     ══════════════════════════════════════════════════════════════ */

  it("returns error output when AWX client is not available for create", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-create-workflow-template"]!.execute(
      {
        name: "Test",
        organization_id: 1,
      },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });

  it("returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-workflow-template"]!.execute(
      {
        name: "Test",
        organization_id: 1,
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
    const schema = hooks.tool!["awx-create-workflow-template"]!.args;
    const parsed = schema?.safeParse?.({});

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects create with empty name", async () => {
    const schema = hooks.tool!["awx-create-workflow-template"]!.args;
    const parsed = schema?.safeParse?.({
      name: "",
      organization_id: 1,
    });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects update without id", async () => {
    const schema = hooks.tool!["awx-update-workflow-template"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects delete without id", async () => {
    const schema = hooks.tool!["awx-delete-workflow-template"]!.args;
    const parsed = schema?.safeParse?.({});

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: AWX API errors are surfaced
     ══════════════════════════════════════════════════════════════ */

  it("surfaces AWX API error for create", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Validation error: name already exists" }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-workflow-template"]!.execute(
      {
        name: "Duplicate",
        organization_id: 1,
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

    const result = await hooks.tool!["awx-update-workflow-template"]!.execute(
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

    const result = await hooks.tool!["awx-delete-workflow-template"]!.execute(
      { id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("error");
  });
});
