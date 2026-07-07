/**
 * list-organizations.ts — Paginated organization listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-organizations` tool.
 */
import type { AwxClient } from "./client.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX organization (relevant subset of fields) */
export interface Organization {
  id: number;
  name: string;
  type: string;
  url: string;
  description: string;
  created: string;
  modified: string;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/organizations/ */
export interface PaginatedOrganizationResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Organization[];
}

/** Structured output of the list-organizations tool */
export interface ListOrganizationsOutput {
  count: number;
  results: Organization[];
  warning?: string;
}

/** Options for listOrganizations */
export interface ListOrganizationsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Timeout budget ─────────────────────────────────────────────── */

/**
 * Calculate per-page timeout budget.
 *
 * Formula: totalTimeout / (maxPages + 1)
 */
export function calcPageBudget(totalTimeout: number, maxPages: number): number {
  return Math.floor(totalTimeout / (maxPages + 1));
}

/* ── URL builder ────────────────────────────────────────────────── */

function buildOrgsUrl(page: number, pageSize: number, filters?: string[]): string {
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
  return `/api/v2/organizations/?${params.toString()}`;
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listOrganizations(
  client: AwxClient,
  options?: ListOrganizationsOptions,
): Promise<ListOrganizationsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allOrgs: Organization[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= maxPages) {
    if (toolAbortSignal?.aborted) {
      throw toolAbortSignal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const pageController = new AbortController();
    const pageTimer = setTimeout(
      () => pageController.abort(new DOMException(`Page ${page} timed out after ${pageBudget}ms`, "TimeoutError")),
      pageBudget,
    );

    const abortHandler = (): void => {
      clearTimeout(pageTimer);
      pageController.abort(toolAbortSignal!.reason ?? new DOMException("Aborted", "AbortError"));
    };

    if (toolAbortSignal && !toolAbortSignal.aborted) {
      toolAbortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      const path = buildOrgsUrl(page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-organizations",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch organizations: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedOrganizationResponse;
      allOrgs.push(...data.results);

      if (!data.next) {
        hasMore = false;
      }

      page++;
    } finally {
      clearTimeout(pageTimer);
      if (toolAbortSignal && !toolAbortSignal.aborted) {
        toolAbortSignal.removeEventListener("abort", abortHandler);
      }
      pageController.abort();
    }
  }

  allOrgs.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListOrganizationsOutput = {
    count: allOrgs.length,
    results: allOrgs,
  };

  if (page > maxPages && hasMore) {
    output.warning = "More items exist. Increase max-pages or use a filter.";
  }

  return output;
}
