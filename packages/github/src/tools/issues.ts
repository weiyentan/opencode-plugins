/**
 * issues.ts — REST-based issue tools for the GitHub plugin.
 *
 * Provides 5 REST-powered issue tools:
 *   - github_issue_list   — list issues for a repo
 *   - github_issue_get    — get a single issue
 *   - github_issue_create — create an issue
 *   - github_issue_update — update an issue
 *   - github_issue_comment — comment on an issue
 *
 * ## Design
 *
 * Each tool:
 *   1. Validates inputs with Zod schemas
 *   2. Calls the GitHub REST API through the client middleware pipeline
 *   3. Extracts curated fields from the raw response
 *   4. Returns structured output with _raw in metadata
 *   5. List tools format results as Markdown tables
 *
 * Error handling:
 *   - 404 → "not found" user-facing messages
 *   - 422 → validation error messages with API details
 *   - Other errors → generic message with HTTP status
 *
 * ## Reference
 *
 *  - GitHub Issues REST API: https://docs.github.com/en/rest/issues
 *  - Client middleware: ../client.ts
 */

import { tool } from "@opencode-ai/plugin";
import type { GitHubClient } from "../client.js";

const z = tool.schema;

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── Curated type shapes ────────────────────────────────────────── */

/** Curated fields extracted from a GitHub REST API issue response */
interface CuratedIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  url: string;
  html_url: string;
  user: { login: string } | null;
  labels: Array<{ name: string; color: string | null }>;
  assignees: Array<{ login: string }>;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request: unknown | null;
}

/** Curated fields extracted from a GitHub REST API comment response */
interface CuratedComment {
  id: number;
  body: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  url: string;
  html_url: string;
}

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * Extract curated issue fields from a raw GitHub API response object.
 */
function curateIssue(raw: any): CuratedIssue {
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    body: raw.body ?? null,
    url: raw.url,
    html_url: raw.html_url,
    user: raw.user ? { login: raw.user.login } : null,
    labels: (raw.labels ?? []).map((l: any) => ({
      name: l.name,
      color: l.color ?? null,
    })),
    assignees: (raw.assignees ?? []).map((a: any) => ({
      login: a.login,
    })),
    comments: raw.comments ?? 0,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    closed_at: raw.closed_at ?? null,
    pull_request: raw.pull_request ?? null,
  };
}

/**
 * Extract curated comment fields from a raw GitHub API response object.
 */
function curateComment(raw: any): CuratedComment {
  return {
    id: raw.id,
    body: raw.body,
    user: raw.user ? { login: raw.user.login } : null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    url: raw.url,
    html_url: raw.html_url,
  };
}

/**
 * Format a list of curated issues as a Markdown table.
 */
function issuesToTable(items: CuratedIssue[]): string {
  if (items.length === 0) return "No issues found.";

  const header = "| # | Title | State | Labels | Assignee | Created |";
  const separator = "|---|---|---|---|---|---|";

  const rows = items.map((item) => {
    const labels =
      item.labels.length > 0
        ? item.labels.map((l) => l.name).join(", ")
        : "";
    const assignee =
      item.assignees.length > 0 ? item.assignees[0]!.login : "";
    const created = item.created_at.slice(0, 10);
    const title = item.title.replace(/\|/g, "\\|");
    return `| ${item.number} | ${title} | ${item.state} | ${labels} | ${assignee} | ${created} |`;
  });

  return [header, separator, ...rows].join("\n");
}

/**
 * Parse a non-OK response body for a user-facing error message.
 *
 * Handles the standard GitHub error response shape:
 * ```json
 * { "message": "...", "errors": [{ "message": "..." }] }
 * ```
 */
async function parseError(response: Response): Promise<string> {
  try {
    const body: any = await response.json();
    if (body.message) return body.message;
    if (body.errors && Array.isArray(body.errors)) {
      return body.errors
        .map((e: any) => e.message ?? JSON.stringify(e))
        .join("; ");
    }
    return `GitHub API error (HTTP ${response.status})`;
  } catch {
    return `GitHub API error (HTTP ${response.status})`;
  }
}

