/**
 * Attach Credential Tool Tests
 *
 * Validates the attachCredential thin-proxy behavior:
 * - credential_id is forwarded to the AWX API as POST body
 * - raw AWX response body is returned as-is
 * - HTTP errors are surfaced with clear messages
 * - AbortSignal is propagated to the client
 *
 * Merged from issue #108 (TDD RED/GREEN/REFACTOR cycles)
 * and issue #109 (edge case coverage).
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
// attachCredential — Success paths
// ============================================================================

describe("attachCredential", () => {
  /* ── Successful response ─────────────────────────────────── */

  it("returns raw AWX response on successful attachment", async () => {
    const client = mockClient();
    const awxResponse = {
      id: 42,
      type: "credential",
      name: "SSH Key",
      credential_type: 1,
      url: "/api/v2/credentials/42/",
      related: {},
      summary_fields: {},
      created: "2025-01-15T10:30:00Z",
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify(awxResponse)),
    } as Response);

    const result = await attachCredential(client, 10, 42);

    expect(result).toEqual(awxResponse);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── Correct endpoint and body ───────────────────────────── */

  it("sends POST to correct endpoint with credential id in body", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 99 })),
    } as Response);

    await attachCredential(client, 15, 99);

    expect(client.request).toHaveBeenCalledWith(
      "awx-attach-credential",
      "/api/v2/job_templates/15/credentials/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 99 }),
      },
      undefined,
    );
  });

  /* ── Content-Type header ─────────────────────────────────── */

  it("sets Content-Type application/json header", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 42 })),
    } as Response);

    await attachCredential(client, 10, 42);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
      }),
      undefined,
    );
  });

  /* ── Empty response body (204 No Content) ────────────────── */

  it("returns empty object when AWX response body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 204,
      statusText: "No Content",
      text: () => Promise.resolve(""),
    } as Response);

    const result = await attachCredential(client, 10, 42);

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── Large credential IDs ────────────────────────────────── */

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

  // ============================================================================
  // Error paths
  // ============================================================================

  /* ── 404 not found ───────────────────────────────────────── */

  it("throws clear error on 404 template not found", async () => {
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

  /* ── 400 bad request ─────────────────────────────────────── */

  it("throws clear error on 400 invalid credential ID", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () => Promise.resolve(JSON.stringify({ detail: "Invalid credential ID." })),
    } as Response);

    await expect(
      attachCredential(client, 10, -1),
    ).rejects.toThrow(/invalid credential/i);

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── 401 unauthorized ────────────────────────────────────── */

  it("throws clear error on 401 unauthorized", async () => {
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
      attachCredential(client, 10, 42),
    ).rejects.toThrow(/credentials/i);

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── 409 conflict ────────────────────────────────────────── */

  it("throws clear error on 409 credential already attached", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      text: () =>
        Promise.resolve(
          JSON.stringify({ detail: "Credential is already attached to this template." }),
        ),
    } as Response);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow(/already attached/i);

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── 500 with JSON detail ────────────────────────────────── */

  it("throws clear error on 500 with JSON detail", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () =>
        Promise.resolve(
          JSON.stringify({ detail: "Database connection timeout" }),
        ),
    } as Response);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow(/Database connection timeout/);

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── Non-JSON error body (HTML) ──────────────────────────── */

  it("throws with status text fallback for non-JSON error body", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve("<html>Internal Server Error</html>"),
    } as Response);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow(
      "AWX credential attachment failed: HTTP 500: <html>Internal Server Error</html>",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── Empty error body ────────────────────────────────────── */

  it("uses status text as fallback when error body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: () => Promise.resolve(""),
    } as Response);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow(
      "AWX credential attachment failed: HTTP 403: Forbidden",
    );

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  /* ── Non-JSON plain text error body ──────────────────────── */

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

  /* ── 502 HTML error body ─────────────────────────────────── */

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

  // ============================================================================
  // Abort signal
  // ============================================================================

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 1, type: "credential" })),
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

  // ============================================================================
  // Network errors
  // ============================================================================

  it("propagates network errors from client", async () => {
    const client = mockClient();
    const netError = new TypeError("fetch failed");
    (client.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(netError);

    await expect(
      attachCredential(client, 10, 42),
    ).rejects.toThrow("fetch failed");

    expect(client.request).toHaveBeenCalledTimes(1);
  });

  // ============================================================================
  // Circuit breaker tool name
  // ============================================================================

  it("uses correct tool name for circuit breaker tracking", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      statusText: "Created",
      text: () => Promise.resolve(JSON.stringify({ id: 42, type: "credential" })),
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
