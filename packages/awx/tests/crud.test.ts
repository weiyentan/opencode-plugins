/**
 * CRUD Registry & Dispatch Tests
 *
 * Tests for the shared CRUD infrastructure in crud.ts:
 * - Registry endpoint/method mappings for all 9 (resource × action) combinations
 * - Successful create/update dispatch with mapper integration
 * - Error handling for unsupported types, missing IDs, and API errors
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi } from "vitest";
import type { AwxClient } from "../src/client.js";
import { CRUD_REGISTRY, executeCrud } from "../src/crud.js";
import type { CrudResourceType, CrudAction } from "../src/crud.js";

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

/** Raw AWX project API response */
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

/** Raw AWX inventory API response */
const MOCK_RAW_INVENTORY: Record<string, unknown> = {
  id: 12,
  name: "Production Servers",
  description: "Production server inventory",
  kind: "smart",
  host_count: 48,
  total_groups: 6,
  has_inventory_sources: true,
  total_inventory_sources: 2,
  variables: "---\nansible_user: deploy\n",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

/**
 * Create a mock AwxClient that returns a successful JSON response.
 */
function mockClientWithResponse(
  body: unknown,
  status = 200,
): AwxClient {
  const request = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { "Content-Type": "application/json" },
    }),
  );
  return { request: request as AwxClient["request"] };
}

/**
 * Create a mock AwxClient that returns an error response.
 */
function mockClientWithError(status: number, body?: unknown): AwxClient {
  const request = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body ?? { detail: "Error" }), {
      status,
      statusText: status === 404 ? "Not Found" : "Error",
      headers: { "Content-Type": "application/json" },
    }),
  );
  return { request: request as AwxClient["request"] };
}

/** Mock request body for create/update operations */
/** Raw AWX credential API response */
const MOCK_RAW_CREDENTIAL: Record<string, unknown> = {
  id: 42,
  name: "My SSH Key",
  description: "SSH private key",
  credential_type: 1,
  kind: "ssh",
  managed: false,
  organization: 2,
  summary_fields: {
    credential_type: { id: 1, name: "Machine" },
    organization: { id: 2, name: "Default" },
  },
};

/** Raw AWX organization API response */
const MOCK_RAW_ORGANIZATION: Record<string, unknown> = {
  id: 10,
  name: "Engineering",
  description: "Engineering department",
  created: "2025-06-25T12:00:00Z",
  modified: "2025-06-25T12:00:00Z",
  summary_fields: {
    related: {
      users: { count: 5 },
      teams: { count: 2 },
      job_templates: { count: 10 },
      projects: { count: 3 },
      inventories: { count: 4 },
    },
  },
};

const MOCK_BODY: Record<string, unknown> = {
  name: "Test Resource",
  description: "Created by test",
};

/**
 * Assert the endpoint configuration for a given (resource, action) pair.
 */
function expectEndpoint(
  resource: CrudResourceType,
  action: CrudAction,
  expectedPath: string,
  expectedMethod: string,
  expectedRequiresId: boolean,
): void {
  const entry = CRUD_REGISTRY[resource];
  expect(entry).toBeDefined();
  const endpoint = entry.endpoint[action];
  expect(endpoint).toBeDefined();
  expect(endpoint.path).toBe(expectedPath);
  expect(endpoint.method).toBe(expectedMethod);
  expect(endpoint.requiresId).toBe(expectedRequiresId);
}

// ─── Registry Tests ───────────────────────────────────────────

