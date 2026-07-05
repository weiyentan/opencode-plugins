/**
 * list-templates.ts — AWX job template listing with pagination consolidation
 *
 * Fetches job templates from the AWX /api/v2/job_templates/ endpoint,
 * iterates through pages up to a configurable cap, sorts results by name,
 * and enforces a per-page timeout budget.
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

/** A simplified template result returned to the caller */
export interface TemplateResult {
  id: number;
  name: string;
  description: string;
  job_type: string;
  playbook: string;
  status: string;
  project_name: string;
  inventory_name: string;
}

/** Output of the list-templates operation */
export interface ListTemplatesOutput {
  count: number;
  results: TemplateResult[];
  warning?: string;
}

/** Options for listTemplates */
export interface ListTemplatesOptions {
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

interface AwxTemplateItem {
  id: number;
  name: string;
  description: string;
  job_type?: string;
  playbook?: string;
  status?: string;
  last_job_failed?: boolean;
  last_job_run?: string;
  summary_fields?: {
    project?: { id?: number; name?: string };
    inventory?: { id?: number; name?: string };
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

/** Map a raw AWX template item to the simplified result shape */
function mapTemplate(item: AwxTemplateItem): TemplateResult {
  const sf = item.summary_fields ?? {};
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    job_type: item.job_type ?? "",
    playbook: item.playbook ?? "",
    status: item.status ?? (item.last_job_failed ? "failed" : item.last_job_run ? "successful" : ""),
    project_name: (sf.project as { name?: string } | undefined)?.name ?? "",
    inventory_name: (sf.inventory as { name?: string } | undefined)?.name ?? "",
  };
}

/**
 * Build the request URL with page size and optional server-side filters.
 * Filter strings are split on the first `=` to form query parameters.
 */
function buildTemplatesUrl(pageSize: number, filters?: string[]): string {
  const params = new URLSearchParams();
  params.set("page_size", String(pageSize));
  if (filters) {
    for (const f of filters) {
      const eqIdx = f.indexOf("=");
      if (eqIdx > 0) {
        params.set(f.slice(0, eqIdx), f.slice(eqIdx + 1));
      }
    }
  }
  return `/api/v2/job_templates/?${params.toString()}`;
}

// ── Core Logic ────────────────────────────────────────────────────

/**
 * List AWX job templates with pagination consolidation.
 *
 * Fetches templates from `/api/v2/job_templates/`, iterating through
 * pages up to the configured `maxPages` cap. Each page request gets a
 * timeout budget of `toolTimeoutMs / (maxPages + 1)`.
 *
 * Results are sorted by name (alphanumeric, case-insensitive) before returning.
 *
 * @param client        The AWX HTTP client
 * @param toolTimeoutMs Tool-level timeout in ms (used for per-page budget)
 * @param options       Optional: pageSize, maxPages, filters
 * @param abortSignal   Optional tool context abort signal for cancellation
 * @returns Consolidated, sorted template list with count and optional warning
 */
export async function listTemplates(
  client: AwxClient,
  toolTimeoutMs: number,
  options?: ListTemplatesOptions,
  abortSignal?: AbortSignal,
): Promise<ListTemplatesOutput> {
  const pageSize = options?.pageSize ?? 50;
  const maxPages = options?.maxPages ?? 5;

  // Per-page timeout budget: divide tool timeout by (maxPages + 1).
  // The +1 provides a safety margin for tool overhead after the last page.
  const effectiveMaxPages = Math.max(1, maxPages);
  const perPageBudget = Math.floor((toolTimeoutMs || 30_000) / ((effectiveMaxPages || 5) + 1));

  const allResults: TemplateResult[] = [];
  let nextPage: string | null = null;
  let pagesFetched = 0;

  do {
    pagesFetched++;

    // Build URL for current page (with optional filters on first request)
    const path = nextPage
      ? extractPath(nextPage)
      : buildTemplatesUrl(pageSize, options?.filters);

    // Fetch this page with per-page timeout
    const { signal: pageSignal, clear: clearTimeout_ } = createTimeoutSignal(Math.max(1, perPageBudget || 1000));
    const combinedSignal = abortSignal
      ? anyAbortSignal([abortSignal, pageSignal])
      : pageSignal;

    try {
      const response = await client.request(
        "awx-list-templates",
        path,
        undefined,
        combinedSignal,
      );

      if (!response.ok) {
        throw new Error(`AWX API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as AwxPageResponse<AwxTemplateItem>;

      allResults.push(...data.results.map(mapTemplate));
      nextPage = data.next;
    } finally {
      clearTimeout_();
    }

    // Stop when no more pages OR we've hit the cap.
    // maxPages <= 0 means "no cap" (fetch all).
  } while (nextPage !== null && (maxPages <= 0 || pagesFetched < maxPages));

  // Sort consolidated results by name (alphanumeric, case-insensitive)
  allResults.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListTemplatesOutput = {
    count: allResults.length,
    results: allResults,
  };

  // If there are more pages but we hit the cap, emit a warning
  if (nextPage !== null && maxPages > 0 && pagesFetched >= maxPages) {
    output.warning = `Page cap of ${maxPages} page${maxPages !== 1 ? "s" : ""} reached. Some results may be omitted.`;
  }

  return output;
}
