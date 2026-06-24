/**
 * list-jobs.ts — AWX job listing with pagination consolidation
 *
 * Fetches jobs from the AWX /api/v2/jobs/ endpoint,
 * iterates through pages up to a configurable cap, sorts results by
 * `created` descending (newest first), and enforces a per-page timeout
 * budget. Uses next-link pagination (like list-templates.ts).
 *
 * ## Timeout Budget
 *
 * Per-page timeout = toolTimeoutMs / (maxPages + 1).
 * This ensures that even if every page times out sequentially, we never
 * exceed the tool-level timeout (the +1 accounts for the tool overhead).
 *
 * ## Page Cap
 *
 * When maxPages > 0 and the cap is reached with more pages available,
 * the output includes a warning field. The caller can detect truncation
 * by checking for the presence of `warning`.
 */
import type { AwxClient } from "./client.js";

// ── Types ─────────────────────────────────────────────────────────

/** A simplified job result returned to the caller */
export interface JobResult {
  id: number;
  name: string;
  job_type: string;
  status: string;
  created: string;
  started: string | null;
  finished: string | null;
  launched_by: string | null;
  job_template_id: number | null;
  job_template_name: string | null;
}

/** Output of the list-jobs operation */
export interface ListJobsOutput {
  schema_version: string;
  total_jobs: number;
  results: JobResult[];
  pages_fetched: number;
  warning?: string;
}

/** Options for listJobs */
export interface ListJobsOptions {
  /** Number of items per page (default: 50) */
  pageSize?: number;
  /**
   * Maximum pages to fetch.
   * 0 = no cap (fetch all pages).
   * Default: 5 (5 pages × 50 items = 250 max).
   */
  maxPages?: number;
  /**
   * Optional filter strings for server-side filtering.
   * Each string should be in the format "field__operator=value"
   * (e.g., "name__icontains=workspace"). These are passed as
   * query parameters to the AWX API.
   */
  filters?: string[];
}

// ── Internal AWX API types ───────────────────────────────────────

interface AwxPageResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

interface AwxJobItem {
  id: number;
  name?: string;
  job_type?: string;
  type?: string;
  status?: string;
  created?: string;
  started?: string | null;
  finished?: string | null;
  summary_fields?: {
    unified_job_template?: {
      id: number;
      name: string;
      description?: string;
    };
    created_by?: {
      id: number;
      username: string;
    };
    job_template?: {
      id: number;
      name: string;
    };
  };
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Combine multiple AbortSignals into one — aborts if ANY source aborts.
 * Uses native AbortSignal.any() on Node 20+, falls back to manual wiring.
 */
function anyAbortSignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return controller.signal;
    }
    signal.addEventListener("abort", () => {
      controller.abort(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }
  return controller.signal;
}

/**
 * Create an AbortSignal that fires after `ms` milliseconds.
 * Uses setTimeout + AbortController for Node 18+ compatibility.
 */
function createTimeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Page timeout.", "TimeoutError")),
    ms,
  );
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/**
 * Extract path + query string from a full AWX API URL.
 * AWX pagination returns absolute URLs in `next` — we need just the path.
 */
function extractPath(fullUrl: string): string {
  try {
    const url = new URL(fullUrl);
    return url.pathname + (url.search || "");
  } catch {
    // If it's already just a path, return as-is
    return fullUrl;
  }
}

/** Map a raw AWX job item to the simplified result shape */
function mapJob(item: AwxJobItem): JobResult {
  const ujt = item.summary_fields?.unified_job_template;
  const cb = item.summary_fields?.created_by;
  return {
    id: item.id,
    name: ujt?.name ?? item.name ?? "",
    job_type: item.job_type ?? item.type ?? "",
    status: item.status ?? "",
    created: item.created ?? "",
    started: item.started ?? null,
    finished: item.finished ?? null,
    launched_by: cb?.username ?? null,
    job_template_id: ujt?.id ?? null,
    job_template_name: ujt?.name ?? null,
  };
}

