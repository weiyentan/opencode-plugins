/**
 * Attach Credential Tool Tests
 *
 * Validates the attachCredential thin-proxy behavior:
 * - Correct POST request to /api/v2/job_templates/{id}/credentials/
 * - Credential ID is sent in the request body
 * - HTTP errors are surfaced correctly
 * - Abort signal is forwarded
 */
import { describe, it, expect, vi } from "vitest";
import { attachCredential } from "../src/attach-credential.js";
import type { AwxClient } from "../src/client.js";

/** Create a minimal mock AWX client */
function mockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

// ============================================================================
// attachCredential — Thin proxy that POSTs credential ID to AWX
// ============================================================================

describe("attachCredential", () => {
  it("sends correct POST request with credential id in body", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 42 })),
    } as Response);

    await attachCredential(client, 10, 99);

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 99 }),
      },
      undefined,
    );
  });

  it("returns raw AWX response body on success", async () => {
    const client = mockClient();
    const awxResponse = {
      id: 42,
      credential: 99,
      credential_name: "My Credential",
      url: "/api/v2/job_templates/10/credentials/42/",
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify(awxResponse)),
    } as Response);

    const result = await attachCredential(client, 10, 99);

    expect(result).toEqual(awxResponse);
  });

  it("returns empty object when AWX response body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await attachCredential(client, 10, 99);

    expect(result).toEqual({});
  });

  it("returns empty object for 204 No Content response", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 204,
      statusText: "No Content",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await attachCredential(client, 10, 99);

    expect(result).toEqual({});
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
      attachCredential(client, 99999, 99),
    ).rejects.toThrow("AWX attach credential failed: HTTP 404: Not found.");

    // Only one API call — no retry on 4xx
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 400 from invalid credential_id", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () =>
        Promise.resolve(
          JSON.stringify({ detail: "Credential does not exist." }),
        ),
    } as Response);

    await expect(
      attachCredential(client, 10, 99999),
    ).rejects.toThrow(
      "AWX attach credential failed: HTTP 400: Credential does not exist.",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 409 when credential is already attached", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: () =>
        Promise.resolve(
          JSON.stringify({
            detail: "This credential is already associated with the job template.",
          }),
        ),
    } as Response);

    await expect(
      attachCredential(client, 10, 99),
    ).rejects.toThrow(
      "AWX attach credential failed: HTTP 409: This credential is already associated with the job template.",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on HTTP error with empty non-JSON response", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    } as Response);

    await expect(
      attachCredential(client, 10, 99),
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
      attachCredential(client, 10, 99),
    ).rejects.toThrow(
      "AWX attach credential failed: HTTP 502: <html>Bad Gateway</html>",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on 401 (unauthorized)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () =>
        Promise.resolve(
          JSON.stringify({ detail: "Authentication credentials were not provided." }),
        ),
    } as Response);

    await expect(
      attachCredential(client, 10, 99),
    ).rejects.toThrow(
      "AWX attach credential failed: HTTP 401: Authentication credentials were not provided.",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 1 })),
    } as Response);

    const controller = new AbortController();
    await attachCredential(client, 10, 99, controller.signal);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      controller.signal,
    );
  });

  it("propagates abort error when request is cancelled", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException("The operation was aborted", "AbortError"),
    );

    await expect(
      attachCredential(client, 10, 99),
    ).rejects.toThrow(DOMException);

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("constructs correct URL with large template ID", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 1 })),
    } as Response);

    await attachCredential(client, 2147483647, 1);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      "/api/v2/job_templates/2147483647/credentials/",
      expect.any(Object),
      undefined,
    );
  });

  it("sends correct Content-Type header", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 1 })),
    } as Response);

    await attachCredential(client, 10, 99);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 99 }),
      },
      undefined,
    );
  });

  it("uses awx-attach-credential as the tool name on client request", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 1 })),
    } as Response);

    await attachCredential(client, 10, 99);

    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      expect.any(String),
      expect.any(Object),
      undefined,
    );
  });
});