describe("CRUD_REGISTRY", () => {
  /* ══════════════════════════════════════════════════════════════
     Template resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (template, create) → POST /api/v2/job_templates/", () => {
    expectEndpoint("template", "create",
      "/api/v2/job_templates/", "POST", false);
  });

  it("maps (template, update) → PATCH /api/v2/job_templates/{id}/", () => {
    expectEndpoint("template", "update",
      "/api/v2/job_templates/{id}/", "PATCH", true);
  });

  it("maps (template, delete) → DELETE /api/v2/job_templates/{id}/", () => {
    expectEndpoint("template", "delete",
      "/api/v2/job_templates/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     Project resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (project, create) → POST /api/v2/projects/", () => {
    expectEndpoint("project", "create",
      "/api/v2/projects/", "POST", false);
  });

  it("maps (project, update) → PATCH /api/v2/projects/{id}/", () => {
    expectEndpoint("project", "update",
      "/api/v2/projects/{id}/", "PATCH", true);
  });

  it("maps (project, delete) → DELETE /api/v2/projects/{id}/", () => {
    expectEndpoint("project", "delete",
      "/api/v2/projects/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     Inventory resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (inventory, create) → POST /api/v2/inventories/", () => {
    expectEndpoint("inventory", "create",
      "/api/v2/inventories/", "POST", false);
  });

  it("maps (inventory, update) → PATCH /api/v2/inventories/{id}/", () => {
    expectEndpoint("inventory", "update",
      "/api/v2/inventories/{id}/", "PATCH", true);
  });

  it("maps (inventory, delete) → DELETE /api/v2/inventories/{id}/", () => {
    expectEndpoint("inventory", "delete",
      "/api/v2/inventories/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     Credential resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (credential, create) → POST /api/v2/credentials/", () => {
    expectEndpoint("credential", "create",
      "/api/v2/credentials/", "POST", false);
  });

  it("maps (credential, update) → PATCH /api/v2/credentials/{id}/", () => {
    expectEndpoint("credential", "update",
      "/api/v2/credentials/{id}/", "PATCH", true);
  });

  it("maps (credential, delete) → DELETE /api/v2/credentials/{id}/", () => {
    expectEndpoint("credential", "delete",
      "/api/v2/credentials/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     Organization resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (organization, create) → POST /api/v2/organizations/", () => {
    expectEndpoint("organization", "create",
      "/api/v2/organizations/", "POST", false);
  });

  it("maps (organization, update) → PATCH /api/v2/organizations/{id}/", () => {
    expectEndpoint("organization", "update",
      "/api/v2/organizations/{id}/", "PATCH", true);
  });

  it("maps (organization, delete) → DELETE /api/v2/organizations/{id}/", () => {
    expectEndpoint("organization", "delete",
      "/api/v2/organizations/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     All 15 combinations enumerated
     ══════════════════════════════════════════════════════════════ */

  it("has exactly 11 resource types registered", () => {
    expect(Object.keys(CRUD_REGISTRY).sort()).toEqual([
      "credential",
      "execution-environment",
      "group",
      "host",
      "instance-group",
      "inventory",
      "label",
      "organization",
      "project",
      "template",
      "workflow_template",
    ]);
  });

  it("each resource type has all 3 CRUD actions", () => {
    for (const resource of Object.keys(CRUD_REGISTRY) as CrudResourceType[]) {
      const actions = Object.keys(CRUD_REGISTRY[resource].endpoint).sort();
      expect(actions).toEqual(["create", "delete", "update"]);
    }
  });
});

// ─── executeCrud Dispatch Tests ───────────────────────────────

