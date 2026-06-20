/**
 * metrics.ts — Per-tool counters with file-backed durability
 *
 * Provides structured metrics for operational visibility and phase-gating:
 *   - Per-tool call count
 *   - Per-tool error count
 *   - Per-tool latency accumulation (ms)
 *   - Token expiry events (401 detection)
 *   - PowerShell fallback count (for deprecation monitoring)
 *
 * ## Durability Model
 *
 * Counters are file-backed so they survive plugin reloads. This is required
 * for the Phase 2→3 gate which demands 14 consecutive days of zero PowerShell
 * AWX calls.
 *
 * **File format:** JSON at a configurable path (default: `.metrics/metrics.json`).
 * **Atomic writes:** Data is written to a `.tmp` file first, then renamed over
 *   the target — preventing corruption on partial writes.
 * **Merge-on-load:** When `load()` is called, disk values are merged with
 *   in-memory counters using `Math.max()` — counters never decrease.
 * **Missing file:** Treated as a fresh start (no error thrown).
 *
 * ## Integration Point
 *
 * Metrics hook into the client module at pipeline boundaries — not inside
 * individual middleware. The `client.ts` request function calls `recordCall`,
 * `recordError`, and `recordTokenExpiry` at the top level.
 *
 * ```typescript
 * // In client.ts (pipeline boundary):
 * const start = Date.now();
 * try {
 *   const response = await fetch(...);
 *   metrics.recordCall(toolName, Date.now() - start);
 *   if (response.status === 401) metrics.recordTokenExpiry(toolName);
 *   return response;
 * } catch (err) {
 *   metrics.recordError(toolName);
 *   throw err;
 * }
 * ```
 */

// ——— Type definitions ———

/** Per-tool metrics counters */
export interface ToolMetrics {
  /** Total number of tool calls (successful or not) */
  callCount: number;
  /** Total number of errors (any error, including HTTP and network errors) */
  errorCount: number;
  /** Accumulated latency in milliseconds (sum of all call latencies) */
  totalLatencyMs: number;
  /** Number of 401 Unauthorized responses (token expiry detection) */
  tokenExpiryEvents: number;
  /** Number of times the plugin fell back to PowerShell for this tool */
  psFallbackCount: number;
}

/** On-disk persistence format */
interface PersistedMetrics {
  version: 1;
  updatedAt: string;
  tools: Record<string, ToolMetrics>;
}

// ——— Factory ———

/** Create a zeroed ToolMetrics object */
export function createDefaultMetrics(): ToolMetrics {
  return {
    callCount: 0,
    errorCount: 0,
    totalLatencyMs: 0,
    tokenExpiryEvents: 0,
    psFallbackCount: 0,
  };
}

// ——— MetricsStore ———

/**
 * Thread-safe (in-memory) metrics store with file-backed durability.
 *
 * All recording methods are synchronous and fast — they mutate an in-memory
 * Map. Persistence is explicit (call `persist()`) so the caller controls when
 * to flush to disk.
 *
 * The durability model is **additive-merge**: on `load()`, existing in-memory
 * counters are never decreased. This prevents race conditions where an
 * in-memory increment during a concurrent persist window would be lost.
 */
export class MetricsStore {
  /** Per-tool counters, keyed by tool name */
  private counters: Map<string, ToolMetrics> = new Map();

  /** File path for persistence (default: `.metrics/metrics.json`) */
  private persistPath: string;

  /**
   * @param persistPath - Absolute or relative path to the metrics JSON file.
   *   Defaults to `.metrics/metrics.json` relative to the current working directory.
   */
  constructor(persistPath?: string) {
    this.persistPath = persistPath ?? ".metrics/metrics.json";
  }

  // ——— Private helpers ———

  /** Get or create the ToolMetrics entry for a tool name */
  private ensure(toolName: string): ToolMetrics {
    let metrics = this.counters.get(toolName);
    if (!metrics) {
      metrics = createDefaultMetrics();
      this.counters.set(toolName, metrics);
    }
    return metrics;
  }

  // ——— Recording methods ———

  /**
   * Record a tool call with its latency.
   * Called by the client at the pipeline boundary after a successful (or
   * error-handled) fetch completes.
   *
   * @param toolName - The registered tool name (e.g., "list-templates", "launch-job")
   * @param latencyMs - Round-trip latency in milliseconds
   */
  recordCall(toolName: string, latencyMs: number): void {
    const m = this.ensure(toolName);
    m.callCount++;
    m.totalLatencyMs += latencyMs;
  }

  /**
   * Record an error for a tool.
   * Called by the client when a fetch request fails (any error: 4xx, 5xx,
   * network error, timeout, abort).
   */
  recordError(toolName: string): void {
    const m = this.ensure(toolName);
    m.errorCount++;
  }

  /**
   * Record a token expiry event (HTTP 401).
   * Called by the client when a request returns 401 Unauthorized, indicating
   * the bearer token has expired or been revoked.
   */
  recordTokenExpiry(toolName: string): void {
    const m = this.ensure(toolName);
    m.tokenExpiryEvents++;
  }

  /**
   * Record a PowerShell fallback for a tool.
   * Called when the plugin tool cannot complete the operation and falls back
   * to the legacy PowerShell script. This counter is tracked per-tool for
   * granular deprecation monitoring (Phase 2→3 gate requires zero PS calls
   * across all tools for 14 consecutive days).
   */
  recordPsFallback(toolName: string): void {
    const m = this.ensure(toolName);
    m.psFallbackCount++;
  }

