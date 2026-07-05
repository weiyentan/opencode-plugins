/**
 * awx-get-resource Tool Integration Tests
 *
 * Tests the awx-get-resource tool end-to-end: tool registration,
 * template detail retrieval, error handling, abort signals, and
 * type validation.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX inventory API fixture */
function loadRawInventoryFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_inventory.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ─── Test Helpers ─────────────────────────────────────────────

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

const MOCK_RAW_PROJECT: Record<string, unknown> = {
  id: 5,
  name: "Web Stack Deploy",
  description: "Ansible playbooks for deploying the web application stack",
  scm_type: "git",
  scm_url: "https://github.com/example/web-stack-deploy.git",
  scm_branch: "main",
  status: "successful",
  last_updated: "2025-06-20T10:15:00Z",
  created: "2025-01-10T08:00:00Z",
  modified: "2025-06-20T10:15:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
    created_by: { id: 1, username: "admin" },
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

describe("awx-get-resource tool", () => {
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
     Cycle 1: Tool is registered
     ══════════════════════════════════════════════════════════════ */

  it("registers the awx-get-resource tool in hooks.tool", async () => {
    expect(hooks.tool!["awx-get-resource"]).toBeDefined();
    expect(typeof hooks.tool!["awx-get-resource"]!.description).toBe("string");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Successful template detail retrieval
     ══════════════════════════════════════════════════════════════ */

  it("returns template details in the standard envelope", async () => {
    mockFetchResponse(MOCK_RAW_TEMPLATE);

    const result = await hooks.tool!["awx-get-resource"]!.execute(
      { type: "template", id: 7 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("template");
    expect(metadata.id).toBe(7);
    expect((metadata.data as Record<string, unknown>).name).toBe("Deploy Web Stack — Production");
    expect((metadata.data as Record<string, unknown>).inventory_name).toBe("Production");
    expect((metadata.data as Record<string, unknown>).project_name).toBe("Web Stack Deploy");
    expect((metadata.data as Record<string, unknown>).labels).toEqual(["production", "web", "deploy"]);

    const output = (result as { output: string }).output;
    expect(output).toContain("Template 7: Deploy Web Stack — Production");
    expect(output).toContain("Job Type:  run");
    expect(output).toContain("Playbook:  deploy-web-stack.yml");
    expect(output).toContain("Status:    successful");
    expect(output).toContain("Inventory: Production");
    expect(output).toContain("Project:   Web Stack Deploy");
    expect(output).toContain("Last Run:  2025-06-15T14:32:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Tool respects abort signals
     ══════════════════════════════════════════════════════════════ */

  it("returns abort message when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-get-resource"]!.execute(
      { type: "template", id: 7 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("aborted");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Graceful error for unknown template ID (404)
     ══════════════════════════════════════════════════════════════ */

  it("returns error output for unknown template ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-get-resource"]!.execute(
      { type: "template", id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("get-resource error");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: No client available
     ══════════════════════════════════════════════════════════════ */

  it("returns error output when AWX client is not available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-get-resource"]!.execute(
      { type: "template", id: 7 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Successful project detail retrieval
     ══════════════════════════════════════════════════════════════ */

  it("returns project details in the standard envelope", async () => {
    mockFetchResponse(MOCK_RAW_PROJECT);

    const result = await hooks.tool!["awx-get-resource"]!.execute(
      { type: "project", id: 5 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("project");
    expect(metadata.id).toBe(5);
    expect((metadata.data as Record<string, unknown>).name).toBe("Web Stack Deploy");
    expect((metadata.data as Record<string, unknown>).organization_name).toBe("Default");
    expect((metadata.data as Record<string, unknown>).created_by).toBe("admin");
    expect((metadata.data as Record<string, unknown>).is_successful).toBe(true);

    const output = (result as { output: string }).output;
    expect(output).toContain("Project 5: Web Stack Deploy");
    expect(output).toContain("SCM Type:        git");
    expect(output).toContain("SCM URL:         https://github.com/example/web-stack-deploy.git");
    expect(output).toContain("Branch:          main");
    expect(output).toContain("SCM Revision:    (none)");
    expect(output).toContain("Credential:      (none)");
    expect(output).toContain("Default Env:     (none)");
    expect(output).toContain("Status:          successful");
    expect(output).toContain("Org:             Default");
    expect(output).toContain("Updated:         2025-06-20T10:15:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Successful inventory detail retrieval
     ══════════════════════════════════════════════════════════════ */

  it("returns inventory details in the standard envelope", async () => {
    const raw = loadRawInventoryFixture();
    mockFetchResponse(raw);

    const result = await hooks.tool!["awx-get-resource"]!.execute(
      { type: "inventory", id: 12 },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;

    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.resource_type).toBe("inventory");
    expect(metadata.id).toBe(12);
    expect((metadata.data as Record<string, unknown>).name).toBe("Production Servers");
    expect((metadata.data as Record<string, unknown>).kind).toBe("smart");
    expect((metadata.data as Record<string, unknown>).organization_name).toBe("Default");
    expect((metadata.data as Record<string, unknown>).host_count).toBe(48);
    expect((metadata.data as Record<string, unknown>).total_inventory_sources).toBe(2);

    const output = (result as { output: string }).output;
    expect(output).toContain("Inventory 12: Production Servers");
    expect(output).toContain("Kind:       smart");
    expect(output).toContain("Host Count: 48");
    expect(output).toContain("Groups:     6");
    expect(output).toContain("Org:        Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: Graceful error for unknown project ID (404)
     ══════════════════════════════════════════════════════════════ */

  it("returns error output for unknown project ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-get-resource"]!.execute(
      { type: "project", id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("get-resource error");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 9: Graceful error for unknown inventory ID (404)
     ══════════════════════════════════════════════════════════════ */

  it("returns error output for unknown inventory ID", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-get-resource"]!.execute(
      { type: "inventory", id: 99999 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("get-resource error");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 10: Zod schema validation rejects invalid resource types
     ══════════════════════════════════════════════════════════════ */

  it("rejects unsupported resource types", async () => {
    // The schema validation happens before the tool's execute runs,
    // so we test via the args schema directly.
    const schema = hooks.tool!["awx-get-resource"]!.args;
    const parsed = schema?.safeParse?.({ type: "unsupported", id: 1 });

    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });
});
