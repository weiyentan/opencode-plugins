/**
 * Launch Job Tool Tests
 *
 * Validates the transforms pipeline and launch-job tool:
 * - runTransformsPipeline runs transforms in order and returns warnings/errors
 * - launchJob aborts on transforms failure
 * - launchJob returns job ID on success
 */
import { describe, it, expect, vi } from "vitest";
import { runTransformsPipeline, launchJob } from "../src/launch.js";
import type { AwxClient } from "../src/client.js";

/** Create a minimal mock AWX client */
function mockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

// ============================================================================
// runTransformsPipeline — Pure pipeline function
// ============================================================================

describe("runTransformsPipeline", () => {
  it("reports missing required vars when extraVars is undefined", () => {
    const result = runTransformsPipeline(undefined);

    expect(result).toHaveProperty("extraVars");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("errors");
    expect(result.extraVars).toEqual({});
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([
      'Missing required variable: "inventory"',
      'Missing required variable: "scm_url"',
      'Missing required variable: "scm_branch"',
    ]);
  });

  it("normalizes scm_url from SSH to HTTPS and produces a warning", () => {
    const result = runTransformsPipeline({
      inventory: "prod",
      scm_url: "git@github.com:org/repo.git",
    });

    expect(result.extraVars.scm_url).toBe("https://github.com/org/repo");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("SCM URL transformed");
  });

  it("infers git branch from refs/heads/ prefix and produces a warning", () => {
    const result = runTransformsPipeline({
      inventory: "prod",
      scm_url: "https://github.com/org/repo",
      scm_branch: "refs/heads/main",
    });

    expect(result.extraVars.scm_branch).toBe("main");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Git branch inferred");
  });

  it("passes through an already-short branch name without warning", () => {
    const result = runTransformsPipeline({
      inventory: "prod",
      scm_url: "https://github.com/org/repo",
      scm_branch: "main",
    });

    expect(result.extraVars.scm_branch).toBe("main");
    expect(result.warnings).toEqual([]);
  });

  it("pipeline order: errors from validateRequiredVars appear despite URL/branch success", () => {
    // Provide scm_url and scm_branch but omit inventory
    const result = runTransformsPipeline({
      scm_url: "git@github.com:org/repo.git",
      scm_branch: "refs/heads/develop",
    });

    // URL and branch should be transformed
    expect(result.extraVars.scm_url).toBe("https://github.com/org/repo");
    expect(result.extraVars.scm_branch).toBe("develop");
    // Warnings from both transforms
    expect(result.warnings).toHaveLength(2);
    // But inventory is still missing
    expect(result.errors).toEqual([
      'Missing required variable: "inventory"',
    ]);
  });
});

// ============================================================================
// launchJob — Orchestrator with transforms + API call
// ============================================================================

describe("launchJob", () => {
  it("aborts launch when transforms pipeline has errors (no API call)", async () => {
    const client = mockClient();

    // Missing all required vars should cause pipeline failure
    const result = await launchJob(client, 42, {});

    // Should return immediately with errors, no API call
    expect(result.jobId).toBe(0);
    expect(result.jobStatus).toBe("failed");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("calls launch API and returns job ID on success", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 123, status: "pending" })),
    } as Response);

    const result = await launchJob(client, 10, {
      inventory: "prod",
      scm_url: "git@github.com:org/playbooks.git",
      scm_branch: "refs/heads/main",
    });

    // Should have called the launch API
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-launch-job",
      "/api/v2/job_templates/10/launch/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extra_vars: {
            inventory: "prod",
            scm_url: "https://github.com/org/playbooks",
            scm_branch: "main",
          },
        }),
      },
      undefined,
    );
    // Should return the job ID and status
    expect(result.jobId).toBe(123);
    expect(result.jobStatus).toBe("pending");
    // Transforms warnings should be propagated
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.errors).toEqual([]);
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
      launchJob(client, 99999, {
        inventory: "prod",
        scm_url: "https://github.com/org/repo",
        scm_branch: "main",
      }),
    ).rejects.toThrow("Not found.");

    // Only one API call should have been made (no retry on 4xx)
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("aborts launch when required var is null (no API call)", async () => {
    const client = mockClient();

    const result = await launchJob(client, 42, {
      inventory: null as unknown as string,
      scm_url: "https://github.com/org/repo",
      scm_branch: "main",
    });

    expect(result.jobId).toBe(0);
    expect(result.jobStatus).toBe("failed");
    expect(result.errors).toContain('Missing required variable: "inventory"');
    expect(client.request).not.toHaveBeenCalled();
  });

  it("aborts launch when required var is undefined (no API call)", async () => {
    const client = mockClient();

    const result = await launchJob(client, 42, {
      inventory: undefined as unknown as string,
      scm_url: "https://github.com/org/repo",
      scm_branch: "main",
    });

    expect(result.jobId).toBe(0);
    expect(result.jobStatus).toBe("failed");
    expect(result.errors).toContain('Missing required variable: "inventory"');
    expect(client.request).not.toHaveBeenCalled();
  });

  it("aborts launch when required var is blank string (no API call)", async () => {
    const client = mockClient();

    const result = await launchJob(client, 42, {
      inventory: "",
      scm_url: "https://github.com/org/repo",
      scm_branch: "main",
    });

    expect(result.jobId).toBe(0);
    expect(result.jobStatus).toBe("failed");
    expect(result.errors).toContain('Missing required variable: "inventory"');
    expect(client.request).not.toHaveBeenCalled();
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
      launchJob(client, 10, {
        inventory: "prod",
        scm_url: "https://github.com/org/repo",
        scm_branch: "main",
      }),
    ).rejects.toThrow("AWX launch failed: HTTP 500: Internal Server Error");

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
      launchJob(client, 10, {
        inventory: "prod",
        scm_url: "https://github.com/org/repo",
        scm_branch: "main",
      }),
    ).rejects.toThrow("AWX launch failed: HTTP 502: <html>Bad Gateway</html>");

    expect(client.request).toHaveBeenCalledTimes(1);
  });
});