/**
 * Build a query string from a record of parameters, omitting undefined values.
 */
function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    }
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/* ── Tool Factory ───────────────────────────────────────────────── */

/**
 * Create the five REST-based issue tools.
 *
 * @param getClient  Async factory that returns the GitHub HTTP client
 * @returns A record of tool name → registered tool object
 */
export function createIssueTools(
  getClient: () => Promise<GitHubClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── github_issue_list ────────────────────────────────────── */

    "github_issue_list": tool({
      description: [
        "List issues for a GitHub repository.",
        "Supports filtering by state, labels, assignee, and sorting.",
        "Note: This endpoint also returns pull requests (check the pull_request field",
        "in the response to distinguish them).",
        "Results are formatted as a Markdown table.",
      ].join(" "),
      args: {
        owner: z
          .string()
          .min(1)
          .describe("Repository owner (user or organization)."),
        repo: z
          .string()
          .min(1)
          .describe("Repository name."),
        state: z
          .enum(["open", "closed", "all"])
          .optional()
          .default("open")
          .describe("Issue state to filter by."),
        labels: z
          .string()
          .optional()
          .describe("Comma-separated list of label names to filter by."),
        assignee: z
          .string()
          .optional()
          .describe(
            "Username to filter by assigned user. Use 'none' for issues with no assigned user.",
          ),
        sort: z
          .enum(["created", "updated", "comments"])
          .optional()
          .default("created")
          .describe("Sort field."),
        direction: z
          .enum(["asc", "desc"])
          .optional()
          .default("desc")
          .describe("Sort direction."),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(30)
          .describe("Results per page (max 100)."),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe("Page number."),
      },
      async execute(
        args: {
          owner: string;
          repo: string;
          state?: string;
          labels?: string;
          assignee?: string;
          sort?: string;
          direction?: string;
          per_page?: number;
          page?: number;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitHubClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const query = buildQueryString({
          state: args.state,
          labels: args.labels,
          assignee: args.assignee,
          sort: args.sort,
          direction: args.direction,
          per_page: args.per_page,
          page: args.page,
        });
        const path = `/repos/${args.owner}/${args.repo}/issues${query}`;

        let response: Response;
        try {
          response = await client.request(
            "github_issue_list",
            path,
            undefined,
            context.abort,
          );
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        if (!response.ok) {
          if (response.status === 404) {
            return {
              output: `Repository "${args.owner}/${args.repo}" not found. Verify the owner and repository name.`,
            };
          }
          const msg = await parseError(response);
          return { output: `Error listing issues: ${msg}` };
        }

        let data: any[];
        try {
          data = (await response.json()) as any[];
        } catch {
          return { output: "Failed to parse response from GitHub API." };
        }

        if (!Array.isArray(data)) {
          return { output: "Unexpected response format from GitHub API." };
        }

        const items = data.map(curateIssue);
        const table = issuesToTable(items);

        return {
          output: table,
          metadata: {
            count: items.length,
            items,
            page: args.page ?? 1,
            per_page: args.per_page ?? 30,
            _raw: data,
          },
        };
      },
    }),

    /* ── github_issue_get ──────────────────────────────────────── */

    "github_issue_get": tool({
      description: [
        "Get a single GitHub issue by number.",
        "Returns curated issue fields with full _raw response in metadata.",
      ].join(" "),
      args: {
        owner: z
          .string()
          .min(1)
          .describe("Repository owner (user or organization)."),
        repo: z
          .string()
          .min(1)
          .describe("Repository name."),
        issueNumber: z
          .number()
          .int()
          .positive()
          .describe("Issue number."),
      },
      async execute(
        args: { owner: string; repo: string; issueNumber: number },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitHubClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const path = `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}`;

        let response: Response;
        try {
          response = await client.request(
            "github_issue_get",
            path,
            undefined,
            context.abort,
          );
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        if (!response.ok) {
          if (response.status === 404) {
            return {
              output: `Issue #${args.issueNumber} not found in ${args.owner}/${args.repo}. Verify the issue number and repository name.`,
            };
          }
          const msg = await parseError(response);
          return { output: `Error fetching issue: ${msg}` };
        }

        let data: any;
        try {
          data = await response.json();
        } catch {
          return { output: "Failed to parse response from GitHub API." };
        }

        const issue = curateIssue(data);
        const labelStr =
          issue.labels.length > 0
            ? issue.labels.map((l) => l.name).join(", ")
            : "(none)";
        const assigneeStr =
          issue.assignees.length > 0
            ? issue.assignees.map((a) => a.login).join(", ")
            : "(none)";

        const bodyStr = issue.body ?? "(none)";

        return {
          output: [
            `Issue #${issue.number}: ${issue.title}`,
            `  State:     ${issue.state}`,
            `  Author:    ${issue.user?.login ?? "unknown"}`,
            `  Labels:    ${labelStr}`,
            `  Assignees: ${assigneeStr}`,
            `  Body:      ${bodyStr}`,
            `  Comments:  ${issue.comments}`,
            `  Created:   ${issue.created_at}`,
            `  Updated:   ${issue.updated_at}`,
            `  URL:       ${issue.html_url}`,
          ].join("\n"),
          metadata: {
            issue,
            _raw: data,
          },
        };
      },
    }),

    /* ── github_issue_create ───────────────────────────────────── */

    "github_issue_create": tool({
      description: [
        "Create a new issue in a GitHub repository.",
        "Supports setting title, body, labels, and assignees.",
        "Returns the created issue with curated fields and full _raw response.",
      ].join(" "),
      args: {
        owner: z
          .string()
          .min(1)
          .describe("Repository owner (user or organization)."),
        repo: z
          .string()
          .min(1)
          .describe("Repository name."),
        title: z
          .string()
          .min(1)
          .describe("Issue title."),
        body: z
          .string()
          .optional()
          .describe("Issue body text (Markdown supported)."),
        labels: z
          .array(z.string())
          .optional()
          .describe("Array of label names to apply to the issue."),
        assignees: z
          .array(z.string())
          .optional()
          .describe("Array of usernames to assign to the issue."),
      },
      async execute(
        args: {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          labels?: string[];
          assignees?: string[];
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitHubClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const path = `/repos/${args.owner}/${args.repo}/issues`;
        const requestBody: Record<string, unknown> = { title: args.title };
        if (args.body !== undefined) requestBody.body = args.body;
        if (args.labels !== undefined) requestBody.labels = args.labels;
        if (args.assignees !== undefined)
          requestBody.assignees = args.assignees;

        let response: Response;
        try {
          response = await client.request(
            "github_issue_create",
            path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestBody),
            },
            context.abort,
          );
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        if (!response.ok) {
          if (response.status === 404) {
            return {
              output: `Repository "${args.owner}/${args.repo}" not found.`,
            };
          }
          if (response.status === 422) {
            const msg = await parseError(response);
            return { output: `Validation error creating issue: ${msg}` };
          }
          const msg = await parseError(response);
          return { output: `Error creating issue: ${msg}` };
        }

        let data: any;
        try {
          data = await response.json();
        } catch {
          return { output: "Failed to parse response from GitHub API." };
        }

        const issue = curateIssue(data);
        const labelStr =
          issue.labels.length > 0
            ? issue.labels.map((l) => l.name).join(", ")
            : "(none)";

        return {
          output: [
            `Created issue #${issue.number}: ${issue.title}`,
            `  URL:    ${issue.html_url}`,
            `  State:  ${issue.state}`,
            `  Labels: ${labelStr}`,
          ].join("\n"),
          metadata: {
            issue,
            _raw: data,
          },
        };
      },
    }),

    /* ── github_issue_update ───────────────────────────────────── */

    "github_issue_update": tool({
      description: [
        "Update an existing GitHub issue.",
        "Supports changing state, title, body, labels, and assignees.",
        "Only provided fields are updated (partial update via PATCH).",
        "Returns the updated issue with curated fields.",
      ].join(" "),
      args: {
        owner: z
          .string()
          .min(1)
          .describe("Repository owner (user or organization)."),
        repo: z
          .string()
          .min(1)
          .describe("Repository name."),
        issueNumber: z
          .number()
          .int()
          .positive()
          .describe("Issue number to update."),
        state: z
          .enum(["open", "closed"])
          .optional()
          .describe("New state (open or closed)."),
        title: z
          .string()
          .optional()
          .describe("New title."),
        body: z
          .string()
          .optional()
          .describe("New body text (Markdown supported)."),
        labels: z
          .array(z.string())
          .optional()
          .describe("Replacement labels array (replaces all existing labels)."),
        assignees: z
          .array(z.string())
          .optional()
          .describe(
            "Replacement assignees array (replaces all existing assignees).",
          ),
      },
      async execute(
        args: {
          owner: string;
          repo: string;
          issueNumber: number;
          state?: string;
          title?: string;
          body?: string;
          labels?: string[];
          assignees?: string[];
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitHubClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const path = `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}`;
        const patchBody: Record<string, unknown> = {};
        if (args.state !== undefined) patchBody.state = args.state;
        if (args.title !== undefined) patchBody.title = args.title;
        if (args.body !== undefined) patchBody.body = args.body;
        if (args.labels !== undefined) patchBody.labels = args.labels;
        if (args.assignees !== undefined)
          patchBody.assignees = args.assignees;

        let response: Response;
        try {
          response = await client.request(
            "github_issue_update",
            path,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(patchBody),
            },
            context.abort,
          );
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        if (!response.ok) {
          if (response.status === 404) {
            return {
              output: `Issue #${args.issueNumber} not found in ${args.owner}/${args.repo}.`,
            };
          }
          if (response.status === 422) {
            const msg = await parseError(response);
            return { output: `Validation error updating issue: ${msg}` };
          }
          const msg = await parseError(response);
          return { output: `Error updating issue: ${msg}` };
        }

        let data: any;
        try {
          data = await response.json();
        } catch {
          return { output: "Failed to parse response from GitHub API." };
        }

        const issue = curateIssue(data);

        return {
          output: [
            `Updated issue #${issue.number}: ${issue.title}`,
            `  State: ${issue.state}`,
            `  URL:   ${issue.html_url}`,
          ].join("\n"),
          metadata: {
            issue,
            _raw: data,
          },
        };
      },
    }),

    /* ── github_issue_comment ──────────────────────────────────── */

    "github_issue_comment": tool({
      description: [
        "Add a comment to an existing GitHub issue.",
        "Returns the created comment with curated fields.",
      ].join(" "),
      args: {
        owner: z
          .string()
          .min(1)
          .describe("Repository owner (user or organization)."),
        repo: z
          .string()
          .min(1)
          .describe("Repository name."),
        issueNumber: z
          .number()
          .int()
          .positive()
          .describe("Issue number to comment on."),
        body: z
          .string()
          .min(1)
          .describe("Comment body text (Markdown supported)."),
      },
      async execute(
        args: {
          owner: string;
          repo: string;
          issueNumber: number;
          body: string;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitHubClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const path = `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments`;

        let response: Response;
        try {
          response = await client.request(
            "github_issue_comment",
            path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body: args.body }),
            },
            context.abort,
          );
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        if (!response.ok) {
          if (response.status === 404) {
            return {
              output: `Issue #${args.issueNumber} not found in ${args.owner}/${args.repo}.`,
            };
          }
          if (response.status === 422) {
            const msg = await parseError(response);
            return {
              output: `Validation error adding comment: ${msg}`,
            };
          }
          const msg = await parseError(response);
          return { output: `Error adding comment: ${msg}` };
        }

        let data: any;
        try {
          data = await response.json();
        } catch {
          return { output: "Failed to parse response from GitHub API." };
        }

        const comment = curateComment(data);

        return {
          output: [
            `Comment added to issue #${args.issueNumber}`,
            `  By:  ${comment.user?.login ?? "unknown"}`,
            `  URL: ${comment.html_url}`,
          ].join("\n"),
          metadata: {
            comment,
            issueNumber: args.issueNumber,
            _raw: data,
          },
        };
      },
    }),
  };
}
