/**
 * pagination.ts — GitLab-style pagination utilities
 *
 * Provides helpers for navigating GitLab's paginated REST API responses.
 * GitLab supports two pagination mechanisms:
 *
 * 1. **X-Total-Pages / X-Page headers**: Numeric page counts.
 *    Sent alongside every paginated response.
 *    - `X-Total`: Total number of items
 *    - `X-Total-Pages`: Total number of pages
 *    - `X-Page`: Current page number
 *    - `X-Per-Page`: Items per page
 *    - `X-Next-Page`: Next page number (or empty string if last page)
 *    - `X-Prev-Page`: Previous page number (or empty string if first page)
 *
 * 2. **Link header**: RFC 5988 web linking with `rel="next"`, `rel="prev"`,
 *    `rel="first"`, `rel="last"`. GitLab sends both mechanisms — this module
 *    prefers X-Total-Pages when available for more efficient numeric paging.
 *
 * ## Reference
 *
 * - GitLab pagination docs: https://docs.gitlab.com/ee/api/rest/index.html#pagination
 *
 * @module
 */

/**
 * GitLab pagination metadata parsed from response headers.
 *
 * Includes both the numeric page info (X-Total-Pages headers)
 * and the parsed Link relations.
 */
export interface PaginationInfo {
  /** Total number of items across all pages (X-Total) */
  total: number | null;
  /** Total number of pages (X-Total-Pages) */
  totalPages: number | null;
  /** Current page number (X-Page) */
  page: number | null;
  /** Items per page (X-Per-Page) */
  perPage: number | null;
  /** Next page number (X-Next-Page) — empty string means last page */
  nextPage: number | null;
  /** Previous page number (X-Prev-Page) — empty string means first page */
  prevPage: number | null;
  /** Parsed Link relations keyed by rel value */
  links: Record<string, string>;
}

/**
 * Parse GitLab pagination headers from a Response object.
 *
 * Extracts both X-Total-Pages numeric headers and Link header relations.
 * X-Total-Pages is preferred for numeric paging; Link headers serve as
 * a fallback when X-Total-Pages is absent.
 *
 * @param response  The fetch Response object
 * @returns Parsed pagination metadata (null fields if headers absent)
 */
export function parsePaginationHeaders(response: Response): PaginationInfo {
  const header = response.headers;

  const parseIntHeader = (name: string): number | null => {
    const val = header.get(name);
    if (val === null || val === "") return null;
    const num = parseInt(val, 10);
    return Number.isNaN(num) ? null : num;
  };

  // Parse Link header into rel→URL map
  const links: Record<string, string> = {};
  const linkHeader = header.get("Link");
  if (linkHeader) {
    // Link header format: <url>; rel="relname", <url>; rel="other"
    const parts = linkHeader.split(",");
    for (const part of parts) {
      const match = part.trim().match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match && match[1] && match[2]) {
        links[match[2]] = match[1];
      }
    }
  }

  return {
    total: parseIntHeader("X-Total"),
    totalPages: parseIntHeader("X-Total-Pages"),
    page: parseIntHeader("X-Page"),
    perPage: parseIntHeader("X-Per-Page"),
    nextPage: parseIntHeader("X-Next-Page"),
    prevPage: parseIntHeader("X-Prev-Page"),
    links,
  };
}

/**
 * Determine whether there is a next page based on pagination metadata.
 *
 * Checks X-Next-Page first (preferred), then falls back to Link header
 * with rel="next".
 *
 * @param info  Parsed pagination info from parsePaginationHeaders()
 * @returns true if there is another page after the current one
 */
export function hasNextPage(info: PaginationInfo): boolean {
  if (info.nextPage !== null) {
    return true;
  }
  return "next" in info.links && info.links.next !== undefined;
}

/**
 * Determine whether there is a previous page based on pagination metadata.
 *
 * Checks X-Prev-Page first (preferred), then falls back to Link header
 * with rel="prev".
 *
 * @param info  Parsed pagination info from parsePaginationHeaders()
 * @returns true if there is a page before the current one
 */
export function hasPrevPage(info: PaginationInfo): boolean {
  if (info.prevPage !== null) {
    return true;
  }
  return "prev" in info.links && info.links.prev !== undefined;
}

/**
 * Get the URL for the next page.
 *
 * Prefers constructing from X-Total-Pages headers (building URL with
 * `?page=N&per_page=M`), falls back to Link header with rel="next".
 *
 * @param basePath  The API path without query string (e.g., "/api/v4/projects")
 * @param info      Parsed pagination info from parsePaginationHeaders()
 * @returns URL for the next page, or null if no next page exists
 */
export function getNextPageUrl(
  basePath: string,
  info: PaginationInfo,
): string | null {
  // Prefer numeric paging via X-Total-Pages headers
  if (info.nextPage !== null && info.perPage !== null) {
    return `${basePath}?page=${info.nextPage}&per_page=${info.perPage}`;
  }

  // Fall back to Link header
  if (info.links.next) {
    return info.links.next;
  }

  return null;
}

/**
 * Build a URL for a specific page of a GitLab collection endpoint.
 *
 * @param basePath - The base API path (e.g., "/api/v4/projects")
 * @param page     - The 1-indexed page number
 * @param perPage  - Number of items per page (max 100 for GitLab)
 * @param params   - Optional additional query parameters as key-value pairs
 * @returns The fully constructed URL with query string
 */
export function buildPaginatedUrl(
  basePath: string,
  page: number,
  perPage: number,
  params?: Record<string, string>,
): string {
  const searchParams = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      searchParams.set(key, value);
    }
  }

  return `${basePath}?${searchParams.toString()}`;
}

/**
 * Divides the total timeout budget among pages.
 *
 * Each page fetch gets its own slice of the budget so that a single
 * slow page does not starve subsequent pages.
 *
 * @param totalTimeout - Total available timeout in milliseconds.
 * @param maxPages     - Maximum number of pages to fetch.
 * @returns The per-page budget, rounded down to the nearest whole millisecond.
 */
export function calcPageBudget(
  totalTimeout: number,
  maxPages: number,
): number {
  return Math.floor(totalTimeout / (maxPages + 1));
}

/**
 * Returns a standard warning string for when the pagination cap is reached
 * without covering all available items.
 *
 * @returns A human-readable warning message.
 */
export function pageCapWarning(): string {
  return "More items exist. Increase max-pages or use a filter.";
}
