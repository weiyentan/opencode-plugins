/**
 * list-workflow-templates.ts — Paginated workflow job template listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-workflow-templates` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX workflow job template (relevant subset of fields) */
export interface WorkflowTemplate {
  id: number;
  name: string;
  description: string;
  url: string;
  related: Record<string, string>;
  summary_fields: {
    organization?: {
      id: number;
      name: string;
      description?: string;
    };
  };
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/workflow_job_templates/ */
export interface PaginatedWorkflowTemplateResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: WorkflowTemplate[];
}

/** Structured output of the list-workflow-templates tool */
export interface ListWorkflowTemplatesOutput {
  count: number;
  results: WorkflowTemplate[];
  warning?: string;
}

/** Options for listWorkflowTemplates */
export interface ListWorkflowTemplatesOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listWorkflowTemplates(
  client: AwxClient,
  options?: ListWorkflowTemplatesOptions,
): Promise<ListWorkflowTemplatesOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allTemplates: WorkflowTemplate[] = [];
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
      const path = buildPaginatedUrl("/api/v2/workflow_job_templates/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-workflow-templates",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch workflow job templates: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedWorkflowTemplateResponse;
      allTemplates.push(...data.results);

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

  allTemplates.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListWorkflowTemplatesOutput = {
    count: allTemplates.length,
    results: allTemplates,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