describe("executeCrud()", () => {
  /* ══════════════════════════════════════════════════════════════
     Create operations
     ══════════════════════════════════════════════════════════════ */

  it("creates a template and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);

    const result = await executeCrud(client, "template", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("template");
    expect(result.id).toBe(7);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("template");
  });

  it("calls the correct endpoint for template create", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);

    await executeCrud(client, "template", "create", undefined, MOCK_BODY);

    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-template-create",
      "/api/v2/job_templates/",
      expect.objectContaining({ method: "POST" }),
      undefined,
    );
  });

  it("creates a project and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_PROJECT);

    const result = await executeCrud(client, "project", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("project");
    expect(result.id).toBe(5);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("project");
  });

  it("creates an inventory and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_INVENTORY);

    const result = await executeCrud(client, "inventory", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("inventory");
    expect(result.id).toBe(12);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("inventory");
  });

  it("creates a credential and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_CREDENTIAL);

    const result = await executeCrud(client, "credential", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("credential");
    expect(result.id).toBe(42);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("credential");

    // Verify the sensitive inputs field is never included in the mapped output
    const innerData = (result.data as Record<string, unknown>).data as Record<string, unknown>;
    expect(innerData).not.toHaveProperty("inputs");
  });

  it("creates an organization and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_ORGANIZATION);

    const result = await executeCrud(client, "organization", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("organization");
    expect(result.id).toBe(10);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("organization");
  });

  /* ══════════════════════════════════════════════════════════════
     Update operations
     ══════════════════════════════════════════════════════════════ */

  it("updates a template and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);

    const result = await executeCrud(client, "template", "update", 7, MOCK_BODY);

    expect(result.action).toBe("updated");
    expect(result.resource_type).toBe("template");
    expect(result.id).toBe(7);
    expect(result.data).not.toBeNull();
  });

  it("calls the correct endpoint for template update", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);

    await executeCrud(client, "template", "update", 7, MOCK_BODY);

    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-template-update",
      "/api/v2/job_templates/7/",
      expect.objectContaining({ method: "PATCH" }),
      undefined,
    );
  });

  it("includes extra_vars in PATCH body when provided", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);
    const body = {
      name: "Updated Template",
      extra_vars: '{"region":"us-east-1","environment":"staging"}',
    };

    await executeCrud(client, "template", "update", 7, body);

    const callArgs = vi.mocked(client.request).mock.calls[0];
    const init = callArgs[2] as RequestInit;
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toEqual({
      name: "Updated Template",
      extra_vars: '{"region":"us-east-1","environment":"staging"}',
    });
  });

  it("does not include extra_vars in PATCH body when omitted", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);
    const body = { name: "Updated Template" };

    await executeCrud(client, "template", "update", 7, body);

    const callArgs = vi.mocked(client.request).mock.calls[0];
    const init = callArgs[2] as RequestInit;
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toEqual({ name: "Updated Template" });
    expect(parsedBody).not.toHaveProperty("extra_vars");
  });

  it("updates a project and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_PROJECT);

    const result = await executeCrud(client, "project", "update", 5, MOCK_BODY);

    expect(result.action).toBe("updated");
    expect(result.resource_type).toBe("project");
    expect(result.id).toBe(5);
    expect(result.data).not.toBeNull();
  });

  it("updates an inventory and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_INVENTORY);

    const result = await executeCrud(client, "inventory", "update", 12, MOCK_BODY);

    expect(result.action).toBe("updated");
    expect(result.resource_type).toBe("inventory");
    expect(result.id).toBe(12);
    expect(result.data).not.toBeNull();
  });

  it("updates a credential and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_CREDENTIAL);

    const result = await executeCrud(client, "credential", "update", 42, MOCK_BODY);

    expect(result.action).toBe("updated");
    expect(result.resource_type).toBe("credential");
    expect(result.id).toBe(42);
    expect(result.data).not.toBeNull();
  });

  it("updates an organization and returns the mapped result", async () => {
    const client = mockClientWithResponse(MOCK_RAW_ORGANIZATION);

    const result = await executeCrud(client, "organization", "update", 10, MOCK_BODY);

    expect(result.action).toBe("updated");
    expect(result.resource_type).toBe("organization");
    expect(result.id).toBe(10);
    expect(result.data).not.toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════
     Delete operations
     ══════════════════════════════════════════════════════════════ */

  it("deletes a template and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "template", "delete", 7);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("template");
    expect(result.id).toBe(7);
    expect(result.data).toBeNull();
  });

  it("calls the correct endpoint for template delete", async () => {
    const client = mockClientWithResponse({}, 200);

    await executeCrud(client, "template", "delete", 7);

    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-template-delete",
      "/api/v2/job_templates/7/",
      expect.objectContaining({ method: "DELETE" }),
      undefined,
    );
  });

  it("deletes a project and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "project", "delete", 5);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("project");
    expect(result.id).toBe(5);
    expect(result.data).toBeNull();
  });

  it("deletes an inventory and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "inventory", "delete", 12);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("inventory");
    expect(result.id).toBe(12);
    expect(result.data).toBeNull();
  });

  it("deletes a credential and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "credential", "delete", 42);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("credential");
    expect(result.id).toBe(42);
    expect(result.data).toBeNull();
  });

  it("deletes an organization and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "organization", "delete", 10);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("organization");
    expect(result.id).toBe(10);
    expect(result.data).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════
     Error handling
     ══════════════════════════════════════════════════════════════ */

  it("throws for unsupported resource types", async () => {
    const client = mockClientWithResponse({});
    // Cast to bypass TypeScript type check for the error case
    await expect(
      executeCrud(client, "unsupported" as CrudResourceType, "create"),
    ).rejects.toThrow(/unsupported resource type/i);
  });

  it("throws when ID is missing for update", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);
    await expect(
      executeCrud(client, "template", "update", undefined, MOCK_BODY),
    ).rejects.toThrow(/ID is required/i);
  });

  it("throws when ID is missing for delete", async () => {
    const client = mockClientWithResponse({}, 200);
    await expect(
      executeCrud(client, "template", "delete"),
    ).rejects.toThrow(/ID is required/i);
  });

  it("throws with API error details for non-2xx responses", async () => {
    const client = mockClientWithError(404, { detail: "Not found." });

    await expect(
      executeCrud(client, "template", "create", undefined, MOCK_BODY),
    ).rejects.toThrow(/(?:404|not found)/i);
  });

  it("propagates the abort signal to the client", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);
    const controller = new AbortController();

    await executeCrud(client, "template", "create", undefined, MOCK_BODY, controller.signal);

    // The abort signal should have been passed through
    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-template-create",
      "/api/v2/job_templates/",
      expect.any(Object),
      controller.signal,
    );
  });
});
