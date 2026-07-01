/**
 * Attach Credential Tool Tests
 *
 * Validates the attachCredential thin-proxy behavior:
 * - POSTs credential_id to /api/v2/job_templates/{id}/credentials/
 * - Returns AWX response with credential association result
 * - Handles HTTP errors, abort signals, and edge cases
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
// attachCredential — Thin proxy that POSTs credential_id to AWX
// ============================================================================

describe("attachCredential", () => {
  it("posts credential_id to the template credentials endpoint", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () =>
        Promise.resolve(
          JSON.stringify({ id: 42, type: "credential", name: "my-cred" }),
        ),
    } as Response);

    await attachCredential(client, 10, 42);

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 42 }),
      },
      undefined,
    );
  });

  it("returns the raw AWX response body on success", async () => {
    const client = mockClient();
    const awxResponse = {
      id: 42,
      type: "credential",
      name: "my-cred",
      created: "2024-01-01T00:00:00Z",
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify(awxResponse)),
    } as Response);

    const result = await attachCredential(client, 10, 42);

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

    const result = await attachCredential(client, 10, 42);

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  // ── Error paths ────────────────────────────────────────────────

  it("throws error on 404 from invalid template_id", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve(JSON.stringify({ detail: "Not found." })),
    } as Response);

    await expect(
      attachCredential(client, 99999, 42),
    ).rejects.toThrow("Not found.");

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
          JSON.stringify({ detail: "Invalid credential ID." }),
        ),
    } as Response);

    await expect(
      attachCredential(client, 10, 99999),
    ).rejects.toThrow("Invalid credential ID.");

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
      attachCredential(client, 10, 42),
    ).rejects.toThrow(
      "AWX credential attachment failed: HTTP 500: Internal Server Error",
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
      attachCredential(client, 10, 42),
    ).rejects.toThrow(
      "AWX credential attachment failed: HTTP 502: <html>Bad Gateway</html>",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws error on 409 conflict (credential already attached)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: () =>
        Promise.resolve(
          JSON.stringify({ detail: "Credential is already attached." }),
        ),
    } as Response);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow("Credential is already attached.");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  // ── Abort signal ───────────────────────────────────────────────

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () =>
        Promise.resolve(JSON.stringify({ id: 1, type: "credential" })),
    } as Response);

    const controller = new AbortController();
    await attachCredential(client, 10, 42, controller.signal);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      controller.signal,
    );
  });

  it("propagates network failure (fetch throws)", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Network error: connection refused"),
    );

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow("Network error: connection refused");
  });

  // ── Edge cases ──────────────────────────────────────────────────

  it("handles large credential IDs", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 2147483647 })),
    } as Response);

    const result = await attachCredential(client, 10, 2147483647);

    expect(result).toEqual({ id: 2147483647 });
    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/10/credentials/",
      expect.objectContaining({
        body: JSON.stringify({ id: 2147483647 }),
      }),
      undefined,
    );
  });

  it("returns non-JSON AWX response body in error message", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve("Forbidden"),
    } as Response);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow(
      "AWX credential attachment failed: HTTP 403: Forbidden",
    );
  });

  it("uses the correct tool name for circuit breaker tracking", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () =>
        Promise.resolve(JSON.stringify({ id: 42, type: "credential" })),
    } as Response);

    await attachCredential(client, 10, 42);

    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      expect.any(String),
      expect.any(Object),
      undefined,
    );
  });
});
