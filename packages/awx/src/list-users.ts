/**
 * list-users.ts — Paginated user listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and username sorting for the `awx-list-users` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX user (relevant subset of fields) */
export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_superuser: boolean;
  is_system_auditor: boolean;
  summary_fields?: {
    user_capabilities?: Record<string, unknown>;
    organizations?: { id?: number; name?: string }[];
  };
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/users/ */
export interface PaginatedUserResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: User[];
}

/** Structured output of the list-users tool */
export interface ListUsersOutput {
  count: number;
  results: User[];
  warning?: string;
}

/** Options for listUsers */
export interface ListUsersOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "username__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listUsers(
  client: AwxClient,
  options?: ListUsersOptions,
): Promise<ListUsersOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allUsers: User[] = [];
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
      const path = buildPaginatedUrl("/api/v2/users/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-users",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedUserResponse;
      allUsers.push(...data.results);

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

  allUsers.sort((a, b) => a.username.localeCompare(b.username));

  const output: ListUsersOutput = {
    count: allUsers.length,
    results: allUsers,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
