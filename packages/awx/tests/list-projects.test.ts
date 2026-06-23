/**
 * List Projects Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-projects tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listProjects, calcPageBudget } from "../src/list-projects.js";
import type { Project, PaginatedResponse, ListProjectsOutput } from "../src/list-projects.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockProject(overrides?: Partial<Project>): Project {
  return {
    id: 1,
    name: "project-a",
    type: "project",
    url: "/api/v2/projects/1/",
    summary_fields: {},
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    description: "Test project",
    scm_type: "git",
    status: "successful",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<PaginatedResponse>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: PaginatedResponse = {
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
   Tracer Bullet: calcPageBudget exports + basic listProjects shape
   ══════════════════════════════════════════════════════════════════ */

describe("calcPageBudget", () => {
  it("divides total timeout by (maxPages + 1)", () => {
    expect(calcPageBudget(30_000, 5)).toBe(5_000);  // 30000 / 6
    expect(calcPageBudget(30_000, 9)).toBe(3_000);  // 30000 / 10
    expect(calcPageBudget(12_000, 2)).toBe(4_000);  // 12000 / 3
  });

  it("rounds down to nearest integer", () => {
    expect(calcPageBudget(10_000, 3)).toBe(2_500);  // 10000 / 4
  });

  it("handles single-page case", () => {
    expect(calcPageBudget(10_000, 0)).toBe(10_000);  // 10000 / 1
  });
});

