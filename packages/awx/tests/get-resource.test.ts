/**
 * GetResource Orchestrator Tests
 *
 * Tests for the getResource() function: registry dispatch, error propagation,
 * and end-to-end template and inventory resource fetching.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getResource } from "../src/get-resource.js";
import type { AwxClient } from "../src/client.js";
import type { TemplateDetailOutput } from "../src/contracts/template-detail.js";
import type { ProjectDetailOutput } from "../src/contracts/project-detail.js";
import type { InventoryDetailOutput } from "../src/contracts/inventory-detail.js";
import type { CredentialDetailOutput } from "../src/contracts/credential-detail.js";
import type { OrganizationDetailOutput } from "../src/contracts/organization-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX inventory API fixture */
function loadRawInventoryFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_inventory.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ─── Test Helpers ─────────────────────────────────────────────

/** Raw AWX template API response matching the fixture */
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
  timeout: 300,
  job_tags: "deploy,healthcheck",
  skip_tags: "debug",
  ask_tags_on_launch: true,
  ask_skip_tags_on_launch: false,
  extra_vars: "---\naws_region: us-east-1\nenvironment: production\n",
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
    credentials: {
      results: [
        { id: 5, name: "Production SSH", credential_type_id: 1, kind: "ssh" },
        { id: 8, name: "Vault Token", credential_type_id: 4, kind: "vault" },
      ],
    },
  },
};

/** Raw AWX project API response matching the fixture */
const MOCK_RAW_PROJECT: Record<string, unknown> = {
  id: 5,
  name: "Web Stack Deploy",
  description: "Ansible playbooks for deploying the web application stack",
  scm_type: "git",
  scm_url: "https://github.com/example/web-stack-deploy.git",
  scm_branch: "main",
  scm_revision: "abc123def456",
  credential: 10,
  default_environment: 20,
  status: "successful",
  last_updated: "2025-06-20T10:15:00Z",
  created: "2025-01-10T08:00:00Z",
  modified: "2025-06-20T10:15:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
    created_by: { id: 1, username: "admin" },
    credential: { id: 10, name: "GitLab PAT - Production" },
    default_environment: { id: 20, name: "Ansible Engine 2.9" },
  },
};

/** Raw AWX credential API response */
const MOCK_RAW_CREDENTIAL: Record<string, unknown> = {
  id: 15,
  name: "Production SSH Key",
  description: "SSH key for production server access",
  credential_type: 1,
  kind: "ssh",
  managed: false,
  organization: 1,
  inputs: {
    username: "deploy",
    password: "$encrypted$",
  },
  summary_fields: {
    credential_type: { id: 1, name: "Machine" },
    organization: { id: 1, name: "Default" },
  },
};

/** Raw AWX organization API response */
const MOCK_RAW_ORGANIZATION: Record<string, unknown> = {
  id: 1,
  name: "Default",
  description: "Default organization",
  created: "2025-01-01T00:00:00Z",
  modified: "2025-06-15T12:00:00Z",
  summary_fields: {
    related: {
      users: { count: 3, results: [] },
      teams: { count: 2, results: [] },
      job_templates: { count: 5, results: [] },
      projects: { count: 3, results: [] },
      inventories: { count: 2, results: [] },
    },
  },
};

/** Create a mock AwxClient that returns a successful JSON response */
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

/** Create a mock AwxClient that throws an AbortError */
function mockClientWithAbort(): AwxClient {
  const request = vi.fn().mockRejectedValue(
    new DOMException("Aborted", "AbortError"),
  );
  return { request: request as AwxClient["request"] };
}

// ─── Tests ────────────────────────────────────────────────────

