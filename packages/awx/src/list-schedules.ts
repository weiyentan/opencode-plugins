/**
 * list-schedules.ts — Paginated schedule listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-schedules` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX schedule (relevant subset of fields) */
export interface Schedule {
  id: number;
  name: string;
  description: string;
  unified_job_template: number;
  summary_fields?: {
    unified_job_template?: { id?: number; name?: string; description?: string };
    schedule?: { id?: number; name?: string };
  };
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/schedules/ */
export interface PaginatedScheduleResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Schedule[];
}

/** Structured output of the list-schedules tool */
export interface ListSchedulesOutput {
  count: number;
  results: Schedule[];
  warning?: string;
}

/** Options for listSchedules */
export interface ListSchedulesOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
  /** Convenience filter: only return schedules for a specific unified job template ID */
  unified_job_template_id?: number;
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listSchedules(
  client: AwxClient,
  options?: ListSchedulesOptions,
): Promise<ListSchedulesOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  // Build filters — merge convenience filter with any user-supplied filters
  const filters: string[] = [...(options?.filters ?? [])];
  if (options?.unified_job_template_id !== undefined) {
    filters.push(`unified_job_template__id=${options.unified_job_template_id}`);
  }

  const allSchedules: Schedule[] = [];
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
      const path = buildPaginatedUrl("/api/v2/schedules/", page, pageSize, filters);

      const response = await client.request(
        "awx-list-schedules",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch schedules: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedScheduleResponse;
      allSchedules.push(...data.results);

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

  allSchedules.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListSchedulesOutput = {
    count: allSchedules.length,
    results: allSchedules,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
