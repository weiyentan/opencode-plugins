/**
 * list-teams.ts — Paginated team listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-teams` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX team (relevant subset of fields) */
export interface Team {
  id: number;
  name: string;
  description: string;
  summary_fields?: {
    organization?: { id?: number; name?: string };
    user_count?: number;
  };
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/teams/ */
export interface PaginatedTeamResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Team[];
}

/** Structured output of the list-teams tool */
export interface ListTeamsOutput {
  count: number;
  results: Team[];
  warning?: string;
}

/** Options for listTeams */
export interface ListTeamsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listTeams(
  client: AwxClient,
  options?: ListTeamsOptions,
): Promise<ListTeamsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allTeams: Team[] = [];
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
      const path = buildPaginatedUrl("/api/v2/teams/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-teams",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch teams: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedTeamResponse;
      allTeams.push(...data.results);

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

  allTeams.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListTeamsOutput = {
    count: allTeams.length,
    results: allTeams,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
