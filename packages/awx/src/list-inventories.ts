/**
 * list-inventories.ts — Paginated inventory listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-inventories` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX inventory (relevant subset of fields) */
export interface Inventory {
  id: number;
  name: string;
  type: string;
  url: string;
  description: string;
  kind: string;
  host_count: number;
  total_groups: number;
  has_inventory_sources: boolean;
  total_inventory_sources: number;
  summary_fields?: {
    organization?: { id?: number; name?: string };
  };
  created: string;
  modified: string;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/inventories/ */
export interface PaginatedInventoryResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Inventory[];
}

/** Structured output of the list-inventories tool */
export interface ListInventoriesOutput {
  count: number;
  results: Inventory[];
  warning?: string;
}

/** Options for listInventories */
export interface ListInventoriesOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listInventories(
  client: AwxClient,
  options?: ListInventoriesOptions,
): Promise<ListInventoriesOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allInvs: Inventory[] = [];
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
      const path = buildPaginatedUrl("/api/v2/inventories/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-inventories",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch inventories: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedInventoryResponse;
      allInvs.push(...data.results);

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

  allInvs.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListInventoriesOutput = {
    count: allInvs.length,
    results: allInvs,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