describe("listProjects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no projects exist", async () => {
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

    const result = await listProjects(client);

    expect(result).toEqual<Partial<ListProjectsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-projects",
      "/api/v2/projects/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of projects", async () => {
    const client = createMockClient();
    const project1 = createMockProject({ id: 1, name: "project-a" });
    const project2 = createMockProject({ id: 2, name: "project-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [project1, project2],
          next: null,
        },
      }),
    );

    const result = await listProjects(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("project-a");
    expect(result.results[1].name).toBe("project-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Projects = [
      createMockProject({ id: 1, name: "project-a" }),
      createMockProject({ id: 2, name: "project-b" }),
    ];
    const page2Projects = [
      createMockProject({ id: 3, name: "project-c" }),
      createMockProject({ id: 4, name: "project-d" }),
    ];
    const page3Projects = [
      createMockProject({ id: 5, name: "project-e" }),
    ];

    // Page 1 has next → page 2
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Projects,
          next: "/api/v2/projects/?page=2",
        },
      }),
    );
    // Page 2 has next → page 3
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Projects,
          next: "/api/v2/projects/?page=3",
        },
      }),
    );
    // Page 3 has no next
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Projects,
          next: null,
        },
      }),
    );

    const result = await listProjects(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    // Verify page increment
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-projects", "/api/v2/projects/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-projects", "/api/v2/projects/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-projects", "/api/v2/projects/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Projects = [createMockProject({ id: 1, name: "project-a" })];
    const page2Projects: Project[] = []; // empty last page

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Projects, next: "/api/v2/projects/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Projects, next: null },
        }),
      );

    const result = await listProjects(client);

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Cap — limited by maxPages (default: 5)
     ══════════════════════════════════════════════════════════════════ */

  it("respects maxPages cap and returns warning when more pages exist", async () => {
    const client = createMockClient();
    // Mock 6 pages of results but cap at 2
    for (let i = 0; i < 6; i++) {
      (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 60,
            results: [createMockProject({ id: i + 1, name: `project-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/projects/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listProjects(client, { maxPages: 3 });

    // Should only fetch 3 pages (page 1, 2, 3)
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(result.results).toHaveLength(3);
    // Warning should be present
    expect(result.warning).toBe("More items exist. Increase max-pages or use a filter.");
  });

  it("does not include warning when all pages are fetched before cap", async () => {
    const client = createMockClient();
    // Only 2 pages exist, maxPages is 5
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockProject({ id: 1, name: "project-a" })],
            next: "/api/v2/projects/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockProject({ id: 2, name: "project-b" })],
            next: null,
          },
        }),
      );

    const result = await listProjects(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const projects = [
      createMockProject({ id: 3, name: "z-project" }),
      createMockProject({ id: 1, name: "alpha-project" }),
      createMockProject({ id: 2, name: "beta-project" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: projects,
          next: null,
        },
      }),
    );

    const result = await listProjects(client);

    expect(result.results[0].name).toBe("alpha-project");
    expect(result.results[1].name).toBe("beta-project");
    expect(result.results[2].name).toBe("z-project");
  });

  it("sorts with case-insensitive comparison", async () => {
    const client = createMockClient();
    const projects = [
      createMockProject({ id: 3, name: "Z-project" }),
      createMockProject({ id: 1, name: "alpha-project" }),
      createMockProject({ id: 2, name: "BETA-project" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: projects,
          next: null,
        },
      }),
    );

    const result = await listProjects(client);

    expect(result.results[0].name).toBe("alpha-project");
    expect(result.results[1].name).toBe("BETA-project");
    expect(result.results[2].name).toBe("Z-project");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    // Page 1: projects c, a (unsorted)
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockProject({ id: 3, name: "c-project" }),
            createMockProject({ id: 1, name: "a-project" }),
          ],
          next: "/api/v2/projects/?page=2",
        },
      }),
    );
    // Page 2: projects d, b (unsorted)
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockProject({ id: 4, name: "d-project" }),
            createMockProject({ id: 2, name: "b-project" }),
          ],
          next: null,
        },
      }),
    );

    const result = await listProjects(client);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-project");
    expect(result.results[1].name).toBe("b-project");
    expect(result.results[2].name).toBe("c-project");
    expect(result.results[3].name).toBe("d-project");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const projects = [createMockProject({ id: 1, name: "project-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: projects, next: null },
      }),
    );

    await listProjects(client, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-projects",
      "/api/v2/projects/?page=1&page_size=10",
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

    await expect(listProjects(client)).rejects.toThrow(
      "Failed to fetch projects: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();

    // Abort before any request
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockProject()], next: null },
      }),
    );

    await expect(
      listProjects(client, { abortSignal: controller.signal }),
    ).rejects.toThrow(DOMException);
  });

  /* ══════════════════════════════════════════════════════════════════
     Timeout Budget — per-page timeout enforcement
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom timeout for per-page budget calculation", async () => {
    const client = createMockClient();
    // With timeout 10s and maxPages 4, budget = 10000 / 5 = 2000ms
    const projects = [createMockProject({ id: 1, name: "project-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: projects, next: null },
      }),
    );

    // Use useRealTimers for this test to avoid fake timer interaction
    vi.useRealTimers();

    const result = await listProjects(client, { timeout: 10_000, maxPages: 4 });

    expect(result.count).toBe(1);
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
    const listPromise = listProjects(client, { timeout: 6_000, maxPages: 2 });

    // Attach a no-op rejection handler BEFORE advancing time to prevent
    // unhandled-rejection warnings when the abort fires during fake timer advancement
    listPromise.catch(() => {});

    // The first page request will hang — advance past the per-page budget
    await vi.advanceTimersByTimeAsync(2_001);

    // The request should reject with a timeout error
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

    await listProjects(client, { filters: ["name__icontains=workspace"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-projects",
      "/api/v2/projects/?page=1&page_size=50&name__icontains=workspace",
      expect.any(Object),
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

    await listProjects(client, {
      filters: ["name__icontains=test", "description__icontains=foo"],
    });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-projects",
      "/api/v2/projects/?page=1&page_size=50&name__icontains=test&description__icontains=foo",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("works without filters (backward compatibility)", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockProject()], next: null },
      }),
    );

    const result = await listProjects(client);

    expect(result.count).toBe(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-projects",
      "/api/v2/projects/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
