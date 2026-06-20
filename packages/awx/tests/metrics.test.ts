/**
 * metrics.test.ts — Unit tests for the MetricsStore module
 *
 * Tests verify behavior through the public MetricsStore interface:
 * - Counter increment behavior (call count, error count, latency, token expiry, PS fallback)
 * - File-backed persistence across simulated plugin reloads
 * - Independent per-tool counters
 *
 * These tests follow the TDD philosophy: they test WHAT the system does,
 * not HOW it does it. The implementation can change entirely without
 * breaking these tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MetricsStore,
  createDefaultMetrics,
  setupMetricsPersistence,
} from "../src/metrics";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// ——— Test helpers ———

/** Create a unique temp directory for persistence tests */
async function tempPersistDir(): Promise<string> {
  const dir = path.join(os.tmpdir(), `metrics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** Get a file path within a temp dir for persistence */
function persistPath(dir: string): string {
  return path.join(dir, "metrics.json");
}

// ——— Test suite ———

describe("MetricsStore", () => {
  // ——— Counter increment behavior ———

  describe("counter increment behavior", () => {
    let store: MetricsStore;

    beforeEach(() => {
      store = new MetricsStore();
    });

    it("recordCall increments call count and accumulates latency for a tool", () => {
      store.recordCall("list-templates", 150);
      store.recordCall("list-templates", 200);

      const metrics = store.getMetrics("list-templates");
      expect(metrics.callCount).toBe(2);
      expect(metrics.totalLatencyMs).toBe(350);
    });

    it("recordCall initializes a tool with zero counters before first call", () => {
      // getMetrics on an unrecorded tool returns default (all zero)
      const metrics = store.getMetrics("unknown-tool");
      expect(metrics.callCount).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.totalLatencyMs).toBe(0);
      expect(metrics.tokenExpiryEvents).toBe(0);
      expect(metrics.psFallbackCount).toBe(0);
    });

    it("recordError increments error count independently of call count", () => {
      store.recordCall("launch-job", 100);
      store.recordError("launch-job");
      store.recordError("launch-job");

      const metrics = store.getMetrics("launch-job");
      expect(metrics.callCount).toBe(1);
      expect(metrics.errorCount).toBe(2);
    });

    it("recordTokenExpiry increments token expiry events per tool", () => {
      store.recordTokenExpiry("sync-project");
      store.recordTokenExpiry("sync-project");
      store.recordTokenExpiry("launch-job");

      expect(store.getMetrics("sync-project").tokenExpiryEvents).toBe(2);
      expect(store.getMetrics("launch-job").tokenExpiryEvents).toBe(1);
    });

    it("recordPsFallback increments PS fallback count per tool", () => {
      store.recordPsFallback("list-templates");
      store.recordPsFallback("list-templates");
      store.recordPsFallback("get-job-events");

      expect(store.getMetrics("list-templates").psFallbackCount).toBe(2);
      expect(store.getMetrics("get-job-events").psFallbackCount).toBe(1);
    });

    it("different tools have independent counters", () => {
      store.recordCall("list-templates", 50);
      store.recordError("launch-job");
      store.recordPsFallback("sync-project");

      const tmpl = store.getMetrics("list-templates");
      const job = store.getMetrics("launch-job");
      const sync = store.getMetrics("sync-project");

      // list-templates: 1 call, 0 errors
      expect(tmpl.callCount).toBe(1);
      expect(tmpl.errorCount).toBe(0);

      // launch-job: 0 calls, 1 error
      expect(job.callCount).toBe(0);
      expect(job.errorCount).toBe(1);

      // sync-project: 0 calls, 0 errors, 1 PS fallback
      expect(sync.callCount).toBe(0);
      expect(sync.psFallbackCount).toBe(1);
    });

    it("getAllMetrics returns all tracked tools as a plain object", () => {
      store.recordCall("tool-a", 10);
      store.recordCall("tool-b", 20);

      const all = store.getAllMetrics();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all["tool-a"].callCount).toBe(1);
      expect(all["tool-b"].callCount).toBe(1);
    });

    it("getAllMetrics returns deep copies — mutations do not affect store", () => {
      store.recordCall("tool-a", 10);
      const all = store.getAllMetrics();
      all["tool-a"].callCount = 999;

      // Original store unchanged
      expect(store.getMetrics("tool-a").callCount).toBe(1);
    });

    it("createDefaultMetrics returns a zeroed ToolMetrics object", () => {
      const defaults = createDefaultMetrics();
      expect(defaults).toEqual({
        callCount: 0,
        errorCount: 0,
        totalLatencyMs: 0,
        tokenExpiryEvents: 0,
        psFallbackCount: 0,
      });
    });
  });

  // ——— File-backed persistence ———

  describe("file-backed persistence (durability model)", () => {
    let tempDir: string;
    let filePath: string;

    beforeEach(async () => {
      tempDir = await tempPersistDir();
      filePath = persistPath(tempDir);
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("persist writes counters to disk and load reads them back intact", async () => {
      // Arrange: create store, record metrics, persist
      const store1 = new MetricsStore(filePath);
      store1.recordCall("list-templates", 120);
      store1.recordError("launch-job");
      store1.recordPsFallback("sync-project");
      store1.recordTokenExpiry("list-templates");
      await store1.persist();

      // Act: simulate plugin reload — new store instance loads from same file
      const store2 = new MetricsStore(filePath);
      await store2.load();

      // Assert: all counters survived the reload
      expect(store2.getMetrics("list-templates").callCount).toBe(1);
      expect(store2.getMetrics("list-templates").totalLatencyMs).toBe(120);
      expect(store2.getMetrics("list-templates").tokenExpiryEvents).toBe(1);
      expect(store2.getMetrics("launch-job").errorCount).toBe(1);
      expect(store2.getMetrics("sync-project").psFallbackCount).toBe(1);
    });

    it("load merges with in-memory counters — never decreases values", async () => {
      // Arrange: store1 persists 5 calls
      const store1 = new MetricsStore(filePath);
      store1.recordCall("tool-a", 50);
      store1.recordCall("tool-a", 50);
      await store1.persist();

      // Simulate: store2 starts with some in-memory counts, then loads from disk
      const store2 = new MetricsStore(filePath);
      store2.recordCall("tool-a", 50); // 1 call in memory
      store2.recordCall("tool-b", 100); // new tool only in memory
      await store2.load(); // should merge: 2 from disk, 1 from memory → 2 (max)

      // The disk had 2 calls, memory had 1 call for tool-a → 2 (max wins)
      expect(store2.getMetrics("tool-a").callCount).toBe(2);
      // tool-b only existed in memory → survives the merge
      expect(store2.getMetrics("tool-b").callCount).toBe(1);
    });

    it("load on a non-existent file does not throw and leaves counters at defaults", async () => {
      const store = new MetricsStore("/nonexistent/path/metrics.json");
      store.recordCall("tool-a", 10);

      // Should not throw — file doesn't exist, start fresh
      await expect(store.load()).resolves.toBeUndefined();
      expect(store.getMetrics("tool-a").callCount).toBe(1); // in-memory count preserved
    });

    it("persist and load survive multiple reload cycles (14-day simulation)", async () => {
      // Simulate 14 days of plugin reloads — each day: record 1 call, persist, reload
      for (let day = 1; day <= 14; day++) {
        const store = new MetricsStore(filePath);
        await store.load();
        store.recordCall("daily-tool", 100);
        store.recordPsFallback("daily-tool");
        await store.persist();
      }

      // After 14 days, counters should reflect all accumulated values
      const finalStore = new MetricsStore(filePath);
      await finalStore.load();
      expect(finalStore.getMetrics("daily-tool").callCount).toBe(14);
      expect(finalStore.getMetrics("daily-tool").psFallbackCount).toBe(14);
      expect(finalStore.getMetrics("daily-tool").totalLatencyMs).toBe(1400);
    });

    it("atomic write: .tmp file is cleaned up after successful persist", async () => {
      // Write valid data first
      const store1 = new MetricsStore(filePath);
      store1.recordCall("tool-a", 10);
      await store1.persist();

      // Verify the .tmp file does NOT exist after a successful persist
      const tmpPath = filePath + ".tmp";
      await expect(fs.access(tmpPath)).rejects.toThrow();

      // Read back to confirm data is intact
      const store2 = new MetricsStore(filePath);
      await store2.load();
      expect(store2.getMetrics("tool-a").callCount).toBe(1);
    });

    it("accumulation across reloads: counters grow across persist→load→persist cycles", async () => {
      // Day 1: record and persist
      const store1 = new MetricsStore(filePath);
      store1.recordCall("tool-a", 10);
      await store1.persist();

      // Day 2: load from disk, record more, persist
      const store2 = new MetricsStore(filePath);
      await store2.load(); // loads day 1 data
      store2.recordCall("tool-a", 20);
      store2.recordCall("tool-b", 30);
      await store2.persist();

      // Day 3: load accumulated data
      const store3 = new MetricsStore(filePath);
      await store3.load();
      expect(store3.getMetrics("tool-a").callCount).toBe(2); // 1 from day1 + 1 from day2
      expect(store3.getMetrics("tool-b").callCount).toBe(1);
    });

    it("persist writes valid JSON with expected schema", async () => {
      const store = new MetricsStore(filePath);
      store.recordCall("tool-x", 42);
      store.recordPsFallback("tool-x");
      await store.persist();

      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);

      expect(parsed).toHaveProperty("version");
      expect(parsed).toHaveProperty("updatedAt");
      expect(parsed).toHaveProperty("tools");
      expect(parsed.tools).toHaveProperty("tool-x");
      expect(parsed.tools["tool-x"].callCount).toBe(1);
      expect(parsed.tools["tool-x"].totalLatencyMs).toBe(42);
      expect(parsed.tools["tool-x"].psFallbackCount).toBe(1);
    });
  });

  // ——— Edge cases ———

  describe("edge cases", () => {
    it("reset clears all counters and global state", () => {
      const store = new MetricsStore();
      store.recordCall("tool-a", 10);
      store.recordError("tool-a");
      store.recordPsFallback("tool-b");
      store.recordTokenExpiry("tool-a");

      store.reset();

      expect(store.getMetrics("tool-a")).toEqual(createDefaultMetrics());
      expect(store.getMetrics("tool-b")).toEqual(createDefaultMetrics());
      expect(store.getAllMetrics()).toEqual({});
    });

    it("recordCall with zero latency is valid (sub-millisecond calls)", () => {
      const store = new MetricsStore();
      store.recordCall("fast-tool", 0);
      expect(store.getMetrics("fast-tool").callCount).toBe(1);
      expect(store.getMetrics("fast-tool").totalLatencyMs).toBe(0);
    });

    it("metrics survive getting metrics before any calls (no crash)", () => {
      const store = new MetricsStore();
      const metrics = store.getMetrics("nonexistent");
      expect(metrics).toBeDefined();
      expect(metrics.callCount).toBe(0);
    });
  });

  // ——— Lifecycle integration (periodic persist) ———

  describe("lifecycle integration", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * This test validates that `setupMetricsPersistence` wires `persist()` to
     * a periodic timer — fulfilling the requirement that plugin-level metrics
     * are flushed to disk on a recurring interval.
     *
     * Note: `setupMetricsPersistence` is a helper that the plugin's `server()`
     * function calls during initialization, along with `store.load()`.
     */
    it("setupMetricsPersistence calls persist() periodically at the given interval", async () => {
      vi.useFakeTimers();

      const store = new MetricsStore();
      const persistSpy = vi.spyOn(store, "persist");
      persistSpy.mockResolvedValue(undefined);

      const { clear } = setupMetricsPersistence(store, 1000);

      // No persist should have been called before the interval fires
      expect(persistSpy).not.toHaveBeenCalled();

      // Advance past first interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(persistSpy).toHaveBeenCalledTimes(1);

      // Advance past second interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(persistSpy).toHaveBeenCalledTimes(2);

      // Clean up
      await clear();
      vi.useRealTimers();
    });

    it("clear() stops periodic persist and does a final persist", async () => {
      vi.useFakeTimers();

      const store = new MetricsStore();
      const persistSpy = vi.spyOn(store, "persist");
      persistSpy.mockResolvedValue(undefined);

      const { clear } = setupMetricsPersistence(store, 1000);

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(1000);
      expect(persistSpy).toHaveBeenCalledTimes(1);

      // Clear should do a final persist and stop the interval
      await clear();
      // 1 from interval + 1 from final persist
      expect(persistSpy).toHaveBeenCalledTimes(2);

      // Advance more time — no more persists should happen
      persistSpy.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      expect(persistSpy).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("persistence serialization: concurrent interval persist and clear() do not lose metrics", async () => {
      vi.useFakeTimers();

      const dir = await tempPersistDir();
      const filePath = persistPath(dir);
      const store = new MetricsStore(filePath);

      // Record initial metrics
      store.recordCall("tool-a", 100);
      store.recordCall("tool-b", 50);

      // Set up persistence at 1s interval. When the interval fires,
      // it enqueues a persist call via persistQueue.
      const { clear } = setupMetricsPersistence(store, 1000);

      // Step 1: simulate an interval persist firing by advancing time
      await vi.advanceTimersByTimeAsync(1000);

      // The interval's persist has been queued through persistQueue but
      // hasn't completed yet (it's an async operation that awaits dynamic
      // imports and file I/O). While it's in flight, record additional
      // metrics.
      store.recordCall("tool-a", 50); // tool-a now: 2 calls / 150ms

      // Step 2: concurrently call clear() — this stops the interval and
      // enqueues a final persist behind the in-flight one.
      const clearPromise = clear();

      // Both persists are serialized through persistQueue. The interval's
      // persist runs first (reading whatever state is current when it
      // executes), then clear()'s persist runs next (reading the final
      // state with all metrics).
      await clearPromise;

      // Load from disk — all metrics must be present. If the queue
      // serialization were broken, the persists could interleave and
      // data could be lost.
      const reader = new MetricsStore(filePath);
      await reader.load();
      expect(reader.getMetrics("tool-a").callCount).toBe(2);
      expect(reader.getMetrics("tool-a").totalLatencyMs).toBe(150);
      expect(reader.getMetrics("tool-b").callCount).toBe(1);
      expect(reader.getMetrics("tool-b").totalLatencyMs).toBe(50);

      await fs.rm(dir, { recursive: true, force: true });
      vi.useRealTimers();
    });

    it("onError callback fires when persist fails", async () => {
      vi.useFakeTimers();

      const store = new MetricsStore();
      const persistSpy = vi.spyOn(store, "persist");
      persistSpy.mockRejectedValue(new Error("disk full"));

      const onError = vi.fn();
      const { clear } = setupMetricsPersistence(store, 1000, onError);

      // Advance past first interval — the .catch() should fire onError
      await vi.advanceTimersByTimeAsync(1000);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));

      await clear();
      vi.useRealTimers();
    });

    it("load() restores persisted counters on initialization (lifecycle pattern)", async () => {
      const dir = await tempPersistDir();
      const filePath = persistPath(dir);

      // First session: record and persist
      const store1 = new MetricsStore(filePath);
      store1.recordCall("tool-a", 100);
      store1.recordPsFallback("tool-b");
      await store1.persist();

      // Simulate plugin reload: new store pointing to same file
      const store2 = new MetricsStore(filePath);
      await store2.load(); // This is called during plugin initialization

      // Verify counters restored
      expect(store2.getMetrics("tool-a").callCount).toBe(1);
      expect(store2.getMetrics("tool-a").totalLatencyMs).toBe(100);
      expect(store2.getMetrics("tool-b").psFallbackCount).toBe(1);

      await fs.rm(dir, { recursive: true, force: true });
    });
  });
});
