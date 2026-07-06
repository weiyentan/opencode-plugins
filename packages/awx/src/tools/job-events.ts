import { tool } from "@opencode-ai/plugin";
const z = tool.schema;

import type { AwxClient } from "../client.js";

/**
 * Get Job Events tool — retrieves job events from AWX.
 *
 * Fetches events from `/api/v2/jobs/<job_id>/job_events/` with
 * optional filtering by event type and pagination for jobs with
 * 500+ events.
 *
 * Factory pattern: receives `getAwxClient` as a closure parameter
 * to avoid circular dependencies, same pattern as `createHelloTool`.
 */
export function createGetJobEventsTool(
  getAwxClient: () => Promise<AwxClient>,
) {
  return tool({
    description: [
      "Get job events from an AWX job. Retrieves events from",
      "`/api/v2/jobs/<job_id>/job_events/`. Supports optional",
      "filtering by event type (e.g., `playbook_on_task_start`)",
      "and pagination via the `page` parameter.",
    ].join(" "),
    args: {
      job_id: z
        .number()
        .int()
        .positive()
        .describe("AWX job ID to retrieve events for"),
      event_filter: z
        .string()
        .optional()
        .describe(
          "Optional event type filter (e.g., 'playbook_on_task_start', 'runner_on_ok')",
        ),
      page: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Page number for paginated results"),
    },
    async execute(args, context) {
      // Respect the abort signal
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      let awxClient: AwxClient;
      try {
        awxClient = await getAwxClient();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          output: message,
          metadata: {
            count: 0,
            results: [],
            next_page: null,
            error: message,
          },
        };
      }

      try {
        // Build query parameters
        const params = new URLSearchParams();
        if (args.event_filter) {
          params.set("event", args.event_filter);
        }
        if (args.page) {
          params.set("page", String(args.page));
        }

        const queryString = params.toString();
        const path = `/api/v2/jobs/${args.job_id}/job_events/${queryString ? `?${queryString}` : ""}`;

        const response = await awxClient.request(
          "awx-get-job-events",
          path,
          undefined,
          context.abort,
        );

        if (!response.ok) {
          return {
            output: `AWX API returned status ${response.status}: ${response.statusText}`,
            metadata: {
              count: 0,
              results: [],
              next_page: null,
              error: `AWX API returned status ${response.status}: ${response.statusText}`,
            },
          };
        }

        const data = (await response.json()) as {
          count?: number;
          next?: string | null;
          results?: unknown[];
        };

        // Extract next_page from the `next` URL if present
        let nextPage: number | null = null;
        if (data.next) {
          try {
            const nextUrl = new URL(data.next);
            const pageParam = nextUrl.searchParams.get("page");
            if (pageParam) {
              nextPage = Number.parseInt(pageParam, 10);
            }
          } catch {
            // Handle relative URLs (e.g., /api/v2/jobs/42/job_events/?page=2)
            const qs = data.next.includes("?") ? data.next.split("?")[1] ?? "" : "";
            const pageParam = new URLSearchParams(qs).get("page");
            if (pageParam) {
              nextPage = Number.parseInt(pageParam, 10);
            }
          }
        }

        return {
          output: `Found ${data.count ?? 0} event(s).`,
          metadata: {
            count: data.count ?? 0,
            results: data.results ?? [],
            next_page: nextPage,
          },
        };
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Unknown error fetching job events";
        return {
          output: `Failed to get job events: ${message}`,
          metadata: {
            count: 0,
            results: [],
            next_page: null,
            error: message,
          },
        };
      }
    },
  });
}
