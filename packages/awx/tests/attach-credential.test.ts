/**
 * Attach Credential Tool Tests
 *
 * Validates the attachCredentials function behavior:
 * - Credential IDs are forwarded to the AWX API
 * - Success path returns AWX response body
 * - HTTP errors are surfaced correctly (404, 401, 403, 500)
 * - Abort signal is propagated
 * - Empty credential list edge case
 */
import { describe, it, expect, vi } from "vitest";
import { attachCredentials } from "../src/attach-credential.js";
import type { AwxClient } from "../src/client.js";

/** Create a minimal mock AWX client */
function mockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

// ============================================================================
// attachCredentials — Thin proxy for POST /api/v2/job_templates/{id}/credentials/
// ============================================================================

describe("attachCredentials", () => {
  it("sends credential IDs to the AWX API", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 10,
            name: "Deploy Template",
            summary_fields: {
              credentials: [
                { id: 5, name: "SSH Key" },
                { id: 8, name: "Vault Password" },
              ],
            },
          }),
        ),
    } as Response);

    await attachCredentials(client, 10, [5, 8]);

    // Verify credential IDs were forwarded to the correct endpoint
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: [5, 8] }),
      },
      undefined,
    );
  });

  it("sends single credential ID wrapped in array", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () =>
        Promise.resolve(
          JSON.stringify({ id: 42, name: "Test Template" }),
        ),
    } as Response);

    await attachCredentials(client, 42, [7]);

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/42/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: [7] }),
      },
      undefined,
    );
  });

  it("returns raw AWX response body", async () => {
    const client = mockClient();
    const awxResponse = {
      id: 99,
      name: "My Template",
      type: "job_template",
      url: "/api/v2/job_templates/99/",
      related: {},
      summary_fields: {
        credentials: [{ id: 3, name: "Machine Credential" }],
      },
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(JSON.stringify(awxResponse)),
    } as Response);

    const result = await attachCredentials(client, 99, [3]);

    // Should return the full AWX response body as-is
    expect(result).toEqual(awxResponse);
  });

  it("returns empty object when AWX response body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await attachCredentials(client, 10, [1]);

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 404 from invalid template_id", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () =>
        Promise.resolve(JSON.stringify({ detail: "Not found." })),
    } as Response);

    await expect(
      attachCredentials(client, 99999, [1]),
    ).rejects.toThrow("Not found.");

    // Only one API call should have been made (no retry on 4xx)
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 401 unauthorized", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            detail: "Authentication credentials were not provided.",
          }),
        ),
    } as Response);

    await expect(
      attachCredentials(client, 10, [1]),
    ).rejects.toThrow("Authentication credentials were not provided");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 403 forbidden", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            detail:
              "You do not have permission to perform this action.",
          }),
        ),
    } as Response);

    await expect(
      attachCredentials(client, 10, [7]),
    ).rejects.toThrow(
      "You do not have permission to perform this action.",
    );
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 400 bad request with invalid credential_id", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () =>
        Promise.resolve(
          JSON.stringify({ detail: "Invalid credential ID." }),
        ),
    } as Response);

    await expect(
      attachCredentials(client, 10, [-1]),
    ).rejects.toThrow("Invalid credential ID");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP 500 with non-JSON empty response", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    } as Response);

    await expect(
      attachCredentials(client, 10, [1]),
    ).rejects.toThrow(
      "AWX attach credential failed: HTTP 500: Internal Server Error",
    );

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
      attachCredentials(client, 10, [1]),
    ).rejects.toThrow(
      "AWX attach credential failed: HTTP 502: <html>Bad Gateway</html>",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("handles structured error detail object using JSON.stringify", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            detail: { field_errors: ["Invalid credential ID."] },
          }),
        ),
    } as Response);

    await expect(
      attachCredentials(client, 10, [1]),
    ).rejects.toThrow(
      '{"field_errors":["Invalid credential ID."]}',
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(JSON.stringify({ id: 1 })),
    } as Response);

    const controller = new AbortController();
    await attachCredentials(client, 10, [1], controller.signal);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      controller.signal,
    );
  });

  it("handles repeated attachment (idempotent re-attach)", async () => {
    const client = mockClient();
    // First call succeeds
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 10,
            summary_fields: {
              credentials: [{ id: 5, name: "Machine Credential" }],
            },
          }),
        ),
    } as Response);
    // Second call (re-attach same credential) also succeeds
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 10,
            summary_fields: {
              credentials: [{ id: 5, name: "Machine Credential" }],
            },
          }),
        ),
    } as Response);

    // Attach the same credential twice
    const result1 = await attachCredentials(client, 10, [5]);
    expect(result1).toHaveProperty("id", 10);

    const result2 = await attachCredentials(client, 10, [5]);
    expect(result2).toHaveProperty("id", 10);

    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("handles multiple credentials attachment", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 10,
            summary_fields: {
              credentials: [
                { id: 1, name: "SSH Key" },
                { id: 2, name: "Vault" },
                { id: 3, name: "Cloud Credential" },
              ],
            },
          }),
        ),
    } as Response);

    await attachCredentials(client, 10, [1, 2, 3]);

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ id: [1, 2, 3] }),
      }),
      undefined,
    );
  });
});
