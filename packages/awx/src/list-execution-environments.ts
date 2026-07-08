/**
 * list-execution-environments.ts — Paginated execution environment listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-execution-environments` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX execution environment (relevant subset of fields) */
export interface ExecutionEnvironment {
  id: number;
  name: string;
  description: string;
  image: string;
  managed: boolean;
  organization: number | null;
  summary_fields: Record<string, unknown>;
  created: string;
  modified: string;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/execution_environments/ */
export interface PaginatedExecutionEnvironmentResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: ExecutionEnvironment[];
}

/** Structured output of the list-execution-environments tool */
export interface ListExecutionEnvironmentsOutput {
  count: number;
  results: ExecutionEnvironment[];
  warning?: string;
}

/** Options for listExecutionEnvironments */
export interface ListExecutionEnvironmentsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listExecutionEnvironments(
  client: AwxClient,
  options?: ListExecutionEnvironmentsOptions,
): Promise<ListExecutionEnvironmentsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allEEs: ExecutionEnvironment[] = [];
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
      const path = buildPaginatedUrl("/api/v2/execution_environments/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-execution-environments",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch execution environments: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedExecutionEnvironmentResponse;
      allEEs.push(...data.results);

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

  allEEs.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListExecutionEnvironmentsOutput = {
    count: allEEs.length,
    results: allEEs,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
