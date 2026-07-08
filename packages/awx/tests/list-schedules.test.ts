/**
 * List Schedules Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-schedules tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listSchedules } from "../src/list-schedules.js";
import type { Schedule, ListSchedulesOutput } from "../src/list-schedules.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockSchedule(overrides?: Partial<Schedule>): Schedule {
  return {
    id: 1,
    name: "schedule-a",
    description: "Test schedule",
    unified_job_template: 1,
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<Schedule>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<Schedule> = {
    count: data.count ?? 0,
    next: data.next ?? null,
    previous: data.previous ?? null,
    results: data.results ?? [],
  };

  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: () => Promise.resolve(body),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as Response;
}

function createMockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

/* ══════════════════════════════════════════════════════════════════
   Tracer Bullet: basic listSchedules shape
   ══════════════════════════════════════════════════════════════════ */

describe("listSchedules", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no schedules exist", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 0,
          results: [],
          next: null,
        },
      }),
    );

    const result = await listSchedules(client);

    expect(result).toEqual<Partial<ListSchedulesOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-schedules",
      "/api/v2/schedules/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of schedules", async () => {
    const client = createMockClient();
    const sched1 = createMockSchedule({ id: 1, name: "schedule-a" });
    const sched2 = createMockSchedule({ id: 2, name: "schedule-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [sched1, sched2],
          next: null,
        },
      }),
    );

    const result = await listSchedules(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("schedule-a");
    expect(result.results[1].name).toBe("schedule-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Scheds = [
      createMockSchedule({ id: 1, name: "schedule-a" }),
      createMockSchedule({ id: 2, name: "schedule-b" }),
    ];
    const page2Scheds = [
      createMockSchedule({ id: 3, name: "schedule-c" }),
      createMockSchedule({ id: 4, name: "schedule-d" }),
    ];
    const page3Scheds = [
      createMockSchedule({ id: 5, name: "schedule-e" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Scheds,
          next: "/api/v2/schedules/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Scheds,
          next: "/api/v2/schedules/?page=3",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Scheds,
          next: null,
        },
      }),
    );

    const result = await listSchedules(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-schedules", "/api/v2/schedules/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-schedules", "/api/v2/schedules/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-schedules", "/api/v2/schedules/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Scheds = [createMockSchedule({ id: 1, name: "schedule-a" })];
    const page2Scheds: Schedule[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Scheds, next: "/api/v2/schedules/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Scheds, next: null },
        }),
      );

    const result = await listSchedules(client);

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Cap — limited by maxPages (default: 5)
     ══════════════════════════════════════════════════════════════════ */

  it("respects maxPages cap and returns warning when more pages exist", async () => {
    const client = createMockClient();
    for (let i = 0; i < 6; i++) {
      (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 60,
            results: [createMockSchedule({ id: i + 1, name: `schedule-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/schedules/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listSchedules(client, { maxPages: 3 });

    expect(client.request).toHaveBeenCalledTimes(3);
    expect(result.results).toHaveLength(3);
    expect(result.warning).toBe("More items exist. Increase max-pages or use a filter.");
  });

  it("does not include warning when all pages are fetched before cap", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockSchedule({ id: 1, name: "schedule-a" })],
            next: "/api/v2/schedules/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockSchedule({ id: 2, name: "schedule-b" })],
            next: null,
          },
        }),
      );

    const result = await listSchedules(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const scheds = [
      createMockSchedule({ id: 3, name: "z-schedule" }),
      createMockSchedule({ id: 1, name: "alpha-schedule" }),
      createMockSchedule({ id: 2, name: "beta-schedule" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: scheds,
          next: null,
        },
      }),
    );

    const result = await listSchedules(client);

    expect(result.results[0].name).toBe("alpha-schedule");
    expect(result.results[1].name).toBe("beta-schedule");
    expect(result.results[2].name).toBe("z-schedule");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockSchedule({ id: 3, name: "c-schedule" }),
            createMockSchedule({ id: 1, name: "a-schedule" }),
          ],
          next: "/api/v2/schedules/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockSchedule({ id: 4, name: "d-schedule" }),
            createMockSchedule({ id: 2, name: "b-schedule" }),
          ],
          next: null,
        },
      }),
    );

    const result = await listSchedules(client);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-schedule");
    expect(result.results[1].name).toBe("b-schedule");
    expect(result.results[2].name).toBe("c-schedule");
    expect(result.results[3].name).toBe("d-schedule");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const scheds = [createMockSchedule({ id: 1, name: "schedule-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: scheds, next: null },
      }),
    );

    await listSchedules(client, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-schedules",
      "/api/v2/schedules/?page=1&page_size=10",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Convenience Filter — unified_job_template_id
     ══════════════════════════════════════════════════════════════════ */

  it("passes unified_job_template_id as server-side filter", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listSchedules(client, { unified_job_template_id: 42 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-schedules",
      "/api/v2/schedules/?page=1&page_size=50&unified_job_template__id=42",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling
     ══════════════════════════════════════════════════════════════════ */

  it("throws when a page request fails with non-ok status", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 500 }),
    );

    await expect(listSchedules(client)).rejects.toThrow(
      "Failed to fetch schedules: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockSchedule()], next: null },
      }),
    );

    await expect(
      listSchedules(client, { abortSignal: controller.signal }),
    ).rejects.toThrow(DOMException);
  });

  /* ══════════════════════════════════════════════════════════════════
     Timeout Budget — per-page timeout enforcement
     ══════════════════════════════════════════════════════════════════ */

  it("throws timeout error when page request exceeds per-page budget", async () => {
    vi.useFakeTimers();

    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockImplementation(
      (_toolName: string, _path: string, _init: unknown, signal?: AbortSignal) => {
        return new Promise<Response>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      },
    );

    const listPromise = listSchedules(client, { timeout: 6_000, maxPages: 2 });
    listPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(2_001);

    await expect(listPromise).rejects.toThrow("timed out after");
    vi.useRealTimers();
  });

  /* ══════════════════════════════════════════════════════════════════
     Filter Parameter — server-side filtering via query params
     ══════════════════════════════════════════════════════════════════ */

  it("passes filter params in the request URL", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listSchedules(client, { filters: ["name__icontains=daily"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-schedules",
      "/api/v2/schedules/?page=1&page_size=50&name__icontains=daily",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("merges unified_job_template_id with user-supplied filters", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listSchedules(client, {
      unified_job_template_id: 42,
      filters: ["name__icontains=daily"],
    });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-schedules",
      "/api/v2/schedules/?page=1&page_size=50&name__icontains=daily&unified_job_template__id=42",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
