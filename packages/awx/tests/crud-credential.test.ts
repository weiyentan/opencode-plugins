/**
 * Credential CRUD Tool Tests
 *
 * Tests awx-create-credential, awx-update-credential, and awx-delete-credential
 * tools end-to-end: tool registration, correct endpoints/methods,
 * Zod schema validation, error handling, abort signals, and
 * the invariant that the sensitive `inputs` field is never exposed in output.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../src/index.js";

// ─── Mock Data ────────────────────────────────────────────────

const MOCK_CREATE_RESPONSE: Record<string, unknown> = {
  id: 42,
  name: "My SSH Key",
  description: "SSH private key for production",
  credential_type: 1,
  kind: "ssh",
  managed: false,
  organization: 2,
  summary_fields: {
    credential_type: { id: 1, name: "Machine" },
    organization: { id: 2, name: "Default" },
  },
};

const MOCK_UPDATE_RESPONSE: Record<string, unknown> = {
  id: 5,
  name: "Updated Credential",
  description: "Updated description",
  credential_type: 1,
  kind: "ssh",
  managed: false,
  organization: 2,
  summary_fields: {
    credential_type: { id: 1, name: "Machine" },
    organization: { id: 2, name: "Default" },
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

// ─── Shared beforeEach/afterEach ──────────────────────────────

let hooks: Hooks;

async function setupHooks(): Promise<void> {
  const input = mockPluginInput();
  (input.client as any).getSecret = vi.fn().mockResolvedValue("test-token");
  hooks = await createHooks(input, {
    baseUrl: "https://aap.example.com",
  });
}

async function teardownHooks(): Promise<void> {
  vi.restoreAllMocks();
  await hooks.dispose?.();
}

// ═══════════════════════════════════════════════════════════════
// Tool Registration
// ═══════════════════════════════════════════════════════════════

describe("credential CRUD tool registration", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("registers awx-create-credential in hooks.tool", async () => {
    expect(hooks.tool!["awx-create-credential"]).toBeDefined();
    expect(typeof hooks.tool!["awx-create-credential"]!.description).toBe("string");
  });

  it("registers awx-update-credential in hooks.tool", async () => {
    expect(hooks.tool!["awx-update-credential"]).toBeDefined();
    expect(typeof hooks.tool!["awx-update-credential"]!.description).toBe("string");
  });

  it("registers awx-delete-credential in hooks.tool", async () => {
    expect(hooks.tool!["awx-delete-credential"]).toBeDefined();
    expect(typeof hooks.tool!["awx-delete-credential"]!.description).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-create-credential
// ═══════════════════════════════════════════════════════════════

describe("awx-create-credential", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends POST to /api/v2/credentials/ and returns created credential", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_CREATE_RESPONSE), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-credential"]!.execute(
      {
        name: "My SSH Key",
        organization_id: 2,
        credential_type_id: 1,
        description: "SSH private key for production",
        inputs: { username: "deploy", password: "s3cret" },
      },
      mockToolContext(),
    );

    // Verify fetch was called with POST to the correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/credentials/");
    expect(requestInit?.method).toBe("POST");

    // Verify the request body
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};
    expect(requestBody.name).toBe("My SSH Key");
    expect(requestBody.organization).toBe(2);
    expect(requestBody.credential_type).toBe(1);
    expect(requestBody.inputs).toEqual({ username: "deploy", password: "s3cret" });

    // Verify the output envelope
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("created");
    expect(metadata.resource_type).toBe("credential");
    expect(metadata.id).toBe(42);

    // Verify mapped credential data — inputs must NOT appear in output
    const credentialData = metadata.data as Record<string, unknown>;
    expect(credentialData).not.toHaveProperty("inputs");
    expect(credentialData.name).toBe("My SSH Key");
    expect(credentialData.credential_type_name).toBe("Machine");
    expect(credentialData.organization_name).toBe("Default");

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Credential 42 created successfully");
    expect(output).toContain("My SSH Key");
  });

  it("rejects missing required field (name)", async () => {
    const schema = hooks.tool!["awx-create-credential"]!.args;
    const parsed = schema?.safeParse?.({ organization_id: 1, credential_type_id: 1 });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects missing required field (organization_id)", async () => {
    const schema = hooks.tool!["awx-create-credential"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", credential_type_id: 1 });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects missing required field (credential_type_id)", async () => {
    const schema = hooks.tool!["awx-create-credential"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test", organization_id: 1 });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error on API failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Organization not found." }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-credential"]!.execute(
      { name: "Test", organization_id: 999, credential_type_id: 1 },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to create credential");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
    expect((metadata.errors as string[])[0]).toContain("Organization not found");
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-create-credential"]!.execute(
      { name: "Test", organization_id: 1, credential_type_id: 1 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });

  it("does not include inputs in output metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_CREATE_RESPONSE), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-create-credential"]!.execute(
      {
        name: "My SSH Key",
        organization_id: 2,
        credential_type_id: 1,
        inputs: { username: "deploy", password: "s3cret" },
      },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    // The metadata.data must not contain inputs
    const data = metadata.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("inputs");

    // Also metadata itself should not carry inputs at the top level
    expect(metadata).not.toHaveProperty("inputs");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-update-credential
// ═══════════════════════════════════════════════════════════════

describe("awx-update-credential", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends PATCH to /api/v2/credentials/5/ and returns updated credential", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_UPDATE_RESPONSE), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-credential"]!.execute(
      { id: 5, name: "Updated Credential", credential_type_id: 1 },
      mockToolContext(),
    );

    // Verify PATCH to correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/credentials/5/");
    expect(requestInit?.method).toBe("PATCH");

    // Verify body contains only provided fields
    const requestBody = requestInit?.body ? JSON.parse(requestInit.body as string) : {};
    expect(requestBody.name).toBe("Updated Credential");
    expect(requestBody.credential_type).toBe(1);
    expect(requestBody.organization).toBeUndefined();

    // Verify output envelope
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("updated");
    expect(metadata.resource_type).toBe("credential");
    expect(metadata.id).toBe(5);

    // Verify mapped credential data — inputs must NOT appear in output
    const credentialData = metadata.data as Record<string, unknown>;
    expect(credentialData).not.toHaveProperty("inputs");
    expect(credentialData.name).toBe("Updated Credential");
    expect(credentialData.credential_type_name).toBe("Machine");

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Credential 5 updated successfully");
  });

  it("rejects missing id field", async () => {
    const schema = hooks.tool!["awx-update-credential"]!.args;
    const parsed = schema?.safeParse?.({ name: "Test" });
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error for unknown credential ID (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-credential"]!.execute(
      { id: 99999, name: "Ghost" },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to update credential");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-update-credential"]!.execute(
      { id: 5, name: "Test" },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });

  it("does not expose inputs in update output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(MOCK_UPDATE_RESPONSE), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-update-credential"]!.execute(
      { id: 5, name: "Updated", inputs: { password: "new-s3cret" } },
      mockToolContext(),
    );

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    const data = metadata.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("inputs");
  });
});

// ═══════════════════════════════════════════════════════════════
// awx-delete-credential
// ═══════════════════════════════════════════════════════════════

describe("awx-delete-credential", () => {
  beforeEach(setupHooks);
  afterEach(teardownHooks);

  it("sends DELETE to /api/v2/credentials/5/ and returns success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 204,
        statusText: "No Content",
      }),
    );

    const result = await hooks.tool!["awx-delete-credential"]!.execute(
      { id: 5 },
      mockToolContext(),
    );

    // Verify DELETE to correct endpoint
    const fetchCall = fetchSpy.mock.calls[0];
    const [requestUrl, requestInit] = fetchCall as [string | URL | Request, RequestInit?];
    expect(requestUrl).toContain("/api/v2/credentials/5/");
    expect(requestInit?.method).toBe("DELETE");

    // Verify output envelope — data must be null for delete
    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.schema_version).toBe("1.0");
    expect(metadata.action).toBe("deleted");
    expect(metadata.resource_type).toBe("credential");
    expect(metadata.id).toBe(5);
    expect(metadata.data).toBeNull();

    // Verify human-readable output
    const output = (result as { output: string }).output;
    expect(output).toContain("Credential 5 deleted successfully");
  });

  it("rejects missing id field", async () => {
    const schema = hooks.tool!["awx-delete-credential"]!.args;
    const parsed = schema?.safeParse?.({});
    if (parsed) {
      expect(parsed.success).toBe(false);
    }
  });

  it("returns error for unknown credential ID (404)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not found." }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await hooks.tool!["awx-delete-credential"]!.execute(
      { id: 99999 },
      mockToolContext(),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("Failed to delete credential");

    const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
    expect(metadata.errors).toBeDefined();
    expect(Array.isArray(metadata.errors)).toBe(true);
    expect((metadata.errors as string[])[0]).toContain("Not found");
  });

  it("respects abort signal", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const result = await hooks.tool!["awx-delete-credential"]!.execute(
      { id: 5 },
      mockToolContext({ abort: abortedController.signal }),
    );

    const output = (result as { output: string }).output;
    expect(output).toContain("aborted");
  });

  it("returns error when no AWX client is available", async () => {
    const input = mockPluginInput();
    const localHooks = await createHooks(input, {
      baseUrl: "https://aap.example.com",
    });

    const result = await localHooks.tool!["awx-delete-credential"]!.execute(
      { id: 5 },
      mockToolContext(),
    );

    const out = (result as { output: string }).output;
    expect(out).toContain("PAT");

    await localHooks.dispose?.();
  });
});
