/**
 * list-groups.ts — Paginated group listing for a given AWX inventory.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-groups` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX group (relevant subset of fields) */
export interface Group {
  id: number;
  name: string;
  type: string;
  url: string;
  description: string;
  inventory: number;
  summary_fields?: {
    inventory?: { id?: number; name?: string };
    hosts?: { id?: number; name?: string }[];
  };
  created: string;
  modified: string;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/inventories/{id}/groups/ */
export interface PaginatedGroupResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Group[];
}

/** Structured output of the list-groups tool */
export interface ListGroupsOutput {
  count: number;
  results: Group[];
  warning?: string;
}

/** Options for listGroups */
export interface ListGroupsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listGroups(
  client: AwxClient,
  inventoryId: number,
  options?: ListGroupsOptions,
): Promise<ListGroupsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allGroups: Group[] = [];
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
      const path = buildPaginatedUrl(`/api/v2/inventories/${inventoryId}/groups/`, page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-groups",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch groups: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedGroupResponse;
      allGroups.push(...data.results);

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

  allGroups.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListGroupsOutput = {
    count: allGroups.length,
    results: allGroups,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
