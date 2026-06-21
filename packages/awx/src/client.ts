/**
 * client.ts — HTTP middleware pipeline for the AWX plugin.
 *
 * Composes five middleware concerns into a single request pipeline:
 *   signal → timeout → breaker gate → fetch → retry/backoff
 *
 * ## Pipeline
 *
 *  1. Combine ToolContext.abort signal + timeout signal
 *  2. Circuit breaker gate (per-tool)
 *  3. Native fetch with Authorization header
 *  4. Response handling: 2xx pass, 4xx no retry, 5xx exponential backoff
 *
 * ## Reference
 *
 *  - ADR 0006: Connection Resilience Parameters
 *  - docs/client-middleware-design.md
 */
import { MetricsStore } from "./metrics.js";

/* ── Retry / Backoff parameters ─────────────────────────────────── */

/** Default max retries (3 retries = 4 total attempts) */
const DEFAULT_MAX_RETRIES = 3;

/** Base backoff delay in milliseconds */
const BACKOFF_BASE_MS = 1000;

/** Backoff multiplier (exponential) */
const BACKOFF_MULTIPLIER = 2;

/** Jitter range: 0 to 50% of calculated delay */
const JITTER_RATIO = 0.5;

/* ── Pure utility functions ────────────────────────────────────── */

/**
 * Calculate the exponential backoff delay for a given retry attempt.
 *
 * Formula: base * multiplier^attempt + random(0, jitterRatio * calculated)
 *
 * Attempt 0 → 1000ms + 0-500ms jitter
 * Attempt 1 → 2000ms + 0-1000ms jitter
 * Attempt 2 → 4000ms + 0-2000ms jitter
 *
 * @param attempt  0-based retry attempt index
 * @returns Delay in milliseconds
 */
export function calcBackoff(attempt: number): number {
  const base = BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt);
  const jitter = Math.random() * base * JITTER_RATIO;
  return Math.round(base + jitter);
}

/**
 * Sleep for a given duration, aborting immediately if the signal fires.
 *
 * Used during retry backoff so that an abort (ToolContext.abort or timeout)
 * cancels the wait immediately instead of waiting for the backoff to elapse.
 *
 * @param ms      Duration in milliseconds
 * @param signal  Optional AbortSignal — abort listener fires, wait cancels
 */
export async function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason ?? new DOMException("Aborted", "AbortError"));
    };

    const timer = setTimeout(() => {
      resolve();
      signal?.removeEventListener("abort", onAbort);
    }, ms);

    if (!signal) return;

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/* ── Node 18 Compatibility Helpers ─────────────────────────────── */

/**
 * Create an AbortSignal that triggers after the specified timeout.
 *
 * Uses `setTimeout` + `AbortController` rather than `AbortSignal.timeout()`
 * for Node 18 compatibility and to ensure compatibility with vitest fake
 * timers (the native `AbortSignal.timeout()` uses internal Node.js timers
 * that cannot be mocked by vitest).
 */
export function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    ms,
  );
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/**
 * Combine multiple AbortSignals into one — aborts if ANY source signal aborts.
 *
 * Uses `AbortSignal.any()` on Node 20+ (where it is natively available),
 * and falls back to manual event wiring on Node 18.
 */
function anyAbortSignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return controller.signal;
    }
    signal.addEventListener("abort", () => {
      controller.abort(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }
  return controller.signal;
}

/* ── Types ─────────────────────────────────────────────────────── */

/** Options for createClient */
export interface ClientOptions {
  /** Request timeout in milliseconds (default: 30_000) */
  timeoutMs?: number;
  /** Maximum retries on 5xx (default: 3) */
  maxRetries?: number;
  /** Circuit breaker trip threshold — consecutive errors before opening (default: 5) */
  circuitBreakerThreshold?: number;
  /** Circuit breaker cooldown in ms (default: 30_000) */
  circuitBreakerCooldownMs?: number;
  /**
   * Optional shared MetricsStore for plugin-level persistence lifecycle.
   * If not provided, a new MetricsStore is created internally.
   * Pass the plugin-level store here so that periodic persist and
   * init-time load are effective across all tools.
   */
  metricsStore?: MetricsStore;
}

/** The AWX HTTP client returned by createClient */
export interface AwxClient {
  /**
   * Send an HTTP request through the middleware pipeline.
   *
   * @param toolName  Per-tool circuit breaker identifier
   * @param path      API path (e.g., "/api/v2/job_templates/")
   * @param init      Fetch options (method, body, headers)
   * @param abortSignal  Optional ToolContext.abort signal for cancellation
   */
  request(
    toolName: string,
    path: string,
    init?: RequestInit,
    abortSignal?: AbortSignal,
  ): Promise<Response>;
}

/* ── Circuit Breaker ────────────────────────────────────────────── */

/** Circuit breaker state */
export type BreakerStateKind = "closed" | "open" | "half-open";

/** Per-tool circuit breaker state */
export interface BreakerState {
  state: BreakerStateKind;
  failureCount: number;
  cooldownUntil: number | null; // Date.now() timestamp
}

/**
 * Circuit breaker for per-tool request resilience.
 *
 * - **CLOSED**: Normal operation, requests pass through.
 * - **OPEN**: Tripped after N consecutive failures. Requests rejected immediately.
 * - **HALF-OPEN**: After cooldown elapses, one probe request is allowed.
 *   Success → CLOSED, Failure → OPEN again.
 *
 * Uses `Date.now()` for time which works with vitest fake timers
 * (vi.useFakeTimers() mocks Date by default).
 */
export class CircuitBreaker {
  private state: BreakerStateKind = "closed";
  private failureCount = 0;
  private cooldownUntil: number | null = null;
  private readonly tripThreshold: number;
  private readonly cooldownMs: number;

  /**
   * @param tripThreshold  Consecutive failures before opening (default: 5)
   * @param cooldownMs     Milliseconds before transitioning OPEN → HALF-OPEN (default: 30_000)
   */
  constructor(tripThreshold = 5, cooldownMs = 30_000) {
    this.tripThreshold = tripThreshold;
    this.cooldownMs = cooldownMs;
  }

  /**
   * Try to acquire permission to make a request through the breaker.
   *
   * Has a side effect: if OPEN and cooldown has elapsed, transitions to
   * HALF-OPEN to allow a probe request.
   *
   * - OPEN: Returns false if still in cooldown. If cooldown elapsed, transitions
   *   to HALF-OPEN and returns true (probe allowed).
   * - HALF-OPEN or CLOSED: Returns true.
   */
  tryAcquire(): boolean {
    if (this.state === "open") {
      const now = Date.now();
      if (this.cooldownUntil !== null && now >= this.cooldownUntil) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }

  /** Record a successful request — resets the breaker to CLOSED. */
  recordSuccess(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.cooldownUntil = null;
  }

  /**
   * Record a failed request.
   *
   * Increments the failure counter. If the trip threshold is reached, opens the
   * breaker and sets the cooldown timer.
   *
   * In HALF-OPEN state, a single failure immediately re-opens the breaker.
   */
  recordFailure(): void {
    this.failureCount++;

    if (this.failureCount >= this.tripThreshold) {
      this.state = "open";
      this.cooldownUntil = Date.now() + this.cooldownMs;
    } else if (this.state === "half-open") {
      // Half-open failure → back to open with new cooldown
      this.state = "open";
      this.cooldownUntil = Date.now() + this.cooldownMs;
    }
  }

  /** Get the current breaker state (for testing/diagnostics). */
  getState(): BreakerState {
    return {
      state: this.state,
      failureCount: this.failureCount,
      cooldownUntil: this.cooldownUntil,
    };
  }
}

/* ── Factory ───────────────────────────────────────────────────── */

/**
 * Create an AWX HTTP client with middleware pipeline.
 *
 * @param baseUrl  The AAP base URL (e.g., "https://example.com")
 * @param token    Bearer token (PAT) for Authorization header
 * @param opts     Optional client configuration
 */
export function createClient(
  baseUrl: string,
  token: string,
  opts?: ClientOptions,
): AwxClient {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const breakerThreshold = opts?.circuitBreakerThreshold ?? 5;
  const breakerCooldownMs = opts?.circuitBreakerCooldownMs ?? 30_000;

  // Per-tool circuit breakers
  const breakers = new Map<string, CircuitBreaker>();

  /** Get or create a circuit breaker for a tool */
  function breakerFor(toolName: string): CircuitBreaker {
    let breaker = breakers.get(toolName);
    if (!breaker) {
      breaker = new CircuitBreaker(breakerThreshold, breakerCooldownMs);
      breakers.set(toolName, breaker);
    }
    return breaker;
  }

  // Shared metrics store instance (use injected store or create new one)
  const metrics = opts?.metricsStore ?? new MetricsStore();

  /** Create a spec-compliant 503 Response for when the circuit breaker is open */
  function circuitOpenResponse(): Response {
    const body = JSON.stringify({
      code: "CIRCUIT_OPEN",
      message:
        "AWX circuit breaker is open — AAP may be unreachable. Try again in 30s.",
      retryable: true,
    });
    return new Response(body, {
      status: 503,
      statusText: "Circuit breaker open",
      headers: { "Content-Type": "application/json" },
    });
  }

  return {
    async request(
      toolName: string,
      path: string,
      init?: RequestInit,
      abortSignal?: AbortSignal,
    ): Promise<Response> {
      const start = Date.now();

      // Build full URL
      const url = `${normalizedBase}${path.startsWith("/") ? path.slice(1) : path}`;

      // Combine abort signals: ToolContext.abort + timeout
      const { signal: timeoutSignal, clear: clearTimeout_ } = createTimeoutSignal(timeoutMs);
      const combinedSignal = abortSignal
        ? anyAbortSignal([abortSignal, timeoutSignal])
        : timeoutSignal;

      // Build headers (plain object for testability — fetch accepts both)
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      };

      // Merge caller-supplied headers (caller wins on conflicts)
      if (init?.headers) {
        const callerHeaders =
          init.headers instanceof Headers
            ? Object.fromEntries(init.headers.entries())
            : Array.isArray(init.headers)
              ? Object.fromEntries(init.headers)
              : init.headers;
        Object.assign(headers, callerHeaders);
      }

      const fetchInit: RequestInit = {
        method: init?.method ?? "GET",
        headers,
        body: init?.body,
        signal: combinedSignal,
      };

      const breaker = breakerFor(toolName);

      // ── Track outcome for metrics ──
      let recordedError = false;

      // ── Middleware pipeline ──
      try {
        // ── Retry loop with exponential backoff + circuit breaker ──
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          // ── Circuit breaker gate (checked before every attempt) ──
          if (!breaker.tryAcquire()) {
            // Breaker is open — fail fast, no fetch
            recordedError = true;
            return circuitOpenResponse();
          }

          try {
            const response = await fetch(url, fetchInit);

            // 2xx — success, reset breaker, return immediately
            if (response.ok) {
              breaker.recordSuccess();
              return response;
            }

            // Non-2xx outcome — will record error in finally block
            recordedError = true;

            // 4xx — client error, do NOT retry, do NOT trip circuit breaker
            if (response.status >= 400 && response.status < 500) {
              if (response.status === 401) {
                metrics.recordTokenExpiry(toolName);
              }
              return response;
            }

            // 5xx — server error, record failure, retry if attempts remain
            breaker.recordFailure();

            if (attempt < maxRetries) {
              const delay = calcBackoff(attempt);
              await sleepWithAbort(delay, combinedSignal);
              continue;
            }

            // Max retries exhausted — return the last response
            return response;
          } catch (err: unknown) {
            // AbortError — propagate immediately, do NOT retry
            if (err instanceof DOMException && err.name === "AbortError") {
              throw err;
            }

            // Network or other error — count as failure, retry if attempts remain
            recordedError = true;
            breaker.recordFailure();

            if (attempt < maxRetries) {
              const delay = calcBackoff(attempt);
              await sleepWithAbort(delay, combinedSignal);
              continue;
            }

            // Max retries exhausted — throw the error
            throw err;
          }
        }

        // Unreachable — all paths above either return or throw
        throw new Error("Unreachable: retry loop exhausted");
      } finally {
        const duration = Date.now() - start;
        metrics.recordCall(toolName, duration);
        if (recordedError) {
          metrics.recordError(toolName);
        }
        clearTimeout_();
      }
    },
  };
}
