/**
 * list-labels.ts — Paginated label listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-labels` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX label (relevant subset of fields) */
export interface Label {
  id: number;
  name: string;
  description: string;
  organization: number;
  summary_fields?: {
    organization?: { id?: number; name?: string };
  };
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/labels/ */
export interface PaginatedLabelResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Label[];
}

/** Structured output of the list-labels tool */
export interface ListLabelsOutput {
  count: number;
  results: Label[];
  warning?: string;
}

/** Options for listLabels */
export interface ListLabelsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
  /** Convenience filter: only return labels for a specific organization ID */
  organization_id?: number;
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listLabels(
  client: AwxClient,
  options?: ListLabelsOptions,
): Promise<ListLabelsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  // Build filters — merge convenience filter with any user-supplied filters
  const filters: string[] = [...(options?.filters ?? [])];
  if (options?.organization_id !== undefined) {
    filters.push(`organization__id=${options.organization_id}`);
  }

  const allLabels: Label[] = [];
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
      const path = buildPaginatedUrl("/api/v2/labels/", page, pageSize, filters);

      const response = await client.request(
        "awx-list-labels",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch labels: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedLabelResponse;
      allLabels.push(...data.results);

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

  allLabels.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListLabelsOutput = {
    count: allLabels.length,
    results: allLabels,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
