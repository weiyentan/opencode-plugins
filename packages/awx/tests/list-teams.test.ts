/**
 * List Teams Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-teams tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listTeams } from "../src/list-teams.js";
import type { Team, ListTeamsOutput } from "../src/list-teams.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockTeam(overrides?: Partial<Team>): Team {
  return {
    id: 1,
    name: "team-a",
    description: "Test team",
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<Team>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<Team> = {
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
   Tracer Bullet: basic listTeams shape
   ══════════════════════════════════════════════════════════════════ */

describe("listTeams", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no teams exist", async () => {
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

    const result = await listTeams(client);

    expect(result).toEqual<Partial<ListTeamsOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-teams",
      "/api/v2/teams/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of teams", async () => {
    const client = createMockClient();
    const team1 = createMockTeam({ id: 1, name: "team-a" });
    const team2 = createMockTeam({ id: 2, name: "team-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [team1, team2],
          next: null,
        },
      }),
    );

    const result = await listTeams(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("team-a");
    expect(result.results[1].name).toBe("team-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Teams = [
      createMockTeam({ id: 1, name: "team-a" }),
      createMockTeam({ id: 2, name: "team-b" }),
    ];
    const page2Teams = [
      createMockTeam({ id: 3, name: "team-c" }),
      createMockTeam({ id: 4, name: "team-d" }),
    ];
    const page3Teams = [
      createMockTeam({ id: 5, name: "team-e" }),
    ];

    // Page 1 has next → page 2
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Teams,
          next: "/api/v2/teams/?page=2",
        },
      }),
    );
    // Page 2 has next → page 3
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Teams,
          next: "/api/v2/teams/?page=3",
        },
      }),
    );
    // Page 3 has no next
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Teams,
          next: null,
        },
      }),
    );

    const result = await listTeams(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    // Verify page increment
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-teams", "/api/v2/teams/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-teams", "/api/v2/teams/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-teams", "/api/v2/teams/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Teams = [createMockTeam({ id: 1, name: "team-a" })];
    const page2Teams: Team[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Teams, next: "/api/v2/teams/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Teams, next: null },
        }),
      );

    const result = await listTeams(client);

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
            results: [createMockTeam({ id: i + 1, name: `team-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/teams/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listTeams(client, { maxPages: 3 });

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
            results: [createMockTeam({ id: 1, name: "team-a" })],
            next: "/api/v2/teams/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockTeam({ id: 2, name: "team-b" })],
            next: null,
          },
        }),
      );

    const result = await listTeams(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const teams = [
      createMockTeam({ id: 3, name: "z-team" }),
      createMockTeam({ id: 1, name: "alpha-team" }),
      createMockTeam({ id: 2, name: "beta-team" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: teams,
          next: null,
        },
      }),
    );

    const result = await listTeams(client);

    expect(result.results[0].name).toBe("alpha-team");
    expect(result.results[1].name).toBe("beta-team");
    expect(result.results[2].name).toBe("z-team");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockTeam({ id: 3, name: "c-team" }),
            createMockTeam({ id: 1, name: "a-team" }),
          ],
          next: "/api/v2/teams/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockTeam({ id: 4, name: "d-team" }),
            createMockTeam({ id: 2, name: "b-team" }),
          ],
          next: null,
        },
      }),
    );

    const result = await listTeams(client);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-team");
    expect(result.results[1].name).toBe("b-team");
    expect(result.results[2].name).toBe("c-team");
    expect(result.results[3].name).toBe("d-team");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const teams = [createMockTeam({ id: 1, name: "team-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: teams, next: null },
      }),
    );

    await listTeams(client, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-teams",
      "/api/v2/teams/?page=1&page_size=10",
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

    await expect(listTeams(client)).rejects.toThrow(
      "Failed to fetch teams: 500 Error",
    );
  });

  it("throws on 404 error", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 404 }),
    );

    await expect(listTeams(client)).rejects.toThrow(
      "Failed to fetch teams: 404 Error",
    );
  });

  it("throws on 401 error", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 401 }),
    );

    await expect(listTeams(client)).rejects.toThrow(
      "Failed to fetch teams: 401 Error",
    );
  });

  it("throws on network error", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );

    await expect(listTeams(client)).rejects.toThrow("fetch failed");
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockTeam()], next: null },
      }),
    );

    await expect(
      listTeams(client, { abortSignal: controller.signal }),
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

    const listPromise = listTeams(client, { timeout: 6_000, maxPages: 2 });
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

    await listTeams(client, { filters: ["name__icontains=engineering"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-teams",
      "/api/v2/teams/?page=1&page_size=50&name__icontains=engineering",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