  // ——— Read methods ———

  /**
   * Get metrics for a specific tool.
   * Returns a default zeroed object if the tool has never been recorded.
   */
  getMetrics(toolName: string): ToolMetrics {
    const m = this.counters.get(toolName);
    if (!m) return createDefaultMetrics();
    // Return a shallow copy so callers can't mutate the store
    return { ...m };
  }

  /**
   * Get all tracked tools' metrics as a plain object.
   * Returns deep copies — mutations do not affect the store.
   */
  getAllMetrics(): Record<string, ToolMetrics> {
    const result: Record<string, ToolMetrics> = {};
    for (const [name, metrics] of this.counters) {
      result[name] = { ...metrics };
    }
    return result;
  }

  // ——— Persistence ———

  /**
   * Persist current metrics to disk using an atomic write strategy.
   *
   * **Atomicity**: Data is written to a `.tmp` file first, then renamed
   * over the target. If the process crashes during the write, the original
   * file remains intact.
   *
   * **Directory creation**: The parent directory is created recursively if
   * it doesn't exist.
   */
  async persist(): Promise<void> {
    // Dynamic imports keep the module dependency-free at the type level
    // and avoid bundling fs/promises for environments that don't need it.
    const fs = await import("fs/promises");
    const path = await import("path");

    const dir = path.dirname(this.persistPath);
    await fs.mkdir(dir, { recursive: true });

    const data: PersistedMetrics = {
      version: 1,
      updatedAt: new Date().toISOString(),
      tools: Object.fromEntries(this.counters),
    };

    const tmpPath = this.persistPath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmpPath, this.persistPath);
  }

  /**
   * Load metrics from disk and merge with in-memory counters.
   *
   * **Merge strategy (additive)**: For each tool, each counter is set to
   * `Math.max(inMemory, onDisk)`. This ensures:
   *   - Counters never decrease (no lost increments).
   *   - Concurrent increments during a load window are preserved.
   *
   * **Missing file**: Treated as a fresh start (no error). In-memory
   * counters are left unchanged — a subsequent `persist()` will create
   * the file.
   */
  async load(): Promise<void> {
    const fs = await import("fs/promises");

    let raw: string;
    try {
      raw = await fs.readFile(this.persistPath, "utf-8");
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as Record<string, unknown>).code === "ENOENT"
      ) {
        // File doesn't exist — fresh start, keep in-memory counters
        return;
      }
      throw err;
    }

    const data = JSON.parse(raw) as PersistedMetrics;

    if (data.tools) {
      for (const [name, saved] of Object.entries(data.tools)) {
        const existing = this.ensure(name);
        // Merge: take the maximum of each counter (never decrease)
        existing.callCount = Math.max(existing.callCount, saved.callCount ?? 0);
        existing.errorCount = Math.max(existing.errorCount, saved.errorCount ?? 0);
        existing.totalLatencyMs = Math.max(existing.totalLatencyMs, saved.totalLatencyMs ?? 0);
        existing.tokenExpiryEvents = Math.max(existing.tokenExpiryEvents, saved.tokenExpiryEvents ?? 0);
        existing.psFallbackCount = Math.max(existing.psFallbackCount, saved.psFallbackCount ?? 0);
      }
    }
  }

  // ——— Lifecycle ———

  /**
   * Reset all counters to zero.
   * Useful for testing or for clearing metrics between sessions.
   */
  reset(): void {
    this.counters.clear();
  }
}

// ——— Lifecycle helper ———

/**
 * Set up periodic persistence for a MetricsStore.
 *
 * Starts a `setInterval` that calls `store.persist()` at the given interval.
 * Returns a `clear()` function that stops the interval and does a final
 * persist to ensure in-memory counters are flushed to disk.
 *
 * This is the integration point for the plugin lifecycle:
 * 1. Plugin's `server()` creates a `MetricsStore` and calls `store.load()`.
 * 2. Plugin's `server()` calls this helper to start periodic persistence.
 * 3. Plugin's `dispose()` hook calls `clear()` to stop the interval and
 *    perform a final persist.
 *
 * @param store      - The MetricsStore to persist periodically
 * @param intervalMs - Interval in milliseconds (default: 30_000 = 30s)
 * @param onError    - Optional callback invoked when a persist attempt fails.
 *                     Receives the error object so the caller can surface
 *                     failures (e.g., via app logging) without crashing the
 *                     interval.
 */
export function setupMetricsPersistence(
  store: MetricsStore,
  intervalMs: number = 30_000,
  onError?: (err: unknown) => void,
): { clear: () => Promise<void> } {
  let persistQueue = Promise.resolve();

  function enqueuePersist(): Promise<void> {
    persistQueue = persistQueue
      .then(() => store.persist())
      .catch((err) => {
        // persist failures (e.g., permission denied) should not crash
        // the interval; surface the error via the optional callback.
        onError?.(err);
      });
    return persistQueue;
  }

  const intervalId = setInterval(() => {
    void enqueuePersist();
  }, intervalMs);

  return {
    async clear(): Promise<void> {
      clearInterval(intervalId);
      await enqueuePersist();
    },
  };
}
