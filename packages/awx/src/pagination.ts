/**
 * Shared pagination utility for the AWX plugin.
 *
 * Provides helpers for paginated API response types, URL construction,
 * timeout budget calculation, and standard warning messages.
 * Consumed by list-*.ts modules to eliminate code duplication.
 *
 * @module
 */

/**
 * Divides the total timeout budget among (maxPages + 1) slots.
 *
 * Each page fetch gets its own slice of the budget so that a single
 * slow page does not starve subsequent pages or final result processing.
 *
 * @param totalTimeout - Total available timeout in milliseconds.
 * @param maxPages     - Maximum number of pages to fetch.
 * @returns The per-page budget, rounded down to the nearest whole millisecond.
 */
export function calcPageBudget(totalTimeout: number, maxPages: number): number {
  return Math.floor(totalTimeout / (maxPages + 1));
}

/**
 * Represents the standard AWX paginated API response envelope.
 *
 * @typeParam T - The type of each item in the result set.
 */
export interface AwxPageResponse<T> {
  /** Total number of items across all pages. */
  count: number;
  /** URL of the next page, or `null` if this is the last page. */
  next: string | null;
  /** URL of the previous page, or `null` if this is the first page. */
  previous: string | null;
  /** Array of items for the current page. */
  results: T[];
}

/**
 * Builds a URL string for a specific page of an AWX collection endpoint.
 *
 * Supports optional filter expressions in `key=value` form which are
 * parsed and set as query parameters alongside `page` and `page_size`.
 *
 * @param basePath - The base API path (e.g. `/api/v2/jobs/`).
 * @param page     - The 1-indexed page number.
 * @param pageSize - Number of items per page.
 * @param filters  - Optional array of `"key=value"` filter strings.
 * @returns The fully constructed URL with query string.
 */
export function buildPaginatedUrl(
  basePath: string,
  page: number,
  pageSize: number,
  filters?: string[]
): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));
  if (filters) {
    for (const f of filters) {
      const eqIdx = f.indexOf("=");
      if (eqIdx > 0) {
        params.set(f.slice(0, eqIdx), f.slice(eqIdx + 1));
      }
    }
  }
  return `${basePath}?${params.toString()}`;
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
