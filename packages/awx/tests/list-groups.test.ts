/**
 * List Groups Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * inventory_id pass-through, and error handling for listGroups.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listGroups } from "../src/list-groups.js";
import type { Group, ListGroupsOutput } from "../src/list-groups.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockGroup(overrides?: Partial<Group>): Group {
  return {
    id: 1,
    name: "group-a",
    type: "group",
    url: "/api/v2/groups/1/",
    description: "Test group",
    inventory: 42,
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<Group>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<Group> = {
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
   Tracer Bullet: basic listGroups shape
   ══════════════════════════════════════════════════════════════════ */

describe("listGroups", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no groups exist", async () => {
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

    const result = await listGroups(client, 42);

    expect(result).toEqual<Partial<ListGroupsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-groups",
      "/api/v2/inventories/42/groups/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of groups", async () => {
    const client = createMockClient();
    const group1 = createMockGroup({ id: 1, name: "group-a" });
    const group2 = createMockGroup({ id: 2, name: "group-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [group1, group2],
          next: null,
        },
      }),
    );

    const result = await listGroups(client, 42);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("group-a");
    expect(result.results[1].name).toBe("group-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     inventory_id pass-through — URL construction with inventory_id
     ══════════════════════════════════════════════════════════════════ */

  it("passes inventory_id into the request URL", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listGroups(client, 99);

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-groups",
      "/api/v2/inventories/99/groups/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("uses different inventory_id in URL", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listGroups(client, 7);

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-groups",
      "/api/v2/inventories/7/groups/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Groups = [
      createMockGroup({ id: 1, name: "group-a" }),
      createMockGroup({ id: 2, name: "group-b" }),
    ];
    const page2Groups = [
      createMockGroup({ id: 3, name: "group-c" }),
      createMockGroup({ id: 4, name: "group-d" }),
    ];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: page1Groups,
            next: "/api/v2/inventories/42/groups/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: page2Groups,
            next: null,
          },
        }),
      );

    const result = await listGroups(client, 42);

    expect(result.count).toBe(4);
    expect(result.results).toHaveLength(4);
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-groups", "/api/v2/inventories/42/groups/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-groups", "/api/v2/inventories/42/groups/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Groups = [createMockGroup({ id: 1, name: "group-a" })];
    const page2Groups: Group[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Groups, next: "/api/v2/inventories/42/groups/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Groups, next: null },
        }),
      );

    const result = await listGroups(client, 42);

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
            results: [createMockGroup({ id: i + 1, name: `group-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/inventories/42/groups/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listGroups(client, 42, { maxPages: 3 });

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
            results: [createMockGroup({ id: 1, name: "group-a" })],
            next: "/api/v2/inventories/42/groups/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockGroup({ id: 2, name: "group-b" })],
            next: null,
          },
        }),
      );

    const result = await listGroups(client, 42, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const groups = [
      createMockGroup({ id: 3, name: "z-group" }),
      createMockGroup({ id: 1, name: "alpha-group" }),
      createMockGroup({ id: 2, name: "beta-group" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: groups,
          next: null,
        },
      }),
    );

    const result = await listGroups(client, 42);

    expect(result.results[0].name).toBe("alpha-group");
    expect(result.results[1].name).toBe("beta-group");
    expect(result.results[2].name).toBe("z-group");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: [
              createMockGroup({ id: 3, name: "c-group" }),
              createMockGroup({ id: 1, name: "a-group" }),
            ],
            next: "/api/v2/inventories/42/groups/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: [
              createMockGroup({ id: 4, name: "d-group" }),
              createMockGroup({ id: 2, name: "b-group" }),
            ],
            next: null,
          },
        }),
      );

    const result = await listGroups(client, 42);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-group");
    expect(result.results[1].name).toBe("b-group");
    expect(result.results[2].name).toBe("c-group");
    expect(result.results[3].name).toBe("d-group");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const groups = [createMockGroup({ id: 1, name: "group-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: groups, next: null },
      }),
    );

    await listGroups(client, 42, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-groups",
      "/api/v2/inventories/42/groups/?page=1&page_size=10",
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

    await expect(listGroups(client, 42)).rejects.toThrow(
      "Failed to fetch groups: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockGroup()], next: null },
      }),
    );

    await expect(
      listGroups(client, 42, { abortSignal: controller.signal }),
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

    const listPromise = listGroups(client, 42, { timeout: 6_000, maxPages: 2 });
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

    await listGroups(client, 42, { filters: ["name__icontains=web"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-groups",
      "/api/v2/inventories/42/groups/?page=1&page_size=50&name__icontains=web",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     404 Error Handling
     ══════════════════════════════════════════════════════════════════ */

  it("throws error with 404 status for invalid inventory_id", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 404 }),
    );

    await expect(listGroups(client, 99999)).rejects.toThrow(
      "Failed to fetch groups: 404 Error",
    );
  });
});
