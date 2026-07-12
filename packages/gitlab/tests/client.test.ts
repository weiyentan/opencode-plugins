/**
 * Client Module Tests — GitLab Plugin
 *
 * Validates the GitLab HTTP client middleware pipeline: timeout,
 * circuit breaker, exponential backoff, abort signal handling,
 * 4xx/5xx response behavior, and rate-limit header parsing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createClient,
  CircuitBreaker,
  calcBackoff,
  sleepWithAbort,
  createTimeoutSignal,
  parseRateLimitHeaders,
} from "../src/client.js";

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
   createClient exports + basic request
   ══════════════════════════════════════════════════════════════════ */

describe("createClient", () => {
  it("returns an object with a request method", () => {
    const client = createClient("https://gitlab.com", "token123");
    expect(client).toBeDefined();
    expect(typeof client.request).toBe("function");
  });

  it("makes a GET request with auth headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({}),
    } as Response);

    const client = createClient("https://gitlab.com", "token123");
    const response = await client.request("test-tool", "/api/v4/user");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/user",
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

  it("includes parsed rate-limit headers in response", async () => {
    const responseHeaders = new Headers({
      "RateLimit-Limit": "2000",
      "RateLimit-Remaining": "1995",
      "RateLimit-Reset": "1730000000",
      "RateLimit-Observed": "5",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: responseHeaders,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    const client = createClient("https://gitlab.com", "token123");
    const response = await client.request("test-tool", "/api/v4/user");

    expect(response.rateLimit).toBeDefined();
    expect(response.rateLimit.limit).toBe(2000);
    expect(response.rateLimit.remaining).toBe(1995);
    expect(response.rateLimit.reset).toBe(1730000000);
    expect(response.rateLimit.observed).toBe(5);
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
      headers: new Headers(),
      json: () => Promise.resolve({ message: "Unauthorized" }),
    } as Response);

    const client = createClient("https://gitlab.com", "bad-token");
    const response = await client.request("test-tool", "/api/v4/user");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(401);
  });

  it("passes through 403 without retrying", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Headers(),
    } as Response);

    const client = createClient("https://gitlab.com", "token");
    const response = await client.request("test-tool", "/api/v4/user");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
  });

  it("passes through 404 without retrying", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: new Headers(),
    } as Response);

    const client = createClient("https://gitlab.com", "token");
    const response = await client.request(
      "test-tool",
      "/api/v4/nonexistent",
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════
   5xx — Exponential Backoff & Retry
   ══════════════════════════════════════════════════════════════════ */

describe("5xx exponential backoff", () => {
  it("retries on 503 with exponential backoff", async () => {
    vi.useFakeTimers();

    // 3 failures → success on 4th attempt
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
      } as Response);

    const client = createClient("https://gitlab.com", "token");

    const requestPromise = client.request("test-tool", "/api/v4/data");

    // First attempt fires immediately
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past first backoff
    await vi.advanceTimersByTimeAsync(1500);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Advance past second backoff
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Advance past third backoff
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
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response);

    const client = createClient("https://gitlab.com", "token");

    const requestPromise = client.request("test-tool", "/api/v4/data");

    await vi.runAllTimersAsync();

    const response = await requestPromise;
    expect(mockFetch).toHaveBeenCalledTimes(4);
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

    const client = createClient("https://gitlab.com", "token", {
      maxRetries: 0,
    });

    // 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response);

      const response = await client.request("breaker-tool", "/api/v4/data");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(503);
    }

    // 6th request — breaker should be OPEN, no fetch call
    mockFetch.mockClear();

    const failedResponse = await client.request("breaker-tool", "/api/v4/data");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(failedResponse.ok).toBe(false);
    expect(failedResponse.status).toBe(503);

    vi.useRealTimers();
  });

  it("open-circuit returns immediately without making a request", async () => {
    vi.useFakeTimers();

    const client = createClient("https://gitlab.com", "token", {
      maxRetries: 0,
    });

    // Trip the breaker with 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response);
      await client.request("fast-trip", "/api/v4/data");
    }

    mockFetch.mockClear();
    const start = Date.now();
    const response = await client.request("fast-trip", "/api/v4/data");
    const elapsed = Date.now() - start;

    expect(mockFetch).not.toHaveBeenCalled();
    expect(response.ok).toBe(false);
    expect(elapsed).toBe(0);

    vi.useRealTimers();
  });

  it("circuit breaker resets after cooldown (half-open probe succeeds)", async () => {
    vi.useFakeTimers();

    const client = createClient("https://gitlab.com", "token", {
      maxRetries: 0,
      circuitBreakerCooldownMs: 30_000,
    });

    // Trip the breaker with 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response);
      await client.request("reset-tool", "/api/v4/data");
    }

    // Breaker should be OPEN
    mockFetch.mockClear();
    const openResp = await client.request("reset-tool", "/api/v4/data");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(openResp.ok).toBe(false);

    // Advance past cooldown
    await vi.advanceTimersByTimeAsync(30_001);

    // Now request should go through (half-open probe)
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
    } as Response);

    const probeResp = await client.request("reset-tool", "/api/v4/data");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(probeResp.ok).toBe(true);

    // Breaker should now be CLOSED again
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
    } as Response);
    const normalResp = await client.request("reset-tool", "/api/v4/data");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(normalResp.ok).toBe(true);

    vi.useRealTimers();
  });

  it("half-open probe failure re-opens breaker", async () => {
    vi.useFakeTimers();

    const client = createClient("https://gitlab.com", "token", {
      maxRetries: 0,
      circuitBreakerCooldownMs: 30_000,
    });

    // Trip the breaker with 5 consecutive 503s
    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response);
      await client.request("halfopen-tool", "/api/v4/data");
    }

    // Advance past cooldown
    await vi.advanceTimersByTimeAsync(30_001);

    // Half-open probe request — this one fails
    mockFetch.mockClear();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
    } as Response);

    let resp = await client.request("halfopen-tool", "/api/v4/data");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(resp.ok).toBe(false);
    expect(resp.status).toBe(503);

    // Breaker should be OPEN again — next request should fast-fail
    mockFetch.mockClear();
    resp = await client.request("halfopen-tool", "/api/v4/data");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(resp.status).toBe(503);

    vi.useRealTimers();
  });

  it("repeated 401s do not trip the circuit breaker", async () => {
    vi.useFakeTimers();

    const client = createClient("https://gitlab.com", "token", {
      circuitBreakerThreshold: 2,
      maxRetries: 0,
    });

    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        json: () => Promise.resolve({ message: "Unauthorized" }),
      } as Response);

      const response = await client.request("4xx-breaker-test", "/api/v4/user");

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

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers(),
    } as Response);

    const controller = new AbortController();
    const client = createClient("https://gitlab.com", "token");

    const requestPromise = client.request(
      "abort-tool",
      "/api/v4/data",
      undefined,
      controller.signal,
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    controller.abort();

    await expect(requestPromise).rejects.toThrow(DOMException);

    vi.useRealTimers();
  });

  it("propagates network errors when retries exhausted", async () => {
    vi.useFakeTimers();

    const client = createClient("https://gitlab.com", "token", {
      maxRetries: 0,
    });

    const netError = new TypeError("fetch failed");
    mockFetch.mockRejectedValueOnce(netError);

    await expect(
      client.request("sig-tool", "/api/v4/data"),
    ).rejects.toThrow("fetch failed");

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   Timeout Scenario
   ══════════════════════════════════════════════════════════════════ */

describe("timeout scenario", () => {
  it("aborts when timeout elapses before fetch completes", async () => {
    vi.useFakeTimers();

    mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });

    const client = createClient("https://gitlab.com", "token", {
      timeoutMs: 10_000,
    });

    const requestPromise = client.request("timeout-tool", "/api/v4/data");
    requestPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(10_001);

    await expect(requestPromise).rejects.toThrow(DOMException);
    await expect(requestPromise).rejects.toMatchObject({ name: "AbortError" });

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   Caller-Supplied Headers Merge
   ══════════════════════════════════════════════════════════════════ */

describe("caller-supplied headers", () => {
  it("merges caller headers with default headers (caller wins on conflict)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
    } as Response);

    const client = createClient("https://gitlab.com", "token");

    await client.request("header-tool", "/api/v4/data", {
      headers: {
        "X-Custom": "custom-value",
        Accept: "text/plain",
      },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchArgs = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = fetchArgs.headers as Record<string, string>;

    expect(headers["Authorization"]).toBe("Bearer token");
    expect(headers["Accept"]).toBe("text/plain");
    expect(headers["X-Custom"]).toBe("custom-value");
  });
});

/* ══════════════════════════════════════════════════════════════════
   Circuit-Open Response — JSON body fields
   ══════════════════════════════════════════════════════════════════ */

describe("circuit-open response", () => {
  it("returns code and message fields in json body", async () => {
    vi.useFakeTimers();

    const client = createClient("https://gitlab.com", "token", {
      maxRetries: 0,
    });

    for (let i = 0; i < 5; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers(),
      } as Response);
      await client.request("json-tool", "/api/v4/data");
    }

    mockFetch.mockClear();
    const response = await client.request("json-tool", "/api/v4/data");

    expect(response.status).toBe(503);
    expect(response.ok).toBe(false);

    const body = await response.json();
    expect(body).toHaveProperty("code", "CIRCUIT_OPEN");
    expect(body).toHaveProperty("message");
    expect(typeof body.message).toBe("string");

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   CircuitBreaker class
   ══════════════════════════════════════════════════════════════════ */

describe("CircuitBreaker class", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker(3, 10_000);
    expect(cb.getState().state).toBe("closed");
    expect(cb.tryAcquire()).toBe(true);
  });

  it("trips after threshold failures", () => {
    const cb = new CircuitBreaker(3, 10_000);

    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    expect(cb.getState().state).toBe("open");
    expect(cb.tryAcquire()).toBe(false);
  });

  it("goes to half-open after cooldown", () => {
    vi.useFakeTimers();

    const cb = new CircuitBreaker(2, 5_000);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe("open");

    vi.advanceTimersByTime(5_001);

    expect(cb.tryAcquire()).toBe(true);
    expect(cb.getState().state).toBe("half-open");

    vi.useRealTimers();
  });

  it("resets to closed on success", () => {
    const cb = new CircuitBreaker(3, 10_000);

    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();

    expect(cb.getState().state).toBe("closed");
    expect(cb.getState().failureCount).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   calcBackoff
   ══════════════════════════════════════════════════════════════════ */

describe("calcBackoff", () => {
  it("returns a positive number", () => {
    const delay = calcBackoff(0);
    expect(delay).toBeGreaterThan(0);
  });

  it("increases exponentially", () => {
    const d0 = calcBackoff(0);
    const d1 = calcBackoff(1);
    const d2 = calcBackoff(2);

    // On average, higher attempts should have larger backoffs
    // (jitter makes exact comparison unreliable, but max values increase)
    expect(d2).toBeGreaterThan(d0);
  });
});

/* ══════════════════════════════════════════════════════════════════
   createTimeoutSignal
   ══════════════════════════════════════════════════════════════════ */

describe("createTimeoutSignal", () => {
  it("signal fires after the specified timeout", async () => {
    vi.useFakeTimers();

    const { signal, clear } = createTimeoutSignal(5_000);
    expect(signal.aborted).toBe(false);

    vi.advanceTimersByTime(5_001);

    expect(signal.aborted).toBe(true);

    await vi.runAllTimersAsync();
    clear();
    vi.useRealTimers();
  });

  it("clear prevents the timeout from firing", () => {
    vi.useFakeTimers();

    const { signal, clear } = createTimeoutSignal(5_000);
    clear();
    vi.advanceTimersByTime(10_000);

    expect(signal.aborted).toBe(false);

    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   sleepWithAbort
   ══════════════════════════════════════════════════════════════════ */

describe("sleepWithAbort", () => {
  it("completes after the specified duration", async () => {
    vi.useFakeTimers();

    const sleepPromise = sleepWithAbort(1000);
    await vi.advanceTimersByTimeAsync(1001);
    await sleepPromise;

    vi.useRealTimers();
  });

  it("aborts immediately if signal fires", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const sleepPromise = sleepWithAbort(5000, controller.signal);

    controller.abort();

    await expect(sleepPromise).rejects.toThrow(DOMException);

    vi.useRealTimers();
  });

  it("cleans up abort listener after successful sleep", async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const signal = controller.signal;

    const removeSpy = vi.spyOn(signal, "removeEventListener");

    const sleepPromise = sleepWithAbort(1000, signal);
    await vi.advanceTimersByTimeAsync(1001);
    await sleepPromise;

    expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));

    removeSpy.mockRestore();
    vi.useRealTimers();
  });
});

/* ══════════════════════════════════════════════════════════════════
   parseRateLimitHeaders
   ══════════════════════════════════════════════════════════════════ */

describe("parseRateLimitHeaders", () => {
  it("parses all GitLab rate-limit headers", () => {
    const headers = new Headers({
      "RateLimit-Limit": "2000",
      "RateLimit-Remaining": "1995",
      "RateLimit-Reset": "1730000000",
      "RateLimit-Observed": "5",
      "Retry-After": "60",
    });

    const response = { headers } as Response;
    const info = parseRateLimitHeaders(response);

    expect(info.limit).toBe(2000);
    expect(info.remaining).toBe(1995);
    expect(info.reset).toBe(1730000000);
    expect(info.observed).toBe(5);
    expect(info.retryAfter).toBe(60);
  });

  it("returns null for missing headers", () => {
    const headers = new Headers();
    const response = { headers } as Response;
    const info = parseRateLimitHeaders(response);

    expect(info.limit).toBeNull();
    expect(info.remaining).toBeNull();
    expect(info.reset).toBeNull();
    expect(info.observed).toBeNull();
    expect(info.retryAfter).toBeNull();
  });

  it("returns null for non-numeric header values", () => {
    const headers = new Headers({
      "RateLimit-Limit": "not-a-number",
    });

    const response = { headers } as Response;
    const info = parseRateLimitHeaders(response);

    expect(info.limit).toBeNull();
  });
});
