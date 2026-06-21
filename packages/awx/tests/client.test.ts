/**
 * Client Module Tests
 *
 * Validates the AWX HTTP client middleware pipeline: timeout, circuit breaker,
 * exponential backoff, abort signal handling, and 4xx/5xx response behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/client.js";
import { MetricsStore } from "../src/metrics.js";

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
   Circuit Breaker — 4xx Exclusion
   ══════════════════════════════════════════════════════════════════ */

describe("circuit breaker — 4xx exclusion", () => {
  it("repeated 401s do not trip the circuit breaker", async () => {
    vi.useFakeTimers();

    const client = createClient("https://aap.example.com", "token", {
      circuitBreakerThreshold: 2,
      maxRetries: 0,
    });

    // 5 consecutive 401s — if the breaker counted 4xx failures,
    // it would trip after 2 and return 503 for the 3rd+.
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: () => Promise.resolve({ detail: "Invalid token" }),
      } as Response);

      const response = await client.request(
        "4xx-breaker-test",
        "/api/v2/me/",
      );

      // Must be the original 401, not a 503 circuit-open
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    }

    // All requests went through to fetch — breaker never blocked
    expect(mockFetch).toHaveBeenCalledTimes(5);

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

/* ══════════════════════════════════════════════════════════════════
   Timeout Scenario — AbortSignal.timeout fires and aborts
   ══════════════════════════════════════════════════════════════════ */

describe("timeout scenario", () => {
  it("aborts when timeout elapses before fetch completes", async () => {
    vi.useFakeTimers();

    // Mock fetch that hangs forever (never settles) but rejects when the
    // abort signal fires.  We return the abort promise directly rather than
    // Promise.race to avoid unhandled-rejection warnings with vitest fake
    // timers (the race's internal .then() may be attached too late when the
    // abort fires during fake-timer advancement).
    mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });

    const client = createClient("https://aap.example.com", "token", {
      timeoutMs: 10_000,
    });

    const requestPromise = client.request("timeout-tool", "/api/v2/data/");

    // Attach a no-op rejection handler BEFORE advancing time so that
    // Node.js does not see an unhandled rejection when the timeout fires
    // and the async function's return promise rejects during fake timer
    // advancement (before we can reach expect().rejects).
    requestPromise.catch(() => {});

    // Advance fake timers past the timeout
    await vi.advanceTimersByTimeAsync(10_001);

    await expect(requestPromise).rejects.toThrow(DOMException);
    await expect(requestPromise).rejects.toMatchObject({ name: "AbortError" });

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   Circuit Breaker — Half-open probe failure re-opens
   ══════════════════════════════════════════════════════════════════ */

describe("circuit breaker half-open probe failure", () => {
  it("re-opens breaker when half-open probe fails", async () => {
    vi.useFakeTimers();

    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
      circuitBreakerCooldownMs: 30_000,
    });

    // Trip the breaker with 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);
      await client.request("halfopen-tool", "/api/v2/data/");
    }

    // Breaker should be OPEN
    mockFetch.mockClear();
    let resp = await client.request("halfopen-tool", "/api/v2/data/");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(resp.status).toBe(503);

    // Advance past cooldown (30s) — breaker goes HALF-OPEN
    await vi.advanceTimersByTimeAsync(30_001);

    // Half-open probe request — this one fails
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as Response);

    resp = await client.request("halfopen-tool", "/api/v2/data/");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(503);

    // Breaker should be OPEN again — next request should fast-fail
    mockFetch.mockClear();
    resp = await client.request("halfopen-tool", "/api/v2/data/");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(resp.status).toBe(503);

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   Caller-Supplied Headers Merge Override
   ══════════════════════════════════════════════════════════════════ */

describe("caller-supplied headers", () => {
  it("merges caller headers with default headers (caller wins on conflict)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const client = createClient("https://aap.example.com", "token");

    await client.request("header-tool", "/api/v2/data/", {
      headers: {
        "X-Custom": "custom-value",
        Accept: "text/plain", // should override default Accept
      },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchArgs = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = fetchArgs.headers as Record<string, string>;

    expect(headers["Authorization"]).toBe("Bearer token");
    expect(headers["Accept"]).toBe("text/plain"); // caller wins
    expect(headers["X-Custom"]).toBe("custom-value");
  });

  it("merges Headers instance with default headers", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const client = createClient("https://aap.example.com", "token");

    const customHeaders = new Headers({
      "X-Custom": "custom-value",
    });

    await client.request("header-tool", "/api/v2/data/", {
      headers: customHeaders,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchArgs = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = fetchArgs.headers as Record<string, string>;

    expect(headers["Authorization"]).toBe("Bearer token");
    // Headers.normalize keys to lowercase via Object.fromEntries(entries())
    expect(headers["x-custom"]).toBe("custom-value");
  });
});

/* ══════════════════════════════════════════════════════════════════
   Circuit-Open Response — JSON body fields
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   Metrics Accounting — recordCall + recordError in finally block
   ══════════════════════════════════════════════════════════════════ */

describe("metrics accounting", () => {
  it("records call and error for circuit-breaker-open synthetic 503", async () => {
    vi.useFakeTimers();

    const metrics = new MetricsStore();
    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
      metricsStore: metrics,
    });

    // Trip the breaker with 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
      await client.request("metrics-cbo", "/api/v2/data/");
    }

    // Verify metrics after the trip
    const afterTrip = metrics.getMetrics("metrics-cbo");
    expect(afterTrip.callCount).toBe(5);
    expect(afterTrip.errorCount).toBe(5);

    // Clear mock and make one more request (breaker is open)
    mockFetch.mockClear();
    const response = await client.request("metrics-cbo", "/api/v2/data/");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(503);

    // Verify metrics after circuit-open rejection
    const afterOpen = metrics.getMetrics("metrics-cbo");
    expect(afterOpen.callCount).toBe(6);  // 5 failed calls + 1 circuit-open
    expect(afterOpen.errorCount).toBe(6); // 5 failures + circuit-open = error

    vi.useRealTimers();
  });

  it("records call for 2xx success and no error", async () => {
    const metrics = new MetricsStore();
    const client = createClient("https://aap.example.com", "token", {
      metricsStore: metrics,
    });

    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await client.request("metrics-ok", "/api/v2/me/");

    const m = metrics.getMetrics("metrics-ok");
    expect(m.callCount).toBe(1);
    expect(m.errorCount).toBe(0);
  });

  it("records call and error for 4xx response", async () => {
    const metrics = new MetricsStore();
    const client = createClient("https://aap.example.com", "token", {
      metricsStore: metrics,
    });

    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    const response = await client.request("metrics-4xx", "/api/v2/nonexistent/");
    expect(response.status).toBe(404);

    const m = metrics.getMetrics("metrics-4xx");
    expect(m.callCount).toBe(1);
    expect(m.errorCount).toBe(1);
  });

  it("records call and error for 5xx after retries exhausted", async () => {
    vi.useFakeTimers();

    const metrics = new MetricsStore();
    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 1, // 2 total attempts
      metricsStore: metrics,
    });

    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response);

    const requestPromise = client.request("metrics-5xx", "/api/v2/data/");
    await vi.runAllTimersAsync();
    const response = await requestPromise;
    expect(response.status).toBe(503);

    const m = metrics.getMetrics("metrics-5xx");
    // After retries exhausted, recordCall fires once per request() invocation
    expect(m.callCount).toBe(1);
    expect(m.errorCount).toBe(1);

    vi.useRealTimers();
  });

  it("records call and error for network error after retries exhausted", async () => {
    vi.useFakeTimers();

    const metrics = new MetricsStore();
    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
      metricsStore: metrics,
    });

    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(
      client.request("metrics-net", "/api/v2/data/"),
    ).rejects.toThrow("fetch failed");

    const m = metrics.getMetrics("metrics-net");
    expect(m.callCount).toBe(1);
    expect(m.errorCount).toBe(1);

    vi.useRealTimers();
  });

  it("records call but not error on abort (finally runs, error is a cancellation)", async () => {
    vi.useFakeTimers();

    // Mock fetch to honor the abort signal (real fetch rejects with
    // DOMException when the signal is already aborted)
    mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      });
    });

    const metrics = new MetricsStore();
    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
      metricsStore: metrics,
    });

    const controller = new AbortController();
    const requestPromise = client.request(
      "metrics-abort",
      "/api/v2/data/",
      undefined,
      controller.signal,
    );
    controller.abort();

    await expect(requestPromise).rejects.toThrow(DOMException);

    // recordCall fires from finally even when the promise rejects
    const m = metrics.getMetrics("metrics-abort");
    expect(m.callCount).toBe(1);
    // AbortError is a cancellation, not a request error — no recordError
    expect(m.errorCount).toBe(0);

    vi.useRealTimers();
  });
});

