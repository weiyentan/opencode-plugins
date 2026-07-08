/**
 * Launch Workflow Tool Tests
 *
 * Validates the launchWorkflow thin-proxy behavior:
 * - extra_vars are forwarded verbatim to the AWX API
 * - raw AWX response body is returned as-is
 * - HTTP errors are surfaced correctly
 */
import { describe, it, expect, vi } from "vitest";
import { launchWorkflow } from "../src/launch-workflow.js";
import type { AwxClient } from "../src/client.js";

/** Create a minimal mock AWX client */
function mockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

// ============================================================================
// launchWorkflow — Thin proxy that passes extra_vars through to AWX
// ============================================================================

describe("launchWorkflow", () => {
  it("passes extra_vars verbatim to the AWX API", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 123, status: "pending" })),
    } as Response);

    const rawVars = {
      inventory: "prod",
      scm_url: "git@github.com:org/playbooks.git",
      scm_branch: "refs/heads/main",
      custom_flag: true,
    };

    await launchWorkflow(client, 10, rawVars);

    // Verify extra_vars were forwarded verbatim (no transforms applied)
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-launch-workflow",
      "/api/v2/workflow_job_templates/10/launch/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extra_vars: rawVars }),
      },
      undefined,
    );
  });

  it("returns raw AWX response body", async () => {
    const client = mockClient();
    const awxResponse = {
      id: 456,
      status: "pending",
      type: "workflow_job",
      url: "/api/v2/workflow_jobs/456/",
      related: {},
      summary_fields: {},
      created: "2024-01-01T00:00:00Z",
      name: "test-workflow",
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify(awxResponse)),
    } as Response);

    const result = await launchWorkflow(client, 10, { inventory: "prod" });

    // Should return the full AWX response body as-is
    expect(result).toEqual(awxResponse);
  });

  it("omits extra_vars from request body when none provided", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 789, status: "pending" })),
    } as Response);

    await launchWorkflow(client, 10, undefined);

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-launch-workflow",
      "/api/v2/workflow_job_templates/10/launch/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      undefined,
    );
  });

  it("omits extra_vars from request body when empty object provided", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 790, status: "pending" })),
    } as Response);

    await launchWorkflow(client, 10, {});

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-launch-workflow",
      "/api/v2/workflow_job_templates/10/launch/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      undefined,
    );
  });

  it("returns empty object when AWX response body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await launchWorkflow(client, 10, { inventory: "prod" });

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 404 from invalid template_id", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve(JSON.stringify({ detail: "Not found." })),
    } as Response);

    await expect(
      launchWorkflow(client, 99999, { inventory: "prod" }),
    ).rejects.toThrow("Not found.");

    // Only one API call should have been made (no retry on 4xx)
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP error with non-JSON empty response", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    } as Response);

    await expect(
      launchWorkflow(client, 10, { inventory: "prod" }),
    ).rejects.toThrow("AWX workflow launch failed: HTTP 500: Internal Server Error");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP error with HTML response body", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.resolve("<html>Bad Gateway</html>"),
    } as Response);

    await expect(
      launchWorkflow(client, 10, { inventory: "prod" }),
    ).rejects.toThrow("AWX workflow launch failed: HTTP 502: <html>Bad Gateway</html>");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 1, status: "pending" })),
    } as Response);

    const controller = new AbortController();
    await launchWorkflow(client, 10, { inventory: "prod" }, controller.signal);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      controller.signal,
    );
  });
});
