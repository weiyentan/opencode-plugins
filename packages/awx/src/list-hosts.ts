/**
 * list-hosts.ts — Paginated host listing for a given AWX inventory.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-hosts` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX host (relevant subset of fields) */
export interface Host {
  id: number;
  name: string;
  type: string;
  url: string;
  description: string;
  inventory: number;
  summary_fields?: {
    inventory?: { id?: number; name?: string };
    groups?: { id?: number; name?: string }[];
    recent_jobs?: { id?: number; name?: string; status?: string }[];
  };
  created: string;
  modified: string;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/inventories/{id}/hosts/ */
export interface PaginatedHostResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Host[];
}

/** Structured output of the list-hosts tool */
export interface ListHostsOutput {
  count: number;
  results: Host[];
  warning?: string;
}

/** Options for listHosts */
export interface ListHostsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listHosts(
  client: AwxClient,
  inventoryId: number,
  options?: ListHostsOptions,
): Promise<ListHostsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allHosts: Host[] = [];
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
      const path = buildPaginatedUrl(`/api/v2/inventories/${inventoryId}/hosts/`, page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-hosts",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch hosts: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedHostResponse;
      allHosts.push(...data.results);

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

  allHosts.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListHostsOutput = {
    count: allHosts.length,
    results: allHosts,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
