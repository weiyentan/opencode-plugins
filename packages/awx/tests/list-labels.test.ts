/**
 * List Labels Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-labels tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listLabels } from "../src/list-labels.js";
import type { Label, ListLabelsOutput } from "../src/list-labels.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockLabel(overrides?: Partial<Label>): Label {
  return {
    id: 1,
    name: "label-a",
    description: "Test label",
    organization: 1,
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<Label>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<Label> = {
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
   Tracer Bullet: basic listLabels shape
   ══════════════════════════════════════════════════════════════════ */

describe("listLabels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no labels exist", async () => {
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

    const result = await listLabels(client);

    expect(result).toEqual<Partial<ListLabelsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-labels",
      "/api/v2/labels/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of labels", async () => {
    const client = createMockClient();
    const label1 = createMockLabel({ id: 1, name: "label-a" });
    const label2 = createMockLabel({ id: 2, name: "label-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [label1, label2],
          next: null,
        },
      }),
    );

    const result = await listLabels(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("label-a");
    expect(result.results[1].name).toBe("label-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Labels = [
      createMockLabel({ id: 1, name: "label-a" }),
      createMockLabel({ id: 2, name: "label-b" }),
    ];
    const page2Labels = [
      createMockLabel({ id: 3, name: "label-c" }),
      createMockLabel({ id: 4, name: "label-d" }),
    ];
    const page3Labels = [
      createMockLabel({ id: 5, name: "label-e" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Labels,
          next: "/api/v2/labels/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Labels,
          next: "/api/v2/labels/?page=3",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Labels,
          next: null,
        },
      }),
    );

    const result = await listLabels(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-labels", "/api/v2/labels/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-labels", "/api/v2/labels/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-labels", "/api/v2/labels/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Labels = [createMockLabel({ id: 1, name: "label-a" })];
    const page2Labels: Label[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Labels, next: "/api/v2/labels/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Labels, next: null },
        }),
      );

    const result = await listLabels(client);

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
            results: [createMockLabel({ id: i + 1, name: `label-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/labels/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listLabels(client, { maxPages: 3 });

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
            results: [createMockLabel({ id: 1, name: "label-a" })],
            next: "/api/v2/labels/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockLabel({ id: 2, name: "label-b" })],
            next: null,
          },
        }),
      );

    const result = await listLabels(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const labels = [
      createMockLabel({ id: 3, name: "z-label" }),
      createMockLabel({ id: 1, name: "alpha-label" }),
      createMockLabel({ id: 2, name: "beta-label" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: labels,
          next: null,
        },
      }),
    );

    const result = await listLabels(client);

    expect(result.results[0].name).toBe("alpha-label");
    expect(result.results[1].name).toBe("beta-label");
    expect(result.results[2].name).toBe("z-label");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockLabel({ id: 3, name: "c-label" }),
            createMockLabel({ id: 1, name: "a-label" }),
          ],
          next: "/api/v2/labels/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockLabel({ id: 4, name: "d-label" }),
            createMockLabel({ id: 2, name: "b-label" }),
          ],
          next: null,
        },
      }),
    );

    const result = await listLabels(client);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-label");
    expect(result.results[1].name).toBe("b-label");
    expect(result.results[2].name).toBe("c-label");
    expect(result.results[3].name).toBe("d-label");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const labels = [createMockLabel({ id: 1, name: "label-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: labels, next: null },
      }),
    );

    await listLabels(client, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-labels",
      "/api/v2/labels/?page=1&page_size=10",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Convenience Filter — organization_id
     ══════════════════════════════════════════════════════════════════ */

  it("passes organization_id as server-side filter", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listLabels(client, { organization_id: 7 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-labels",
      "/api/v2/labels/?page=1&page_size=50&organization__id=7",
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

    await expect(listLabels(client)).rejects.toThrow(
      "Failed to fetch labels: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockLabel()], next: null },
      }),
    );

    await expect(
      listLabels(client, { abortSignal: controller.signal }),
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

    const listPromise = listLabels(client, { timeout: 6_000, maxPages: 2 });
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

    await listLabels(client, { filters: ["name__icontains=prod"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-labels",
      "/api/v2/labels/?page=1&page_size=50&name__icontains=prod",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("merges organization_id with user-supplied filters", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listLabels(client, {
      organization_id: 7,
      filters: ["name__icontains=prod"],
    });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-labels",
      "/api/v2/labels/?page=1&page_size=50&name__icontains=prod&organization__id=7",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
