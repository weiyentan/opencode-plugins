/**
 * List Inventories Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-inventories tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listInventories } from "../src/list-inventories.js";
import type { Inventory, ListInventoriesOutput } from "../src/list-inventories.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockInventory(overrides?: Partial<Inventory>): Inventory {
  return {
    id: 1,
    name: "inv-a",
    type: "inventory",
    url: "/api/v2/inventories/1/",
    description: "Test inventory",
    kind: "",
    host_count: 0,
    total_groups: 0,
    has_inventory_sources: false,
    total_inventory_sources: 0,
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<Inventory>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<Inventory> = {
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
   Tracer Bullet: basic listInventories shape
   ══════════════════════════════════════════════════════════════════ */

describe("listInventories", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no inventories exist", async () => {
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

    const result = await listInventories(client);

    expect(result).toEqual<Partial<ListInventoriesOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-inventories",
      "/api/v2/inventories/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of inventories", async () => {
    const client = createMockClient();
    const inv1 = createMockInventory({ id: 1, name: "inv-a" });
    const inv2 = createMockInventory({ id: 2, name: "inv-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [inv1, inv2],
          next: null,
        },
      }),
    );

    const result = await listInventories(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("inv-a");
    expect(result.results[1].name).toBe("inv-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Invs = [
      createMockInventory({ id: 1, name: "inv-a" }),
      createMockInventory({ id: 2, name: "inv-b" }),
    ];
    const page2Invs = [
      createMockInventory({ id: 3, name: "inv-c" }),
      createMockInventory({ id: 4, name: "inv-d" }),
    ];
    const page3Invs = [
      createMockInventory({ id: 5, name: "inv-e" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Invs,
          next: "/api/v2/inventories/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Invs,
          next: "/api/v2/inventories/?page=3",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Invs,
          next: null,
        },
      }),
    );

    const result = await listInventories(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-inventories", "/api/v2/inventories/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-inventories", "/api/v2/inventories/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-inventories", "/api/v2/inventories/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Invs = [createMockInventory({ id: 1, name: "inv-a" })];
    const page2Invs: Inventory[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Invs, next: "/api/v2/inventories/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Invs, next: null },
        }),
      );

    const result = await listInventories(client);

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
            results: [createMockInventory({ id: i + 1, name: `inv-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/inventories/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listInventories(client, { maxPages: 3 });

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
            results: [createMockInventory({ id: 1, name: "inv-a" })],
            next: "/api/v2/inventories/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockInventory({ id: 2, name: "inv-b" })],
            next: null,
          },
        }),
      );

    const result = await listInventories(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const invs = [
      createMockInventory({ id: 3, name: "z-inv" }),
      createMockInventory({ id: 1, name: "alpha-inv" }),
      createMockInventory({ id: 2, name: "beta-inv" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: invs,
          next: null,
        },
      }),
    );

    const result = await listInventories(client);

    expect(result.results[0].name).toBe("alpha-inv");
    expect(result.results[1].name).toBe("beta-inv");
    expect(result.results[2].name).toBe("z-inv");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockInventory({ id: 3, name: "c-inv" }),
            createMockInventory({ id: 1, name: "a-inv" }),
          ],
          next: "/api/v2/inventories/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockInventory({ id: 4, name: "d-inv" }),
            createMockInventory({ id: 2, name: "b-inv" }),
          ],
          next: null,
        },
      }),
    );

    const result = await listInventories(client);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-inv");
    expect(result.results[1].name).toBe("b-inv");
    expect(result.results[2].name).toBe("c-inv");
    expect(result.results[3].name).toBe("d-inv");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const invs = [createMockInventory({ id: 1, name: "inv-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: invs, next: null },
      }),
    );

    await listInventories(client, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-inventories",
      "/api/v2/inventories/?page=1&page_size=10",
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

    await expect(listInventories(client)).rejects.toThrow(
      "Failed to fetch inventories: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockInventory()], next: null },
      }),
    );

    await expect(
      listInventories(client, { abortSignal: controller.signal }),
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

    const listPromise = listInventories(client, { timeout: 6_000, maxPages: 2 });
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

    await listInventories(client, { filters: ["name__icontains=prod"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-inventories",
      "/api/v2/inventories/?page=1&page_size=50&name__icontains=prod",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
