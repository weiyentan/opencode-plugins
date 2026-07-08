/**
 * List Instance Groups Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-instance-groups module.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

import { listInstanceGroups } from "../src/list-instance-groups.js";
import type { InstanceGroup, ListInstanceGroupsOutput } from "../src/list-instance-groups.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockInstanceGroup(overrides?: Partial<InstanceGroup>): InstanceGroup {
  return {
    id: 1,
    name: "default",
    is_container_group: false,
    credential: null,
    summary_fields: {},
    created: "2024-01-01T00:00:00Z",
    modified: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<InstanceGroup>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<InstanceGroup> = {
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
   Tracer Bullet: basic listInstanceGroups shape
   ══════════════════════════════════════════════════════════════════ */

describe("listInstanceGroups", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no instance groups exist", async () => {
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

    const result = await listInstanceGroups(client);

    expect(result).toEqual<Partial<ListInstanceGroupsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-instance-groups",
      "/api/v2/instance_groups/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of instance groups", async () => {
    const client = createMockClient();
    const ig1 = createMockInstanceGroup({ id: 1, name: "controlplane" });
    const ig2 = createMockInstanceGroup({ id: 2, name: "execution" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [ig1, ig2],
          next: null,
        },
      }),
    );

    const result = await listInstanceGroups(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("controlplane");
    expect(result.results[1].name).toBe("execution");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1 = [
      createMockInstanceGroup({ id: 1, name: "alpha" }),
      createMockInstanceGroup({ id: 2, name: "beta" }),
    ];
    const page2 = [
      createMockInstanceGroup({ id: 3, name: "gamma" }),
      createMockInstanceGroup({ id: 4, name: "delta" }),
    ];
    const page3 = [
      createMockInstanceGroup({ id: 5, name: "epsilon" }),
    ];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 5, results: page1, next: "/api/v2/instance_groups/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 5, results: page2, next: "/api/v2/instance_groups/?page=3" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 5, results: page3, next: null },
        }),
      );

    const result = await listInstanceGroups(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-instance-groups", "/api/v2/instance_groups/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-instance-groups", "/api/v2/instance_groups/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-instance-groups", "/api/v2/instance_groups/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1 = [createMockInstanceGroup({ id: 1, name: "group-a" })];
    const page2: InstanceGroup[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1, next: "/api/v2/instance_groups/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2, next: null },
        }),
      );

    const result = await listInstanceGroups(client);

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
            results: [createMockInstanceGroup({ id: i + 1, name: `group-${i + 1}` })],
            next: i < 5 ? `/api/v2/instance_groups/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listInstanceGroups(client, { maxPages: 3 });

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
            results: [createMockInstanceGroup({ id: 1, name: "group-a" })],
            next: "/api/v2/instance_groups/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockInstanceGroup({ id: 2, name: "group-b" })],
            next: null,
          },
        }),
      );

    const result = await listInstanceGroups(client, { maxPages: 5 });

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
      createMockInstanceGroup({ id: 3, name: "z-group" }),
      createMockInstanceGroup({ id: 1, name: "alpha-group" }),
      createMockInstanceGroup({ id: 2, name: "beta-group" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 3, results: groups, next: null },
      }),
    );

    const result = await listInstanceGroups(client);

    expect(result.results[0].name).toBe("alpha-group");
    expect(result.results[1].name).toBe("beta-group");
    expect(result.results[2].name).toBe("z-group");
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

    await listInstanceGroups(client, { pageSize: 25 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-instance-groups",
      "/api/v2/instance_groups/?page=1&page_size=25",
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

    await expect(listInstanceGroups(client)).rejects.toThrow(
      "Failed to fetch instance groups: 500 Error",
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
      listInstanceGroups(client, { abortSignal: controller.signal }),
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

    await listInstanceGroups(client, { filters: ["name__icontains=control"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-instance-groups",
      "/api/v2/instance_groups/?page=1&page_size=50&name__icontains=control",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
