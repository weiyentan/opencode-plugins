/**
 * List Hosts Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * inventory_id pass-through, and error handling for listHosts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listHosts } from "../src/list-hosts.js";
import type { Host, ListHostsOutput } from "../src/list-hosts.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockHost(overrides?: Partial<Host>): Host {
  return {
    id: 1,
    name: "host-a",
    type: "host",
    url: "/api/v2/hosts/1/",
    description: "Test host",
    inventory: 42,
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<Host>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<Host> = {
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
   Tracer Bullet: basic listHosts shape
   ══════════════════════════════════════════════════════════════════ */

describe("listHosts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no hosts exist", async () => {
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

    const result = await listHosts(client, 42);

    expect(result).toEqual<Partial<ListHostsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-hosts",
      "/api/v2/inventories/42/hosts/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of hosts", async () => {
    const client = createMockClient();
    const host1 = createMockHost({ id: 1, name: "host-a" });
    const host2 = createMockHost({ id: 2, name: "host-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [host1, host2],
          next: null,
        },
      }),
    );

    const result = await listHosts(client, 42);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("host-a");
    expect(result.results[1].name).toBe("host-b");
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

    await listHosts(client, 99);

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-hosts",
      "/api/v2/inventories/99/hosts/?page=1&page_size=50",
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

    await listHosts(client, 7);

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-hosts",
      "/api/v2/inventories/7/hosts/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Hosts = [
      createMockHost({ id: 1, name: "host-a" }),
      createMockHost({ id: 2, name: "host-b" }),
    ];
    const page2Hosts = [
      createMockHost({ id: 3, name: "host-c" }),
      createMockHost({ id: 4, name: "host-d" }),
    ];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: page1Hosts,
            next: "/api/v2/inventories/42/hosts/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: page2Hosts,
            next: null,
          },
        }),
      );

    const result = await listHosts(client, 42);

    expect(result.count).toBe(4);
    expect(result.results).toHaveLength(4);
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-hosts", "/api/v2/inventories/42/hosts/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-hosts", "/api/v2/inventories/42/hosts/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Hosts = [createMockHost({ id: 1, name: "host-a" })];
    const page2Hosts: Host[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Hosts, next: "/api/v2/inventories/42/hosts/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Hosts, next: null },
        }),
      );

    const result = await listHosts(client, 42);

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
            results: [createMockHost({ id: i + 1, name: `host-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/inventories/42/hosts/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listHosts(client, 42, { maxPages: 3 });

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
            results: [createMockHost({ id: 1, name: "host-a" })],
            next: "/api/v2/inventories/42/hosts/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockHost({ id: 2, name: "host-b" })],
            next: null,
          },
        }),
      );

    const result = await listHosts(client, 42, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const hosts = [
      createMockHost({ id: 3, name: "z-host" }),
      createMockHost({ id: 1, name: "alpha-host" }),
      createMockHost({ id: 2, name: "beta-host" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: hosts,
          next: null,
        },
      }),
    );

    const result = await listHosts(client, 42);

    expect(result.results[0].name).toBe("alpha-host");
    expect(result.results[1].name).toBe("beta-host");
    expect(result.results[2].name).toBe("z-host");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: [
              createMockHost({ id: 3, name: "c-host" }),
              createMockHost({ id: 1, name: "a-host" }),
            ],
            next: "/api/v2/inventories/42/hosts/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 4,
            results: [
              createMockHost({ id: 4, name: "d-host" }),
              createMockHost({ id: 2, name: "b-host" }),
            ],
            next: null,
          },
        }),
      );

    const result = await listHosts(client, 42);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-host");
    expect(result.results[1].name).toBe("b-host");
    expect(result.results[2].name).toBe("c-host");
    expect(result.results[3].name).toBe("d-host");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const hosts = [createMockHost({ id: 1, name: "host-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: hosts, next: null },
      }),
    );

    await listHosts(client, 42, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-hosts",
      "/api/v2/inventories/42/hosts/?page=1&page_size=10",
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

    await expect(listHosts(client, 42)).rejects.toThrow(
      "Failed to fetch hosts: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockHost()], next: null },
      }),
    );

    await expect(
      listHosts(client, 42, { abortSignal: controller.signal }),
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

    const listPromise = listHosts(client, 42, { timeout: 6_000, maxPages: 2 });
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

    await listHosts(client, 42, { filters: ["name__icontains=web"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-hosts",
      "/api/v2/inventories/42/hosts/?page=1&page_size=50&name__icontains=web",
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

    await expect(listHosts(client, 99999)).rejects.toThrow(
      "Failed to fetch hosts: 404 Error",
    );
  });
});
