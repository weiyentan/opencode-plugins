/**
 * list-instance-groups.ts — Paginated instance group listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-instance-groups` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX instance group (relevant subset of fields) */
export interface InstanceGroup {
  id: number;
  name: string;
  is_container_group: boolean;
  credential: number | null;
  summary_fields: Record<string, unknown>;
  created: string;
  modified: string;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/instance_groups/ */
export interface PaginatedInstanceGroupResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: InstanceGroup[];
}

/** Structured output of the list-instance-groups tool */
export interface ListInstanceGroupsOutput {
  count: number;
  results: InstanceGroup[];
  warning?: string;
}

/** Options for listInstanceGroups */
export interface ListInstanceGroupsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listInstanceGroups(
  client: AwxClient,
  options?: ListInstanceGroupsOptions,
): Promise<ListInstanceGroupsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allGroups: InstanceGroup[] = [];
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
      const path = buildPaginatedUrl("/api/v2/instance_groups/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-instance-groups",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch instance groups: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedInstanceGroupResponse;
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

  const output: ListInstanceGroupsOutput = {
    count: allGroups.length,
    results: allGroups,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
