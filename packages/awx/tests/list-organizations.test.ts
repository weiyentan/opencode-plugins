/**
 * List Organizations Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-organizations tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listOrganizations } from "../src/list-organizations.js";
import type { Organization, ListOrganizationsOutput } from "../src/list-organizations.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockOrganization(overrides?: Partial<Organization>): Organization {
  return {
    id: 1,
    name: "org-a",
    type: "organization",
    url: "/api/v2/organizations/1/",
    description: "Test organization",
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<Organization>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<Organization> = {
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
   Tracer Bullet: basic listOrganizations shape
   ══════════════════════════════════════════════════════════════════ */

describe("listOrganizations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no organizations exist", async () => {
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

    const result = await listOrganizations(client);

    expect(result).toEqual<Partial<ListOrganizationsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-organizations",
      "/api/v2/organizations/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of organizations", async () => {
    const client = createMockClient();
    const org1 = createMockOrganization({ id: 1, name: "org-a" });
    const org2 = createMockOrganization({ id: 2, name: "org-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [org1, org2],
          next: null,
        },
      }),
    );

    const result = await listOrganizations(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("org-a");
    expect(result.results[1].name).toBe("org-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Orgs = [
      createMockOrganization({ id: 1, name: "org-a" }),
      createMockOrganization({ id: 2, name: "org-b" }),
    ];
    const page2Orgs = [
      createMockOrganization({ id: 3, name: "org-c" }),
      createMockOrganization({ id: 4, name: "org-d" }),
    ];
    const page3Orgs = [
      createMockOrganization({ id: 5, name: "org-e" }),
    ];

    // Page 1 has next → page 2
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Orgs,
          next: "/api/v2/organizations/?page=2",
        },
      }),
    );
    // Page 2 has next → page 3
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Orgs,
          next: "/api/v2/organizations/?page=3",
        },
      }),
    );
    // Page 3 has no next
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Orgs,
          next: null,
        },
      }),
    );

    const result = await listOrganizations(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    // Verify page increment
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-organizations", "/api/v2/organizations/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-organizations", "/api/v2/organizations/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-organizations", "/api/v2/organizations/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Orgs = [createMockOrganization({ id: 1, name: "org-a" })];
    const page2Orgs: Organization[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Orgs, next: "/api/v2/organizations/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Orgs, next: null },
        }),
      );

    const result = await listOrganizations(client);

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
            results: [createMockOrganization({ id: i + 1, name: `org-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/organizations/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listOrganizations(client, { maxPages: 3 });

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
            results: [createMockOrganization({ id: 1, name: "org-a" })],
            next: "/api/v2/organizations/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockOrganization({ id: 2, name: "org-b" })],
            next: null,
          },
        }),
      );

    const result = await listOrganizations(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const orgs = [
      createMockOrganization({ id: 3, name: "z-org" }),
      createMockOrganization({ id: 1, name: "alpha-org" }),
      createMockOrganization({ id: 2, name: "beta-org" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: orgs,
          next: null,
        },
      }),
    );

    const result = await listOrganizations(client);

    expect(result.results[0].name).toBe("alpha-org");
    expect(result.results[1].name).toBe("beta-org");
    expect(result.results[2].name).toBe("z-org");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockOrganization({ id: 3, name: "c-org" }),
            createMockOrganization({ id: 1, name: "a-org" }),
          ],
          next: "/api/v2/organizations/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockOrganization({ id: 4, name: "d-org" }),
            createMockOrganization({ id: 2, name: "b-org" }),
          ],
          next: null,
        },
      }),
    );

    const result = await listOrganizations(client);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-org");
    expect(result.results[1].name).toBe("b-org");
    expect(result.results[2].name).toBe("c-org");
    expect(result.results[3].name).toBe("d-org");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const orgs = [createMockOrganization({ id: 1, name: "org-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: orgs, next: null },
      }),
    );

    await listOrganizations(client, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-organizations",
      "/api/v2/organizations/?page=1&page_size=10",
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

    await expect(listOrganizations(client)).rejects.toThrow(
      "Failed to fetch organizations: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockOrganization()], next: null },
      }),
    );

    await expect(
      listOrganizations(client, { abortSignal: controller.signal }),
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

    const listPromise = listOrganizations(client, { timeout: 6_000, maxPages: 2 });
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

    await listOrganizations(client, { filters: ["name__icontains=prod"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-organizations",
      "/api/v2/organizations/?page=1&page_size=50&name__icontains=prod",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