/**
 * Build the request URL with page size, server-side sort (`created`
 * descending), and optional server-side filters.
 * Filter strings are split on the first `=` to form query parameters.
 */
function buildJobsUrl(pageSize: number, filters?: string[]): string {
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  params.set("order_by", "-created");
  if (filters) {
    for (const f of filters) {
      const eqIdx = f.indexOf("=");
      if (eqIdx > 0) {
        params.set(f.slice(0, eqIdx), f.slice(eqIdx + 1));
      }
    }
  }
  return `/api/v2/jobs/?${params.toString()}`;
}

// ── Core Logic ────────────────────────────────────────────────────

/**
 * List AWX jobs with pagination consolidation.
 *
 * Fetches jobs from `/api/v2/jobs/`, iterating through pages up to the
 * configured `maxPages` cap. Each page request gets a timeout budget of
 * `toolTimeoutMs / (maxPages + 1)`.
 *
 * Results are sorted by `created` descending (newest first) both via
 * server-side `order_by=-created` and client-side fallback sort.
 *
 * @param client        The AWX HTTP client
 * @param toolTimeoutMs Tool-level timeout in ms (used for per-page budget)
 * @param options       Optional: pageSize, maxPages, filters
 * @param abortSignal   Optional tool context abort signal for cancellation
 * @returns Consolidated, sorted job list with metadata and optional warning
 */
export async function listJobs(
  client: AwxClient,
  toolTimeoutMs: number,
  options?: ListJobsOptions,
  abortSignal?: AbortSignal,
): Promise<ListJobsOutput> {
  const pageSize = options?.pageSize ?? 50;
  const maxPages = options?.maxPages ?? 5;

  // Per-page timeout budget: divide tool timeout by (maxPages + 1).
  // The +1 provides a safety margin for tool overhead after the last page.
  const effectiveMaxPages = Math.max(1, maxPages);
  const perPageBudget = Math.floor((toolTimeoutMs || 30_000) / ((effectiveMaxPages || 5) + 1));

  const allResults: JobResult[] = [];
  let nextPage: string | null = null;
  let pagesFetched = 0;

  do {
    // Check if tool has been aborted before fetching
    if (abortSignal?.aborted) {
      throw abortSignal.reason ?? new DOMException("Aborted", "AbortError");
    }

    pagesFetched++;

    // Build URL for current page (with optional filters on first request)
    const path = nextPage
      ? extractPath(nextPage)
      : buildJobsUrl(pageSize, options?.filters);

    // Fetch this page with per-page timeout
    const { signal: pageSignal, clear: clearTimeout_ } = createTimeoutSignal(Math.max(1, perPageBudget || 1000));
    const combinedSignal = abortSignal
      ? anyAbortSignal([abortSignal, pageSignal])
      : pageSignal;

    try {
      const response = await client.request(
        "awx-list-jobs",
        path,
        undefined,
        combinedSignal,
      );

      if (!response.ok) {
        throw new Error(`AWX API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as AwxPageResponse<AwxJobItem>;

      allResults.push(...data.results.map(mapJob));
      nextPage = data.next;
    } finally {
      clearTimeout_();
    }

    // Stop when no more pages OR we've hit the cap.
    // maxPages <= 0 means "no cap" (fetch all).
  } while (nextPage !== null && (maxPages <= 0 || pagesFetched < maxPages));

  // Client-side fallback sort by created descending (newest first)
  // The server also sorts via order_by=-created, but this ensures
  // correctness when pages are consolidated.
  allResults.sort((a, b) => b.created.localeCompare(a.created));

  const output: ListJobsOutput = {
    schema_version: "1.0",
    total_jobs: allResults.length,
    results: allResults,
    pages_fetched: pagesFetched,
  };

  // If there are more pages but we hit the cap, emit a warning
  if (nextPage !== null && maxPages > 0 && pagesFetched >= maxPages) {
    output.warning = `Page cap of ${maxPages} page${maxPages !== 1 ? "s" : ""} reached. Some results may be omitted.`;
  }

  return output;
}

export default listJobs;
