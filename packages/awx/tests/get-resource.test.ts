/**
 * GetResource Orchestrator Tests
 *
 * Tests for the getResource() function: registry dispatch, error propagation,
 * and end-to-end template resource fetching.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect, vi } from "vitest";
import { getResource } from "../src/get-resource.js";
import type { AwxClient } from "../src/client.js";
import type { TemplateDetailOutput } from "../src/contracts/template-detail.js";

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
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Unsupported resource type
     ══════════════════════════════════════════════════════════════ */

  it("throws for unsupported resource types with a clear message", async () => {
    const client = mockClientWithResponse({});
    await expect(getResource(client, "job" as any, 1))
      .rejects.toThrow(/unsupported/i);
    await expect(getResource(client, "inventory" as any, 1))
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
});
