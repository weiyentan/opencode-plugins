/**
 * List Execution Environments Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-execution-environments module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

import { listExecutionEnvironments } from "../src/list-execution-environments.js";
import type { ExecutionEnvironment, ListExecutionEnvironmentsOutput } from "../src/list-execution-environments.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockExecutionEnvironment(overrides?: Partial<ExecutionEnvironment>): ExecutionEnvironment {
  return {
    id: 1,
    name: "Default EE",
    description: "Default execution environment",
    image: "registry.redhat.io/ansible-automation-platform-20/ee-supported-rhel8:latest",
    managed: true,
    organization: null,
    summary_fields: {},
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<ExecutionEnvironment>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<ExecutionEnvironment> = {
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
   Tracer Bullet: basic listExecutionEnvironments shape
   ══════════════════════════════════════════════════════════════════ */

describe("listExecutionEnvironments", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no execution environments exist", async () => {
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

    const result = await listExecutionEnvironments(client);

    expect(result).toEqual<Partial<ListExecutionEnvironmentsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-execution-environments",
      "/api/v2/execution_environments/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of execution environments", async () => {
    const client = createMockClient();
    const ee1 = createMockExecutionEnvironment({ id: 1, name: "Default EE" });
    const ee2 = createMockExecutionEnvironment({ id: 2, name: "Custom EE", managed: false });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [ee1, ee2],
          next: null,
        },
      }),
    );

    const result = await listExecutionEnvironments(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("Custom EE");
    expect(result.results[1].name).toBe("Default EE");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1 = [
      createMockExecutionEnvironment({ id: 1, name: "EE Alpha" }),
      createMockExecutionEnvironment({ id: 2, name: "EE Beta" }),
    ];
    const page2 = [
      createMockExecutionEnvironment({ id: 3, name: "EE Gamma" }),
      createMockExecutionEnvironment({ id: 4, name: "EE Delta" }),
    ];
    const page3 = [
      createMockExecutionEnvironment({ id: 5, name: "EE Epsilon" }),
    ];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 5, results: page1, next: "/api/v2/execution_environments/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 5, results: page2, next: "/api/v2/execution_environments/?page=3" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 5, results: page3, next: null },
        }),
      );

    const result = await listExecutionEnvironments(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-execution-environments", "/api/v2/execution_environments/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-execution-environments", "/api/v2/execution_environments/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-execution-environments", "/api/v2/execution_environments/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1 = [createMockExecutionEnvironment({ id: 1, name: "EE A" })];
    const page2: ExecutionEnvironment[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1, next: "/api/v2/execution_environments/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2, next: null },
        }),
      );

    const result = await listExecutionEnvironments(client);

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
            results: [createMockExecutionEnvironment({ id: i + 1, name: `EE-${i + 1}` })],
            next: i < 5 ? `/api/v2/execution_environments/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listExecutionEnvironments(client, { maxPages: 3 });

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
            results: [createMockExecutionEnvironment({ id: 1, name: "EE A" })],
            next: "/api/v2/execution_environments/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockExecutionEnvironment({ id: 2, name: "EE B" })],
            next: null,
          },
        }),
      );

    const result = await listExecutionEnvironments(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const ees = [
      createMockExecutionEnvironment({ id: 3, name: "Zeta EE" }),
      createMockExecutionEnvironment({ id: 1, name: "Alpha EE" }),
      createMockExecutionEnvironment({ id: 2, name: "Beta EE" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 3, results: ees, next: null },
      }),
    );

    const result = await listExecutionEnvironments(client);

    expect(result.results[0].name).toBe("Alpha EE");
    expect(result.results[1].name).toBe("Beta EE");
    expect(result.results[2].name).toBe("Zeta EE");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listExecutionEnvironments(client, { pageSize: 25 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-execution-environments",
      "/api/v2/execution_environments/?page=1&page_size=25",
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

    await expect(listExecutionEnvironments(client)).rejects.toThrow(
      "Failed to fetch execution environments: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await expect(
      listExecutionEnvironments(client, { abortSignal: controller.signal }),
    ).rejects.toThrow(DOMException);
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

    await listExecutionEnvironments(client, { filters: ["name__icontains=custom"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-execution-environments",
      "/api/v2/execution_environments/?page=1&page_size=50&name__icontains=custom",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
