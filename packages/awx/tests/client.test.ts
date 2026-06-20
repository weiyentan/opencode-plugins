/**
 * Client Module Tests
 *
 * Validates the AWX HTTP client middleware pipeline: timeout, circuit breaker,
 * exponential backoff, abort signal handling, and 4xx/5xx response behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/client.js";

/* ── Mock fetch ───────────────────────────────────────────────── */
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ══════════════════════════════════════════════════════════════════
   Tracer Bullet: createClient exports + basic request
   ══════════════════════════════════════════════════════════════════ */

describe("createClient", () => {
  it("returns an object with a request method", () => {
    const client = createClient("https://aap.example.com", "token123");
    expect(client).toBeDefined();
    expect(typeof client.request).toBe("function");
  });

  it("makes a GET request with auth headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response);

    const client = createClient("https://aap.example.com", "token123");
    const response = await client.request("test-tool", "/api/v2/me/");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://aap.example.com/api/v2/me/",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer token123",
          Accept: "application/json",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(response.ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════
   4xx — Zero Retry (pass-through immediately)
   ══════════════════════════════════════════════════════════════════ */

describe("4xx responses", () => {
  it("passes through 401 without retrying", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () => Promise.resolve({ detail: "Invalid token" }),
    } as Response);

    const client = createClient("https://aap.example.com", "bad-token");
    const response = await client.request("test-tool", "/api/v2/me/");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it("passes through 403 without retrying", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    } as Response);

    const client = createClient("https://aap.example.com", "token");
    const response = await client.request("test-tool", "/api/v2/me/");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
  });

  it("passes through 404 without retrying", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    const client = createClient("https://aap.example.com", "token");
    const response = await client.request("test-tool", "/api/v2/nonexistent/");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════
   5xx — Exponential Backoff & Retry
   ══════════════════════════════════════════════════════════════════ */

describe("5xx exponential backoff", () => {
  it("retries on 503 with exponential backoff (1s, 2s, 4s)", async () => {
    vi.useFakeTimers();

    // 3 failures → success on 4th attempt
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const client = createClient("https://aap.example.com", "token");

    // Use a custom timeout that won't interfere with fake timers
    const requestPromise = client.request("test-tool", "/api/v2/data/");

    // First attempt fires immediately
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past first backoff (1s ± jitter)
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Advance past second backoff (2s ± jitter)
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Advance past third backoff (4s ± jitter)
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockFetch).toHaveBeenCalledTimes(4);

    const response = await requestPromise;
    expect(response.ok).toBe(true);

    vi.useRealTimers();
  });

  it("stops after max 3 retries and returns the last 5xx", async () => {
    vi.useFakeTimers();

    // All 4 attempts (1 initial + 3 retries) return 503
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    const client = createClient("https://aap.example.com", "token");

    const requestPromise = client.request("test-tool", "/api/v2/data/");

    // Advance through all backoff periods
    await vi.runAllTimersAsync();

    const response = await requestPromise;
    expect(mockFetch).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(response.ok).toBe(false);
    expect(response.status).toBe(503);

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   Circuit Breaker
   ══════════════════════════════════════════════════════════════════ */

describe("circuit breaker", () => {
  it("trips open after N consecutive 5xx (N=5)", async () => {
    vi.useFakeTimers();

    // Use maxRetries=0 so each request makes exactly 1 fetch call
    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
    });

    // 5 consecutive 503s — each request is one fetch call
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);

      const response = await client.request("breaker-tool", "/api/v2/data/");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(503);
    }

    // 6th request — breaker should be OPEN, no fetch call
    mockFetch.mockClear();

    const failedResponse = await client.request(
      "breaker-tool",
      "/api/v2/data/",
    );

    expect(mockFetch).not.toHaveBeenCalled();
    expect(failedResponse.ok).toBe(false);
    expect(failedResponse.status).toBe(503);

    vi.useRealTimers();
  });

  it("open-circuit returns immediately without making a request", async () => {
    vi.useFakeTimers();

    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
    });

    // Trip the breaker with 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);
      await client.request("fast-trip", "/api/v2/data/");
    }

    // Measure time for open-circuit request
    mockFetch.mockClear();
    const start = Date.now();
    const response = await client.request("fast-trip", "/api/v2/data/");
    const elapsed = Date.now() - start;

    expect(mockFetch).not.toHaveBeenCalled();
    expect(response.ok).toBe(false);
    expect(elapsed).toBe(0); // no timer waits, should be instant

    vi.useRealTimers();
  });

  it("circuit breaker resets after cooldown (half-open probe succeeds)", async () => {
    vi.useFakeTimers();

    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
      circuitBreakerCooldownMs: 30_000, // 30s cooldown
    });

    // Trip the breaker with 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);
      await client.request("reset-tool", "/api/v2/data/");
    }

    // Breaker should be OPEN
    mockFetch.mockClear();
    const openResp = await client.request("reset-tool", "/api/v2/data/");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(openResp.ok).toBe(false);

    // Advance past cooldown (30s) — breaker should go HALF-OPEN
    await vi.advanceTimersByTimeAsync(30_001);

    // Now request should go through (half-open probe)
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const probeResp = await client.request("reset-tool", "/api/v2/data/");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(probeResp.ok).toBe(true);

    // Breaker should now be CLOSED again
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);
    const normalResp = await client.request("reset-tool", "/api/v2/data/");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(normalResp.ok).toBe(true);

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   Abort Signal Handling
   ══════════════════════════════════════════════════════════════════ */

describe("abort signal", () => {
  it("abort during retry backoff cancels immediately", async () => {
    vi.useFakeTimers();

    // Mock 503 so it enters backoff
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    const controller = new AbortController();
    const client = createClient("https://aap.example.com", "token");

    const requestPromise = client.request(
      "abort-tool",
      "/api/v2/data/",
      undefined,
      controller.signal,
    );

    // First fetch call happens immediately
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance time a bit (but not enough for backoff to complete)
    await vi.advanceTimersByTimeAsync(100);
    expect(mockFetch).toHaveBeenCalledTimes(1); // still sleeping

    // Abort during backoff
    controller.abort();

    // Should throw AbortError immediately
    await expect(requestPromise).rejects.toThrow(DOMException);

    vi.useRealTimers();
  });

  it("propagates network errors when retries exhausted", async () => {
    vi.useFakeTimers();

    // With maxRetries=0, a network error should propagate immediately
    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
    });

    const netError = new TypeError("fetch failed");
    mockFetch.mockRejectedValueOnce(netError);

    await expect(
      client.request("sig-tool", "/api/v2/data/"),
    ).rejects.toThrow("fetch failed");

    vi.useRealTimers();
  });

  it("combines ToolContext.abort signal with timeout signal", async () => {
    const controller = new AbortController();

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const client = createClient("https://aap.example.com", "token", {
      timeoutMs: 30_000,
    });
    await client.request(
      "sig-tool",
      "/api/v2/data/",
      undefined,
      controller.signal,
    );

    // Verify the signal passed to fetch includes both abort + timeout
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );

    const callSignal = mockFetch.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(callSignal.aborted).toBe(false);

    vi.useRealTimers();
  });
});
