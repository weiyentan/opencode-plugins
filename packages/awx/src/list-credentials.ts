/**
 * list-credentials.ts — Paginated credential listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-credentials` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX credential (relevant subset of fields) */
export interface Credential {
  id: number;
  name: string;
  type: string;
  url: string;
  description: string;
  credential_type: number;
  summary_fields?: {
    credential_type?: { id?: number; name?: string; kind?: string };
    organization?: { id?: number; name?: string };
  };
  created: string;
  modified: string;
  organization: number | null;
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/credentials/ */
export interface PaginatedCredentialResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Credential[];
}

/** Structured output of the list-credentials tool */
export interface ListCredentialsOutput {
  count: number;
  results: Credential[];
  warning?: string;
}

/** Options for listCredentials */
export interface ListCredentialsOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listCredentials(
  client: AwxClient,
  options?: ListCredentialsOptions,
): Promise<ListCredentialsOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allCreds: Credential[] = [];
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
      const path = buildPaginatedUrl("/api/v2/credentials/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-credentials",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch credentials: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedCredentialResponse;
      allCreds.push(...data.results);

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

  allCreds.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListCredentialsOutput = {
    count: allCreds.length,
    results: allCreds,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
