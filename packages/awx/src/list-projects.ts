/**
 * list-projects.ts — Paginated project listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-projects` tool.
 */
import type { AwxClient } from "./client.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX project (relevant subset of fields) */
export interface Project {
  id: number;
  name: string;
  type: string;
  url: string;
  summary_fields: Record<string, unknown>;
  created: string;
  modified: string;
  description: string;
  scm_type: string;
  status: string;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/projects/ */
export interface PaginatedResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Project[];
}

/** Structured output of the list-projects tool */
export interface ListProjectsOutput {
  count: number;
  results: Project[];
  warning?: string;
}

/** Options for listProjects */
export interface ListProjectsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /**
   * Optional filter strings for server-side filtering.
   * Each string should be in the format "field__operator=value"
   * (e.g., "name__icontains=workspace"). These are passed as
   * query parameters to the AWX API.
   */
  filters?: string[];
}

/* ── Timeout budget ─────────────────────────────────────────────── */

/**
 * Calculate per-page timeout budget.
 *
 * Formula: totalTimeout / (maxPages + 1)
 * The +1 accounts for any overhead/rounding and ensures we never
 * exceed the total tool timeout even if all pages are fetched.
 *
 * @param totalTimeout  Total tool timeout in milliseconds
 * @param maxPages      Maximum number of pages to fetch
 * @returns Per-page budget in milliseconds (rounded down)
 */
export function calcPageBudget(totalTimeout: number, maxPages: number): number {
  return Math.floor(totalTimeout / (maxPages + 1));
}

/* ── URL builder ────────────────────────────────────────────────── */

/**
 * Build the request URL with pagination parameters and optional filters.
 * Filter strings are split on the first `=` to form query parameters.
 */
function buildProjectsUrl(page: number, pageSize: number, filters?: string[]): string {
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
  return `/api/v2/projects/?${params.toString()}`;
}

/* ── Pagination logic ───────────────────────────────────────────── */

/**
 * Fetch paginated projects from the AWX API, consolidate results,
 * and return them sorted by name.
 *
 * @param client   The AWX HTTP client
 * @param options  Pagination, timeout, and filter options
 * @returns Consolidated, sorted list of projects
 */
export async function listProjects(
  client: AwxClient,
  options?: ListProjectsOptions,
): Promise<ListProjectsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allProjects: Project[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    // Check if tool has been aborted
    if (toolAbortSignal?.aborted) {
      throw toolAbortSignal.reason ?? new DOMException("Aborted", "AbortError");
    }

    // Create per-page timeout signal
    const pageController = new AbortController();
    const pageTimer = setTimeout(
      () => pageController.abort(new DOMException(`Page ${page} timed out after ${pageBudget}ms`, "TimeoutError")),
      pageBudget,
    );

    // Wire tool abort signal to page controller
    const abortHandler = (): void => {
      clearTimeout(pageTimer);
      pageController.abort(toolAbortSignal!.reason ?? new DOMException("Aborted", "AbortError"));
    };

    if (toolAbortSignal && !toolAbortSignal.aborted) {
      toolAbortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      // Build request path with pagination parameters and optional filters
      const path = buildProjectsUrl(page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-projects",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch projects: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedResponse;
      allProjects.push(...data.results);

      if (!data.next) {
        hasMore = false;
      }

      page++;
    } finally {
      clearTimeout(pageTimer);
      if (toolAbortSignal && !toolAbortSignal.aborted) {
        toolAbortSignal.removeEventListener("abort", abortHandler);
      }
      pageController.abort(); // prevent any lingering signal listeners
    }
  }

  // Sort consolidated results by name (case-insensitive alphanumeric)
  allProjects.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListProjectsOutput = {
    count: allProjects.length,
    results: allProjects,
  };

  // If we exhausted the page cap but there are more pages, warn
  if (page > maxPages && hasMore) {
    output.warning = "More items exist. Increase max-pages or use a filter.";
  }

  return output;
}
