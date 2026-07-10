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
     User resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (user, create) → POST /api/v2/users/", () => {
    expectEndpoint("user", "create",
      "/api/v2/users/", "POST", false);
  });

  it("maps (user, update) → PATCH /api/v2/users/{id}/", () => {
    expectEndpoint("user", "update",
      "/api/v2/users/{id}/", "PATCH", true);
  });

  it("maps (user, delete) → DELETE /api/v2/users/{id}/", () => {
    expectEndpoint("user", "delete",
      "/api/v2/users/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     Team resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (team, create) → POST /api/v2/teams/", () => {
    expectEndpoint("team", "create",
      "/api/v2/teams/", "POST", false);
  });

  it("maps (team, update) → PATCH /api/v2/teams/{id}/", () => {
    expectEndpoint("team", "update",
      "/api/v2/teams/{id}/", "PATCH", true);
  });

  it("maps (team, delete) → DELETE /api/v2/teams/{id}/", () => {
    expectEndpoint("team", "delete",
      "/api/v2/teams/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     Schedule resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (schedule, create) → POST /api/v2/schedules/", () => {
    expectEndpoint("schedule", "create",
      "/api/v2/schedules/", "POST", false);
  });

  it("maps (schedule, update) → PATCH /api/v2/schedules/{id}/", () => {
    expectEndpoint("schedule", "update",
      "/api/v2/schedules/{id}/", "PATCH", true);
  });

  it("maps (schedule, delete) → DELETE /api/v2/schedules/{id}/", () => {
    expectEndpoint("schedule", "delete",
      "/api/v2/schedules/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     Notification template resource endpoints
     ══════════════════════════════════════════════════════════════ */

  it("maps (notification_template, create) → POST /api/v2/notification_templates/", () => {
    expectEndpoint("notification_template", "create",
      "/api/v2/notification_templates/", "POST", false);
  });

  it("maps (notification_template, update) → PATCH /api/v2/notification_templates/{id}/", () => {
    expectEndpoint("notification_template", "update",
      "/api/v2/notification_templates/{id}/", "PATCH", true);
  });

  it("maps (notification_template, delete) → DELETE /api/v2/notification_templates/{id}/", () => {
    expectEndpoint("notification_template", "delete",
      "/api/v2/notification_templates/{id}/", "DELETE", true);
  });

  /* ══════════════════════════════════════════════════════════════
     All 9 combinations enumerated
     ══════════════════════════════════════════════════════════════ */

  it("has exactly 7 resource types registered", () => {
    expect(Object.keys(CRUD_REGISTRY).sort()).toEqual([
      "inventory",
      "notification_template",
      "project",
      "schedule",
      "team",
      "template",
      "user",
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

  /* ══════════════════════════════════════════════════════════════
     User resource dispatch
     ══════════════════════════════════════════════════════════════ */

  it("creates a user and returns the mapped result", async () => {
    const MOCK_RAW_USER = {
      id: 42,
      username: "jdoe",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      is_superuser: false,
      is_system_auditor: false,
      created: "2025-01-15T09:30:00Z",
      modified: "2025-06-20T14:45:00Z",
      summary_fields: { organization: { id: 1, name: "Default" } },
    };
    const client = mockClientWithResponse(MOCK_RAW_USER);

    const result = await executeCrud(client, "user", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("user");
    expect(result.id).toBe(42);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("user");
  });

  it("calls the correct endpoint for user create", async () => {
    const MOCK_RAW_USER = {
      id: 42, username: "jdoe", first_name: "Jane", last_name: "Doe",
      email: "jane@example.com", is_superuser: false, is_system_auditor: false,
      created: "2025-01-15T09:30:00Z", modified: "2025-06-20T14:45:00Z",
      summary_fields: { organization: { id: 1, name: "Default" } },
    };
    const client = mockClientWithResponse(MOCK_RAW_USER);

    await executeCrud(client, "user", "create", undefined, MOCK_BODY);

    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-user-create",
      "/api/v2/users/",
      expect.objectContaining({ method: "POST" }),
      undefined,
    );
  });

  it("deletes a user and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "user", "delete", 42);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("user");
    expect(result.id).toBe(42);
    expect(result.data).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════
     Team resource dispatch
     ══════════════════════════════════════════════════════════════ */

  it("creates a team and returns the mapped result", async () => {
    const MOCK_RAW_TEAM = {
      id: 15,
      name: "Platform Engineers",
      description: "Platform engineering team",
      organization: 1,
      created: "2025-02-01T10:00:00Z",
      modified: "2025-06-15T12:30:00Z",
      summary_fields: { organization: { id: 1, name: "Default" } },
    };
    const client = mockClientWithResponse(MOCK_RAW_TEAM);

    const result = await executeCrud(client, "team", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("team");
    expect(result.id).toBe(15);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("team");
  });

  it("calls the correct endpoint for team create", async () => {
    const MOCK_RAW_TEAM = {
      id: 15, name: "Platform Engineers", description: "Platform team",
      organization: 1, created: "2025-02-01T10:00:00Z", modified: "2025-06-15T12:30:00Z",
      summary_fields: { organization: { id: 1, name: "Default" } },
    };
    const client = mockClientWithResponse(MOCK_RAW_TEAM);

    await executeCrud(client, "team", "create", undefined, MOCK_BODY);

    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-team-create",
      "/api/v2/teams/",
      expect.objectContaining({ method: "POST" }),
      undefined,
    );
  });

  it("deletes a team and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "team", "delete", 15);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("team");
    expect(result.id).toBe(15);
    expect(result.data).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════
     Schedule resource dispatch
     ══════════════════════════════════════════════════════════════ */

  it("creates a schedule and returns the mapped result", async () => {
    const MOCK_RAW_SCHEDULE = {
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
    const client = mockClientWithResponse(MOCK_RAW_SCHEDULE);

    const result = await executeCrud(client, "schedule", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("schedule");
    expect(result.id).toBe(8);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("schedule");
  });

  it("calls the correct endpoint for schedule create", async () => {
    const MOCK_RAW_SCHEDULE = {
      id: 8, name: "Daily Deploy", description: "", rrule: "DTSTART:20250101T000000Z RRULE:FREQ=DAILY;INTERVAL=1",
      unified_job_template: 3, next_run: null, created: "2025-01-01T00:00:00Z", modified: "2025-06-30T08:00:00Z",
      summary_fields: {
        unified_job_template: { id: 3, name: "Deploy Web Stack - Production" },
        organization: { id: 1, name: "Default" },
      },
    };
    const client = mockClientWithResponse(MOCK_RAW_SCHEDULE);

    await executeCrud(client, "schedule", "create", undefined, MOCK_BODY);

    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-schedule-create",
      "/api/v2/schedules/",
      expect.objectContaining({ method: "POST" }),
      undefined,
    );
  });

  it("deletes a schedule and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "schedule", "delete", 8);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("schedule");
    expect(result.id).toBe(8);
    expect(result.data).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════
     Notification template resource dispatch
     ══════════════════════════════════════════════════════════════ */

  it("creates a notification_template and returns the mapped result", async () => {
    const MOCK_RAW_NT = {
      id: 5,
      name: "Slack Alerts",
      description: "Send alerts to #ops channel",
      notification_type: "slack",
      notification_configuration: { channels: ["#ops"] },
      organization: 1,
      created: "2025-03-10T11:00:00Z",
      modified: "2025-07-01T16:20:00Z",
      summary_fields: { organization: { id: 1, name: "Default" } },
    };
    const client = mockClientWithResponse(MOCK_RAW_NT);

    const result = await executeCrud(client, "notification_template", "create", undefined, MOCK_BODY);

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("notification_template");
    expect(result.id).toBe(5);
    expect(result.data).not.toBeNull();
    expect((result.data as Record<string, unknown>).schema_version).toBe("1.0");
    expect((result.data as Record<string, unknown>).resource_type).toBe("notification_template");
  });

  it("calls the correct endpoint for notification_template create", async () => {
    const MOCK_RAW_NT = {
      id: 5, name: "Slack Alerts", description: "", notification_type: "slack",
      notification_configuration: {}, organization: 1,
      created: "2025-03-10T11:00:00Z", modified: "2025-07-01T16:20:00Z",
      summary_fields: { organization: { id: 1, name: "Default" } },
    };
    const client = mockClientWithResponse(MOCK_RAW_NT);

    await executeCrud(client, "notification_template", "create", undefined, MOCK_BODY);

    expect(client.request).toHaveBeenCalledWith(
      "awx-crud-notification_template-create",
      "/api/v2/notification_templates/",
      expect.objectContaining({ method: "POST" }),
      undefined,
    );
  });

  it("deletes a notification_template and returns null data", async () => {
    const client = mockClientWithResponse({}, 200);

    const result = await executeCrud(client, "notification_template", "delete", 5);

    expect(result.action).toBe("deleted");
    expect(result.resource_type).toBe("notification_template");
    expect(result.id).toBe(5);
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
