/**
 * Ping (Health Check) Tests
 *
 * Validates the fetchPing thin-proxy behavior:
 * - GET /api/v2/ping/ returns raw AWX response body
 * - HTTP errors are surfaced correctly
 * - AbortSignal is forwarded
 */
import { describe, it, expect, vi } from "vitest";
import { fetchPing } from "../src/ping.js";
import type { AwxClient } from "../src/client.js";

/** Create a minimal mock AWX client */
function mockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

/** Create a basic mock ping response body */
function mockPingBody(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    ha: false,
    version: "21.0.0",
    active_node: "awx-1",
    install_uuid: "abc-123-def-456",
    instances: [
      { node: "awx-1", node_type: "control", status: "running" },
      { node: "awx-2", node_type: "hybrid", status: "running" },
    ],
    instance_groups: [
      { name: "controlplane", id: 1 },
      { name: "execution", id: 2 },
    ],
    ...overrides,
  };
}

/** Create a mock HTTP Response from a body object */
function mockJsonResponse(body: Record<string, unknown>, status = 200, statusText = "OK"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as Response;
}

// ============================================================================
// fetchPing — Thin proxy that returns raw AWX ping response
// ============================================================================

describe("fetchPing", () => {
  it("returns raw AWX ping response body on success", async () => {
    const client = mockClient();
    const pingBody = mockPingBody();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse(pingBody),
    );

    const result = await fetchPing(client);

    expect(result).toEqual(pingBody);
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-ping",
      "/api/v2/ping/",
      { method: "GET", headers: { "Content-Type": "application/json" } },
      undefined,
    );
  });

  it("includes ha, version, active_node, install_uuid in response", async () => {
    const client = mockClient();
    const pingBody = mockPingBody({
      ha: true,
      version: "21.4.0",
      active_node: "awx-node-01",
      install_uuid: "uuid-789",
    });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse(pingBody),
    );

    const result = await fetchPing(client);

    expect(result.ha).toBe(true);
    expect(result.version).toBe("21.4.0");
    expect(result.active_node).toBe("awx-node-01");
    expect(result.install_uuid).toBe("uuid-789");
  });

  it("throws error on HTTP failure", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ detail: "Server Error" }, 500, "Internal Server Error"),
    );

    await expect(fetchPing(client)).rejects.toThrow("AWX ping failed: HTTP 500: Server Error");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("throws clear error on 401", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse({ detail: "Authentication credentials were not provided." }, 401, "Unauthorized"),
    );

    await expect(fetchPing(client)).rejects.toThrow("AWX ping failed: HTTP 401: Authentication credentials were not provided.");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("handles non-JSON response gracefully", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: () => Promise.resolve("<html>Bad Gateway</html>"),
      headers: new Headers({ "Content-Type": "text/html" }),
    } as Response);

    await expect(fetchPing(client)).rejects.toThrow("AWX ping failed: HTTP 502: <html>Bad Gateway</html>");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("forwards AbortSignal to the HTTP client", async () => {
    const client = mockClient();
    const pingBody = mockPingBody();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockJsonResponse(pingBody),
    );

    const controller = new AbortController();
    await fetchPing(client, controller.signal);

    expect(client.request).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Object),
      controller.signal,
    );
  });

  it("returns empty object when response body is empty", async () => {
    const client = mockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(""),
      headers: new Headers({ "Content-Type": "application/json" }),
    } as Response);

    const result = await fetchPing(client);

    expect(result).toEqual({});
    expect(client.request).toHaveBeenCalledTimes(1);
  });
});
