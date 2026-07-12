/**
 * Pagination Tests — GitLab Plugin
 *
 * Validates GitLab-style pagination header parsing with both
 * X-Total-Pages/X-Page headers and Link header relations.
 */
import { describe, it, expect } from "vitest";
import {
  parsePaginationHeaders,
  hasNextPage,
  hasPrevPage,
  getNextPageUrl,
  buildPaginatedUrl,
  calcPageBudget,
  pageCapWarning,
} from "../src/pagination.js";

/* ── Helper to create a mock Response with headers ──────────── */
function mockResponse(headers: Record<string, string>): Response {
  const h = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    h.set(key, value);
  }
  return { headers: h } as unknown as Response;
}

describe("parsePaginationHeaders", () => {
  it("parses all X-Total-Pages numeric headers", () => {
    const response = mockResponse({
      "X-Total": "150",
      "X-Total-Pages": "15",
      "X-Page": "3",
      "X-Per-Page": "10",
      "X-Next-Page": "4",
      "X-Prev-Page": "2",
    });

    const info = parsePaginationHeaders(response);

    expect(info.total).toBe(150);
    expect(info.totalPages).toBe(15);
    expect(info.page).toBe(3);
    expect(info.perPage).toBe(10);
    expect(info.nextPage).toBe(4);
    expect(info.prevPage).toBe(2);
  });

  it("returns null for missing headers", () => {
    const response = mockResponse({});
    const info = parsePaginationHeaders(response);

    expect(info.total).toBeNull();
    expect(info.totalPages).toBeNull();
    expect(info.page).toBeNull();
    expect(info.perPage).toBeNull();
    expect(info.nextPage).toBeNull();
    expect(info.prevPage).toBeNull();
    expect(info.links).toEqual({});
  });

  it("returns null for empty string header values", () => {
    const response = mockResponse({
      "X-Next-Page": "",
      "X-Prev-Page": "",
    });

    const info = parsePaginationHeaders(response);

    expect(info.nextPage).toBeNull();
    expect(info.prevPage).toBeNull();
  });

  it("parses Link header with next, prev, first, last relations", () => {
    const linkHeader =
      '<https://gitlab.com/api/v4/projects?page=1>; rel="first", ' +
      '<https://gitlab.com/api/v4/projects?page=2>; rel="prev", ' +
      '<https://gitlab.com/api/v4/projects?page=4>; rel="next", ' +
      '<https://gitlab.com/api/v4/projects?page=15>; rel="last"';

    const response = mockResponse({ Link: linkHeader });
    const info = parsePaginationHeaders(response);

    expect(info.links.first).toBe("https://gitlab.com/api/v4/projects?page=1");
    expect(info.links.prev).toBe("https://gitlab.com/api/v4/projects?page=2");
    expect(info.links.next).toBe("https://gitlab.com/api/v4/projects?page=4");
    expect(info.links.last).toBe("https://gitlab.com/api/v4/projects?page=15");
  });

  it("handles malformed Link header gracefully", () => {
    const response = mockResponse({
      Link: "garbage",
    });
    const info = parsePaginationHeaders(response);
    expect(info.links).toEqual({});
  });

  it("parses both X-Total-Pages and Link headers together", () => {
    const response = mockResponse({
      "X-Total": "150",
      "X-Total-Pages": "15",
      "X-Page": "3",
      "X-Per-Page": "10",
      "X-Next-Page": "4",
      Link: '<https://gitlab.com/api/v4/projects?page=4>; rel="next"',
    });

    const info = parsePaginationHeaders(response);

    expect(info.total).toBe(150);
    expect(info.page).toBe(3);
    expect(info.nextPage).toBe(4);
    expect(info.links.next).toBe("https://gitlab.com/api/v4/projects?page=4");
  });
});

describe("hasNextPage", () => {
  it("returns true when X-Next-Page is present", () => {
    const info = { nextPage: 4, links: {}, total: null, totalPages: null, page: null, perPage: null, prevPage: null };
    expect(hasNextPage(info)).toBe(true);
  });

  it("returns false when X-Next-Page is null and no Link next", () => {
    const info = { nextPage: null, links: {}, total: null, totalPages: null, page: null, perPage: null, prevPage: null };
    expect(hasNextPage(info)).toBe(false);
  });

  it("returns true when Link next is present (fallback)", () => {
    const info = {
      nextPage: null,
      links: { next: "https://gitlab.com/api/v4/projects?page=4" },
      total: null,
      totalPages: null,
      page: null,
      perPage: null,
      prevPage: null,
    };
    expect(hasNextPage(info)).toBe(true);
  });
});

describe("hasPrevPage", () => {
  it("returns true when X-Prev-Page is present", () => {
    const info = { prevPage: 2, links: {}, total: null, totalPages: null, page: null, perPage: null, nextPage: null };
    expect(hasPrevPage(info)).toBe(true);
  });

  it("returns false when no page info present", () => {
    const info = { prevPage: null, links: {}, total: null, totalPages: null, page: null, perPage: null, nextPage: null };
    expect(hasPrevPage(info)).toBe(false);
  });

  it("returns true when Link prev is present (fallback)", () => {
    const info = {
      prevPage: null,
      links: { prev: "https://gitlab.com/api/v4/projects?page=2" },
      total: null,
      totalPages: null,
      page: null,
      perPage: null,
      nextPage: null,
    };
    expect(hasPrevPage(info)).toBe(true);
  });
});

describe("getNextPageUrl", () => {
  it("constructs URL from X-Total-Pages headers (preferred)", () => {
    const info = {
      nextPage: 4,
      perPage: 10,
      links: {},
      total: null,
      totalPages: null,
      page: null,
      prevPage: null,
    };
    const url = getNextPageUrl("/api/v4/projects", info);
    expect(url).toBe("/api/v4/projects?page=4&per_page=10");
  });

  it("returns null when no next page exists", () => {
    const info = {
      nextPage: null,
      links: {},
      total: null,
      totalPages: null,
      page: null,
      perPage: null,
      prevPage: null,
    };
    expect(getNextPageUrl("/api/v4/projects", info)).toBeNull();
  });

  it("falls back to Link header next URL", () => {
    const info = {
      nextPage: null,
      perPage: null,
      links: { next: "https://gitlab.com/api/v4/projects?page=4" },
      total: null,
      totalPages: null,
      page: null,
      prevPage: null,
    };
    const url = getNextPageUrl("/api/v4/projects", info);
    expect(url).toBe("https://gitlab.com/api/v4/projects?page=4");
  });
});

describe("buildPaginatedUrl", () => {
  it("builds URL with page and per_page", () => {
    const url = buildPaginatedUrl("/api/v4/projects", 1, 20);
    expect(url).toBe("/api/v4/projects?page=1&per_page=20");
  });

  it("includes additional params", () => {
    const url = buildPaginatedUrl("/api/v4/projects", 3, 50, {
      search: "foo",
      order_by: "id",
    });
    expect(url).toContain("page=3");
    expect(url).toContain("per_page=50");
    expect(url).toContain("search=foo");
    expect(url).toContain("order_by=id");
  });
});

describe("calcPageBudget", () => {
  it("divides budget evenly", () => {
    expect(calcPageBudget(1000, 4)).toBe(200);
  });

  it("adds one extra slot for processing", () => {
    // (maxPages + 1) slots
    expect(calcPageBudget(500, 4)).toBe(100); // 500 / 5 = 100
  });
});

describe("pageCapWarning", () => {
  it("returns a non-empty string", () => {
    const warning = pageCapWarning();
    expect(typeof warning).toBe("string");
    expect(warning.length).toBeGreaterThan(0);
  });
});
