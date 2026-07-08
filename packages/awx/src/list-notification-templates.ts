/**
 * list-notification-templates.ts — Paginated notification template listing for the AWX plugin.
 *
 * Handles pagination loop, per-page timeout budget, page cap enforcement,
 * and name sorting for the `awx-list-notification-templates` tool.
 */
import type { AwxClient } from "./client.js";
import { calcPageBudget, buildPaginatedUrl, pageCapWarning } from "./pagination.js";

/* ── Types ──────────────────────────────────────────────────────── */

/** A single AWX notification template (relevant subset of fields) */
export interface NotificationTemplate {
  id: number;
  name: string;
  description: string;
  notification_type: string;
  summary_fields?: {
    organization?: { id?: number; name?: string };
  };
  [key: string]: unknown;
}

/** AWX paginated response shape for /api/v2/notification_templates/ */
export interface PaginatedNotificationTemplateResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: NotificationTemplate[];
}

/** Structured output of the list-notification-templates tool */
export interface ListNotificationTemplatesOutput {
  count: number;
  results: NotificationTemplate[];
  warning?: string;
}

/** Options for listNotificationTemplates */
export interface ListNotificationTemplatesOptions {
  maxPages?: number;
  pageSize?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
  /** Server-side filter strings (e.g., "name__icontains=foo") */
  filters?: string[];
}

/* ── Pagination logic ───────────────────────────────────────────── */

export async function listNotificationTemplates(
  client: AwxClient,
  options?: ListNotificationTemplatesOptions,
): Promise<ListNotificationTemplatesOutput> {
  const maxPages = options?.maxPages ?? 5;
  const pageSize = options?.pageSize ?? 50;
  const totalTimeout = options?.timeout ?? 30_000;
  const toolAbortSignal = options?.abortSignal;
  const pageBudget = calcPageBudget(totalTimeout, maxPages);

  const allNt: NotificationTemplate[] = [];
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
      const path = buildPaginatedUrl("/api/v2/notification_templates/", page, pageSize, options?.filters);

      const response = await client.request(
        "awx-list-notification-templates",
        path,
        { headers: { "Content-Type": "application/json" } },
        pageController.signal,
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch notification templates: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as PaginatedNotificationTemplateResponse;
      allNt.push(...data.results);

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

  allNt.sort((a, b) => a.name.localeCompare(b.name));

  const output: ListNotificationTemplatesOutput = {
    count: allNt.length,
    results: allNt,
  };

  if (page > maxPages && hasMore) {
    output.warning = pageCapWarning();
  }

  return output;
}
