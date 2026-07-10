/**
 * list-templates-by-credential.ts — Reverse-lookup templates by credential.
 *
 * Fetches job templates associated with a given credential from the AWX
 * /api/v2/job_templates/?credentials__id={credentialId} endpoint, iterating
 * through pages up to a configurable cap, sorting results by name, and
 * enforcing a per-page timeout budget.
 *
 * Reuses the TemplateResult type from list-templates.ts and shares
 * pagination helpers from pagination.ts.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, pageCapWarning } from "./pagination.js";
import type { TemplateResult } from "./list-templates.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** AWX paginated response shape for /api/v2/job_templates/?credentials__id= */
interface AwxTemplateResponseItem {
  id: number;
  name: string;
  description: string;
  job_type?: string;
  playbook?: string;
  status?: string;
  summary_fields?: {
    project?: { id?: number; name?: string };
    inventory?: { id?: number; name?: string };
  };
  [key: string]: unknown;
}

/** Structured output of list-templates-by-credential */
export interface ListTemplatesByCredentialOutput {
  count: number;
  results: TemplateResult[];
  warning?: string;
}

/** Options for listTemplatesByCredential */
export interface ListTemplatesByCredentialOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Helpers ─────────────────────────────────────────────────────── */

function mapTemplate(item: AwxTemplateResponseItem): TemplateResult {
  const sf = item.summary_fields ?? {};
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    job_type: item.job_type ?? "",
    playbook: item.playbook ?? "",
    status: item.status ?? "",
    project_name: (sf.project as { name?: string } | undefined)?.name ?? "",
    inventory_name: (sf.inventory as { name?: string } | undefined)?.name ?? "",
  };
}

/* ── Core Logic ──────────────────────────────────────────────────── */

/**
 * List AWX job templates associated with a given credential.
 *
 * Fetches templates from `/api/v2/job_templates/?credentials__id={credentialId}`,
 * iterating through pages up to the configured `maxPages` cap. Each page
 * request gets a timeout budget of `timeout / (maxPages + 1)`.
 *
 * Results are sorted by name (alphanumeric, case-insensitive) before returning.
 *
 * @param client        The AWX HTTP client
 * @param credentialId  The credential ID to look up templates for
 * @param options       Optional: pageSize, maxPages, timeout, abortSignal, filters
 * @returns Consolidated, sorted template list with count and optional warning
 */
export async function listTemplatesByCredential(
  client: AwxClient,
  credentialId: number,
  options?: ListTemplatesByCredentialOptions,
): Promise<ListTemplatesByCredentialOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allResults: TemplateResult[] = [];
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
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      params.set("credentials__id", String(credentialId));
      if (options?.filters) {
        for (const f of options.filters) {
          const eqIdx = f.indexOf("=");
          if (eqIdx > 0) {
            params.set(f.slice(0, eqIdx), f.slice(eqIdx + 1));
          }
        }
      }
      const path = `/api/v2/job_templates/?${params.toString()}`;

      const response = await client.request(
        "awx-list-templates-by-credential",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          throw new Error(`Not authorized to access credential ${credentialId}. Check your Personal Access Token permissions.`);
        }
        throw new Error(`AWX API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { count: number; next: string | null; previous: string | null; results: AwxTemplateResponseItem[] };
      allResults.push(...data.results.map(mapTemplate));

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

  // Sort consolidated results by name (alphanumeric, case-insensitive)
  allResults.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListTemplatesByCredentialOutput = {
    count: allResults.length,
    results: allResults,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