describe("circuit-open response", () => {
  it("returns code and message fields in json body", async () => {
    vi.useFakeTimers();

    // Trip the breaker
    const client = createClient("https://aap.example.com", "token", {
      maxRetries: 0,
    });

    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      } as Response);
      await client.request("json-tool", "/api/v2/data/");
    }

    // Now circuit is open
    mockFetch.mockClear();
    const response = await client.request("json-tool", "/api/v2/data/");

    expect(response.status).toBe(503);
    expect(response.ok).toBe(false);

    // Parse JSON body
    const body = await response.json();
    expect(body).toHaveProperty("code", "CIRCUIT_OPEN");
    expect(body).toHaveProperty("message");
    expect(typeof body.message).toBe("string");

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   sleepWithAbort — Listener cleanup (memory leak)
   ══════════════════════════════════════════════════════════════════ */

describe("sleepWithAbort", () => {
  it("cleans up abort listener after successful sleep", async () => {
    vi.useFakeTimers();

    const { sleepWithAbort } = await import("../src/client.js");
    const controller = new AbortController();
    const signal = controller.signal;

    // Spy on removeEventListener
    const removeSpy = vi.spyOn(signal, "removeEventListener");

    const sleepPromise = sleepWithAbort(1000, signal);

    // Advance time to complete the sleep
    await vi.advanceTimersByTimeAsync(1001);
    await sleepPromise;

    // The abort listener should have been removed
    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    removeSpy.mockRestore();
    vi.useRealTimers();
  });
});
