/**
 * List Jobs Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * filtering, and error handling for the awx-list-jobs tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listJobs } from "../src/list-jobs.js";
import type { JobResult, ListJobsOutput } from "../src/list-jobs.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockJob(overrides?: Partial<JobResult>): JobResult {
  return {
    id: 1,
    name: "job-a",
    job_type: "run",
    status: "successful",
    created: "2024-06-01T12:00:00Z",
    started: "2024-06-01T12:00:05Z",
    finished: "2024-06-01T12:30:00Z",
    launched_by: "admin",
    job_template_id: 10,
    job_template_name: "job-a",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: {
    count?: number;
    next?: string | null;
    previous?: string | null;
    results?: unknown[];
  };
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body = {
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

/** Factory for raw AWX API job items (the shape returned by /api/v2/jobs/) */
function createRawJobItem(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    name: "job-a",
    type: "job",
    job_type: "run",
    status: "successful",
    created: "2024-06-01T12:00:00Z",
    started: "2024-06-01T12:00:05Z",
    finished: "2024-06-01T12:30:00Z",
    summary_fields: {
      unified_job_template: { id: 10, name: "job-a", description: "" },
      created_by: { id: 1, username: "admin" },
    },
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════════════
   listJobs
   ══════════════════════════════════════════════════════════════════ */

describe("listJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /* ── Empty Results ────────────────────────────────────────────── */

  it("returns empty results when no jobs exist", async () => {
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

    const result = await listJobs(client, 30_000);

    expect(result).toEqual<Partial<ListJobsOutput>>({
      schema_version: "1.0",
      total_jobs: 0,
      results: [],
      pages_fetched: 1,
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-jobs",
      "/api/v2/jobs/?page_size=50&order_by=-created",
      undefined,
      expect.any(AbortSignal),
    );
  });

  /* ── Single Page ──────────────────────────────────────────────── */

  it("returns a single page of jobs", async () => {
    const client = createMockClient();
    const job1 = createRawJobItem({ id: 1, name: "job-a", summary_fields: { unified_job_template: { id: 10, name: "job-a" }, created_by: { id: 1, username: "admin" } } });
    const job2 = createRawJobItem({ id: 2, name: "job-b", summary_fields: { unified_job_template: { id: 11, name: "job-b" }, created_by: { id: 2, username: "operator" } } });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [job1, job2],
          next: null,
        },
      }),
    );

    const result = await listJobs(client, 30_000);

    expect(result.total_jobs).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("job-a");
    expect(result.results[1].name).toBe("job-b");
    expect(result.warning).toBeUndefined();
    expect(result.schema_version).toBe("1.0");
    expect(result.pages_fetched).toBe(1);
  });

  /* ── Pagination Loop — multiple pages with next-link ──────────── */

  it("fetches multiple pages via next-link and consolidates results", async () => {
    const client = createMockClient();
    const page1Jobs = [
      createRawJobItem({ id: 1, name: "job-a" }),
      createRawJobItem({ id: 2, name: "job-b" }),
    ];
    const page2Jobs = [
      createRawJobItem({ id: 3, name: "job-c" }),
      createRawJobItem({ id: 4, name: "job-d" }),
    ];
    const page3Jobs = [
      createRawJobItem({ id: 5, name: "job-e" }),
    ];

    // Page 1 has next → page 2
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Jobs,
          next: "/api/v2/jobs/?page=2&page_size=50&order_by=-created",
        },
      }),
    );
    // Page 2 has next → page 3
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Jobs,
          next: "/api/v2/jobs/?page=3&page_size=50&order_by=-created",
        },
      }),
    );
    // Page 3 has no next
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Jobs,
          next: null,
        },
      }),
    );

    const result = await listJobs(client, 30_000);

    expect(result.total_jobs).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(result.pages_fetched).toBe(3);
    expect(result.warning).toBeUndefined();
  });

  it("follows absolute next-link URLs (AWX format)", async () => {
    const client = createMockClient();
    const page1Jobs = [createRawJobItem({ id: 1, name: "job-a" })];
    const page2Jobs = [createRawJobItem({ id: 2, name: "job-b" })];

    // AWX returns absolute URLs in next
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: page1Jobs,
            next: "https://example.com/api/v2/jobs/?page=2&page_size=50&order_by=-created",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: page2Jobs,
            next: null,
          },
        }),
      );

    const result = await listJobs(client, 30_000);

    expect(result.total_jobs).toBe(2);
    expect(client.request).toHaveBeenCalledTimes(2);
    // The second request should use the extracted path, not the full URL
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "awx-list-jobs",
      "/api/v2/jobs/?page=2&page_size=50&order_by=-created",
      undefined,
      expect.any(AbortSignal),
    );
  });

  /* ── Sort by created descending ───────────────────────────────── */

  it("sorts results by created descending (newest first)", async () => {
    const client = createMockClient();
    // Use raw items WITHOUT summary_fields so the name falls back to top-level
    const jobs = [
      { id: 3, name: "old-job", job_type: "run", status: "successful", created: "2024-01-01T00:00:00Z" },
      { id: 1, name: "new-job", job_type: "run", status: "successful", created: "2024-06-01T00:00:00Z" },
      { id: 2, name: "mid-job", job_type: "run", status: "successful", created: "2024-03-15T00:00:00Z" },
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: jobs,
          next: null,
        },
      }),
    );

    const result = await listJobs(client, 30_000);

    expect(result.results[0].name).toBe("new-job");
    expect(result.results[1].name).toBe("mid-job");
    expect(result.results[2].name).toBe("old-job");
  });

  it("sorts across paginated results by created descending", async () => {
    const client = createMockClient();
    // Page 1: newer jobs — use raw objects WITHOUT summary_fields so names come from top-level
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            { id: 3, name: "job-c", job_type: "run", status: "successful", created: "2024-05-01T00:00:00Z" },
            { id: 1, name: "job-a", job_type: "run", status: "successful", created: "2024-06-01T00:00:00Z" },
          ],
          next: "/api/v2/jobs/?page=2&page_size=50&order_by=-created",
        },
      }),
    );
    // Page 2: older jobs
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            { id: 4, name: "job-d", job_type: "run", status: "successful", created: "2024-02-01T00:00:00Z" },
            { id: 2, name: "job-b", job_type: "run", status: "successful", created: "2024-04-01T00:00:00Z" },
          ],
          next: null,
        },
      }),
    );

    const result = await listJobs(client, 30_000);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("job-a"); // newest: 2024-06-01
    expect(result.results[1].name).toBe("job-c"); // 2024-05-01
    expect(result.results[2].name).toBe("job-b"); // 2024-04-01
    expect(result.results[3].name).toBe("job-d"); // oldest: 2024-02-01
  });

  /* ── Page Cap ─────────────────────────────────────────────────── */

  it("respects maxPages cap and returns warning when more pages exist", async () => {
    const client = createMockClient();
    // Mock 6 pages of results but cap at 3
    for (let i = 0; i < 6; i++) {
      (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 60,
            results: [createRawJobItem({ id: i + 1, name: `job-${i + 1}` })],
            next: i < 5 ? `/api/v2/jobs/?page=${i + 2}&page_size=50&order_by=-created` : null,
          },
        }),
      );
    }

    const result = await listJobs(client, 30_000, { maxPages: 3 });

    // Should only fetch 3 pages
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(result.results).toHaveLength(3);
    expect(result.pages_fetched).toBe(3);
    // Warning should be present
    expect(result.warning).toBe("Page cap of 3 pages reached. Some results may be omitted.");
  });

  it("does not include warning when all pages are fetched before cap", async () => {
    const client = createMockClient();
    // Only 2 pages exist, maxPages is 5
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createRawJobItem({ id: 1, name: "job-a" })],
            next: "/api/v2/jobs/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createRawJobItem({ id: 2, name: "job-b" })],
            next: null,
          },
        }),
      );

    const result = await listJobs(client, 30_000, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ── All pages (maxPages=0) ───────────────────────────────────── */

  it("fetches all pages when maxPages is 0 (no cap)", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 3,
            results: [createRawJobItem({ id: 1, name: "job-a" })],
            next: "/api/v2/jobs/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 3,
            results: [createRawJobItem({ id: 2, name: "job-b" })],
            next: "/api/v2/jobs/?page=3",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 3,
            results: [createRawJobItem({ id: 3, name: "job-c" })],
            next: null,
          },
        }),
      );

    const result = await listJobs(client, 30_000, { maxPages: 0 });

    expect(result.total_jobs).toBe(3);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(result.warning).toBeUndefined();
  });

  /* ── Page Size ────────────────────────────────────────────────── */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const jobs = [createRawJobItem({ id: 1, name: "job-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: jobs, next: null },
      }),
    );

    await listJobs(client, 30_000, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-jobs",
      "/api/v2/jobs/?page_size=10&order_by=-created",
      undefined,
      expect.any(AbortSignal),
    );
  });

  /* ── Error Handling ───────────────────────────────────────────── */

  it("throws when a page request fails with non-ok status", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 500 }),
    );

    await expect(listJobs(client, 30_000)).rejects.toThrow(
      "AWX API error: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();

    // Abort before any request
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createRawJobItem()], next: null },
      }),
    );

    // The anyAbortSignal in the pagination loop should catch the pre-aborted signal
    await expect(
      listJobs(client, 30_000, {}, controller.signal),
    ).rejects.toThrow(DOMException);
  });

  /* ── Timeout Budget ───────────────────────────────────────────── */

  it("uses custom timeout for per-page budget calculation", async () => {
    const client = createMockClient();
    const jobs = [createRawJobItem({ id: 1, name: "job-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: jobs, next: null },
      }),
    );

    // Use real timers for this test to avoid fake timer interaction
    vi.useRealTimers();

    const result = await listJobs(client, 10_000, { maxPages: 4 });

    expect(result.total_jobs).toBe(1);
  });

  it("throws timeout error when page request exceeds per-page budget", async () => {
    vi.useFakeTimers();

    const client = createMockClient();
    // Mock a request that respects the abort signal (never resolves, rejects on abort)
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

    // With timeout=6000 and maxPages=2, budget = 6000/(2+1) = 2000ms per page
    const listPromise = listJobs(client, 6_000, { maxPages: 2 });

    // Attach a no-op rejection handler BEFORE advancing time to prevent
    // unhandled-rejection warnings when the abort fires during fake timer advancement
    listPromise.catch(() => {});

    // The first page request will hang — advance past the per-page budget
    await vi.advanceTimersByTimeAsync(2_001);

    // The request should reject with a timeout error
    await expect(listPromise).rejects.toThrow("Page timeout.");

    vi.useRealTimers();
  });

  /* ── Filter Parameter ─────────────────────────────────────────── */

  it("passes filter params in the request URL", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listJobs(client, 30_000, { filters: ["name__icontains=workspace"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-jobs",
      "/api/v2/jobs/?page_size=50&order_by=-created&name__icontains=workspace",
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("supports multiple filter params", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listJobs(client, 30_000, {
      filters: ["name__icontains=test", "status=successful"],
    });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-jobs",
      "/api/v2/jobs/?page_size=50&order_by=-created&name__icontains=test&status=successful",
      undefined,
      expect.any(AbortSignal),
    );
  });

  /* ── Job field extraction ─────────────────────────────────────── */

  it("extracts fields from raw AWX API job items", async () => {
    const client = createMockClient();
    const rawJob = {
      id: 42,
      type: "job",
      job_type: "check",
      name: "my-job-name",
      status: "failed",
      created: "2024-06-15T10:30:00Z",
      started: "2024-06-15T10:30:05Z",
      finished: "2024-06-15T11:00:00Z",
      summary_fields: {
        unified_job_template: { id: 7, name: "my-template", description: "" },
        created_by: { id: 3, username: "developer" },
      },
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 1,
          results: [rawJob],
          next: null,
        },
      }),
    );

    const result = await listJobs(client, 30_000);

    expect(result.results).toHaveLength(1);
    const job = result.results[0];
    expect(job.id).toBe(42);
    expect(job.name).toBe("my-template"); // from unified_job_template.name
    expect(job.job_type).toBe("check");
    expect(job.status).toBe("failed");
    expect(job.created).toBe("2024-06-15T10:30:00Z");
    expect(job.started).toBe("2024-06-15T10:30:05Z");
    expect(job.finished).toBe("2024-06-15T11:00:00Z");
    expect(job.launched_by).toBe("developer");
    expect(job.job_template_id).toBe(7);
    expect(job.job_template_name).toBe("my-template");
  });

  it("handles jobs without summary_fields gracefully", async () => {
    const client = createMockClient();
    const rawJob = {
      id: 99,
      name: "standalone-job",
      job_type: "run",
      status: "successful",
      created: "2024-06-01T00:00:00Z",
      // no summary_fields, no started/finished
    };

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 1,
          results: [rawJob],
          next: null,
        },
      }),
    );

    const result = await listJobs(client, 30_000);

    expect(result.results).toHaveLength(1);
    const job = result.results[0];
    expect(job.id).toBe(99);
    expect(job.name).toBe("standalone-job"); // falls back to top-level name
    expect(job.launched_by).toBeNull();
    expect(job.job_template_id).toBeNull();
    expect(job.job_template_name).toBeNull();
    expect(job.started).toBeNull();
    expect(job.finished).toBeNull();
  });
});