describe("getResource()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Successful template resource fetch
     ══════════════════════════════════════════════════════════════ */

  it("fetches and maps a template resource via the registry", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);

    const result = (await getResource(client, "template", 7)) as TemplateDetailOutput;

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("template");
    expect(result.id).toBe(7);
    expect(result.data.name).toBe("Deploy Web Stack — Production");
    expect(result.data.inventory_name).toBe("Production");
    expect(result.data.project_name).toBe("Web Stack Deploy");
    expect(result.data.organization_name).toBe("Default");
    expect(result.data.description).toBe("Deploy the web application stack to production servers");
    expect(result.data.timeout).toBe(300);
    expect(result.data.job_tags).toBe("deploy,healthcheck");
    expect(result.data.skip_tags).toBe("debug");
    expect(result.data.ask_tags_on_launch).toBe(true);
    expect(result.data.ask_skip_tags_on_launch).toBe(false);
    expect(result.data.extra_vars).toBe("---\naws_region: us-east-1\nenvironment: production\n");
    expect(result.data.credentials).toEqual([
      { id: 5, name: "Production SSH", credential_type_id: 1, kind: "ssh" },
      { id: 8, name: "Vault Token", credential_type_id: 4, kind: "vault" },
    ]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Unsupported resource type
     ══════════════════════════════════════════════════════════════ */

  it("throws for unsupported resource types with a clear message", async () => {
    const client = mockClientWithResponse({});
    await expect(getResource(client, "job" as any, 1))
      .rejects.toThrow(/unsupported/i);
    await expect(getResource(client, "unsupported" as any, 1))
      .rejects.toThrow(/unsupported/i);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: API error — non-2xx response
     ══════════════════════════════════════════════════════════════ */

  it("throws with API error details for non-2xx responses", async () => {
    const client = mockClientWithResponse(
      { detail: "Not found." },
      404,
    );

    await expect(getResource(client, "template", 99999))
      .rejects.toThrow(/(?:404|not found)/i);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Abort signal propagation
     ══════════════════════════════════════════════════════════════ */

  it("propagates abort errors from the client", async () => {
    const client = mockClientWithAbort();

    await expect(getResource(client, "template", 7))
      .rejects.toThrow(DOMException);

    // Verify the client was called with the abort signal
    expect(client.request).toHaveBeenCalled();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Registry endpoint mapping
     ══════════════════════════════════════════════════════════════ */

  it("calls the correct API endpoint for the template resource", async () => {
    const client = mockClientWithResponse(MOCK_RAW_TEMPLATE);

    await getResource(client, "template", 7);

    expect(client.request).toHaveBeenCalledWith(
      "awx-get-resource",
      "/api/v2/job_templates/7/",
      undefined,
      undefined,
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Successful project resource fetch
     ══════════════════════════════════════════════════════════════ */

  it("fetches and maps a project resource via the registry", async () => {
    const client = mockClientWithResponse(MOCK_RAW_PROJECT);

    const result = (await getResource(client, "project", 5)) as ProjectDetailOutput;

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("project");
    expect(result.id).toBe(5);
    expect(result.data.name).toBe("Web Stack Deploy");
    expect(result.data.organization_name).toBe("Default");
    expect(result.data.created_by).toBe("admin");
    expect(result.data.is_successful).toBe(true);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Project API error — non-2xx response
     ══════════════════════════════════════════════════════════════ */

  it("throws with API error details for non-2xx project responses", async () => {
    const client = mockClientWithResponse(
      { detail: "Not found." },
      404,
    );

    await expect(getResource(client, "project", 99999))
      .rejects.toThrow(/(?:404|not found)/i);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: Registry endpoint mapping for project
     ══════════════════════════════════════════════════════════════ */

  it("calls the correct API endpoint for the project resource", async () => {
    const client = mockClientWithResponse(MOCK_RAW_PROJECT);

    await getResource(client, "project", 5);

    expect(client.request).toHaveBeenCalledWith(
      "awx-get-resource",
      "/api/v2/projects/5/",
      undefined,
      undefined,
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Successful inventory resource fetch
     ══════════════════════════════════════════════════════════════ */

  it("fetches and maps an inventory resource via the registry", async () => {
    const raw = loadRawInventoryFixture();
    const client = mockClientWithResponse(raw);

    const result = (await getResource(client, "inventory", 12)) as InventoryDetailOutput;

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("inventory");
    expect(result.id).toBe(12);
    expect(result.data.name).toBe("Production Servers");
    expect(result.data.kind).toBe("smart");
    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Inventory registry endpoint mapping
     ══════════════════════════════════════════════════════════════ */

  it("calls the correct API endpoint for the inventory resource", async () => {
    const raw = loadRawInventoryFixture();
    const client = mockClientWithResponse(raw);

    await getResource(client, "inventory", 12);

    expect(client.request).toHaveBeenCalledWith(
      "awx-get-resource",
      "/api/v2/inventories/12/",
      undefined,
      undefined,
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: Successful credential resource fetch
     ══════════════════════════════════════════════════════════════ */

  it("fetches and maps a credential resource via the registry", async () => {
    const client = mockClientWithResponse(MOCK_RAW_CREDENTIAL);

    const result = (await getResource(client, "credential", 15)) as CredentialDetailOutput;

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("credential");
    expect(result.id).toBe(15);
    expect(result.data.name).toBe("Production SSH Key");
    expect(result.data.credential_type_name).toBe("Machine");
    expect(result.data.organization_name).toBe("Default");
    expect(result.data).not.toHaveProperty("inputs");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 9: Credential registry endpoint mapping
     ══════════════════════════════════════════════════════════════ */

  it("calls the correct API endpoint for the credential resource", async () => {
    const client = mockClientWithResponse(MOCK_RAW_CREDENTIAL);

    await getResource(client, "credential", 15);

    expect(client.request).toHaveBeenCalledWith(
      "awx-get-resource",
      "/api/v2/credentials/15/",
      undefined,
      undefined,
    );
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 10: Successful organization resource fetch
     ══════════════════════════════════════════════════════════════ */

  it("fetches and maps an organization resource via the registry", async () => {
    const client = mockClientWithResponse(MOCK_RAW_ORGANIZATION);

    const result = (await getResource(client, "organization", 1)) as OrganizationDetailOutput;

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("organization");
    expect(result.id).toBe(1);
    expect(result.data.name).toBe("Default");
    expect(result.data.related.users).toBe(3);
    expect(result.data.related.teams).toBe(2);
    expect(result.data.related.job_templates).toBe(5);
    expect(result.data.related.projects).toBe(3);
    expect(result.data.related.inventories).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 11: Organization registry endpoint mapping
     ══════════════════════════════════════════════════════════════ */

  it("calls the correct API endpoint for the organization resource", async () => {
    const client = mockClientWithResponse(MOCK_RAW_ORGANIZATION);

    await getResource(client, "organization", 1);

    expect(client.request).toHaveBeenCalledWith(
      "awx-get-resource",
      "/api/v2/organizations/1/",
      undefined,
      undefined,
    );
  });
});
