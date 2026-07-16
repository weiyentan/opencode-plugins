/**
 * issues.ts — REST-based issue tools for the GitLab plugin.
 *
 * Provides tools for listing, getting, creating, and updating issues,
 * as well as adding comments (notes) to issues. All tools target the
 * GitLab REST API under `/api/v4/projects/:id/issues`.
 *
 * ## Tools
 *
 * - **gitlab_issue_list** &mdash; List issues for a project (filterable)
 * - **gitlab_issue_get** &mdash; Get a single issue by IID
 * - **gitlab_issue_create** &mdash; Create a new issue
 * - **gitlab_issue_update** &mdash; Update an existing issue (state, title, etc.)
 * - **gitlab_issue_comment** &mdash; Add a note/comment to an issue
 *
 * ## GitLab API Differences from GitHub
 *
 * - Project IDs (int or URL-encoded path) instead of owner/repo
 * - Notes endpoint instead of comments
 * - assignee_ids (array of ints) instead of assignees
 * - State values: "opened"/"closed" (not "open"/"closed")
 * - Issue IID (project-level number) instead of global ID
 *
 * ## Reference
 *
 * - GitLab Issues API: https://docs.gitlab.com/ee/api/issues.html
 * - GitLab Issue Notes API: https://docs.gitlab.com/ee/api/notes.html
 * - GitLab pagination: https://docs.gitlab.com/ee/api/rest/index.html#pagination
 */

import { tool } from "@opencode-ai/plugin";
import type { GitLabClient } from "../client.js";
import { parsePaginationHeaders, hasNextPage } from "../pagination.js";
import { projectPathSegment } from "../project-path.js";

const z = tool.schema;

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ── Response type helpers ───────────────────────────────────────── */

/** Helper: safely extract JSON body from a response */
async function jsonOrThrow(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Helper: build a user-facing error message from a GitLab API error response */
function formatApiError(
  status: number,
  body: any,
  fallbackMessage: string,
): string {
  if (status === 404) {
    return "Resource not found.";
  }
  if (status === 422) {
    const errors = body?.error ?? body?.errors ?? body?.message ?? fallbackMessage;
    const joined = Array.isArray(errors) ? errors.join("; ") : String(errors);
    return `Validation error: ${joined}`;
  }
  const message = body?.error ?? body?.message ?? body?.errors ?? fallbackMessage;
  return `GitLab API error (HTTP ${status}): ${String(message)}`;
}

/** Helper: extract curated issue fields from a GitLab API issue object */
function curateIssue(issue: any): Record<string, any> {
  return {
    iid: issue.iid,
    title: issue.title,
    description: issue.description ?? null,
    state: issue.state,
    url: issue.web_url ?? null,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closedAt: issue.closed_at ?? null,
    author: issue.author?.name ?? issue.author?.username ?? null,
    assignees: (issue.assignees ?? []).map((a: any) => ({
      id: a.id,
      name: a.name,
      username: a.username,
    })),
    labels: issue.labels ?? [],
    milestone: issue.milestone
      ? { id: issue.milestone.id, title: issue.milestone.title }
      : null,
    userNotesCount: issue.user_notes_count ?? 0,
    upvotes: issue.upvotes ?? 0,
    downvotes: issue.downvotes ?? 0,
    dueDate: issue.due_date ?? null,
    confidential: issue.confidential ?? false,
    discussionLocked: issue.discussion_locked ?? false,
    issueType: issue.issue_type ?? "issue",
    taskCompletionStatus: issue.task_completion_status ?? null,
  };
}

/** Helper: format issue summary lines for text output */
function formatIssueSummary(issue: any, prefix: string = ""): string {
  const labelStr =
    Array.isArray(issue.labels) && issue.labels.length > 0
      ? issue.labels.join(", ")
      : "(none)";
  const assigneeStr =
    Array.isArray(issue.assignees) && issue.assignees.length > 0
      ? issue.assignees.map((a: any) => a.username ?? a.name).join(", ")
      : "unassigned";
  const lines = [
    `${prefix}Issue #${issue.iid}: ${issue.title}`,
    `  State:     ${issue.state}`,
    `  Author:    ${issue.author}`,
    `  Assignees: ${assigneeStr}`,
    `  Labels:    ${labelStr}`,
    `  Comments:  ${issue.userNotesCount ?? 0}`,
    `  Created:   ${issue.createdAt}`,
    `  Updated:   ${issue.updatedAt}`,
  ];
  if (issue.url) {
    lines.push(`  URL:       ${issue.url}`);
  }
  return lines.join("\n");
}

/* ── Tool Factory ────────────────────────────────────────────────── */

/**
 * Create the five GitLab issue tools.
 *
 * @param getClient  Async factory that returns the GitLab REST client
 * @returns A record of tool name → registered tool object
 */
export function createIssueTools(
  getClient: () => Promise<GitLabClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── gitlab_issue_list ────────────────────────────────────── */

    "gitlab_issue_list": tool({
      description: [
        "List issues for a GitLab project. Supports filtering by state,",
        "labels, milestone, and search text. Returns paginated results",
        "with curated fields for each issue.",
      ].join(" "),
      args: {
        projectId: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (integer) or URL-encoded path (e.g., 'namespace/project').",
          ),
        state: z
          .enum(["opened", "closed", "all"])
          .optional()
          .default("all")
          .describe("Filter by issue state (opened, closed, or all). Default: all."),
        labels: z
          .string()
          .optional()
          .describe(
            "Comma-separated list of label names to filter by (e.g., 'bug,frontend').",
          ),
        milestone: z
          .string()
          .optional()
          .describe("Milestone title to filter by."),
        search: z
          .string()
          .optional()
          .describe("Search issues against their title and description."),
        page: z
          .number()
          .int()
          .positive()
          .optional()
          .default(1)
          .describe("Page number (default: 1)."),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Items per page (max 100, default: 20)."),
      },
      async execute(
        args: {
          projectId: string | number;
          state?: string;
          labels?: string;
          milestone?: string;
          search?: string;
          page?: number;
          perPage?: number;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const projectParam = projectPathSegment(args.projectId);

        // Build query string
        const searchParams = new URLSearchParams({
          page: String(args.page ?? 1),
          per_page: String(args.perPage ?? 20),
        });

        if (args.state && args.state !== "all") {
          searchParams.set("state", args.state);
        }
        if (args.labels) {
          searchParams.set("labels", args.labels);
        }
        if (args.milestone) {
          searchParams.set("milestone", args.milestone);
        }
        if (args.search) {
          searchParams.set("search", args.search);
        }

        const path = `/api/v4/projects/${projectParam}/issues?${searchParams.toString()}`;

        let response;
        try {
          response = await client.request(
            "gitlab_issue_list",
            path,
            undefined,
            context.abort,
          );
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `GitLab API error: ${message}` };
        }

        const body = await jsonOrThrow(response);

        if (!response.ok) {
          return {
            output: formatApiError(response.status, body, "Failed to list issues."),
            metadata: { _raw: body },
          };
        }

        const issues = Array.isArray(body) ? body : [];
        const pagination = parsePaginationHeaders(response);
        const curatedIssues = issues.map(curateIssue);

        // Build summary
        const totalStr =
          pagination.total !== null ? ` (${pagination.total} total)` : "";
        const summary = [
          `Issues for project ${args.projectId}${totalStr}:`,
          `Showing ${curatedIssues.length} issue(s) on page ${pagination.page ?? 1}${pagination.totalPages !== null ? ` of ${pagination.totalPages}` : ""}`,
          "",
          ...curatedIssues.map((iss: any) => formatIssueSummary(iss)),
        ].join("\n");

        return {
          output: summary,
          metadata: {
            issues: curatedIssues,
            pagination: {
              total: pagination.total,
              totalPages: pagination.totalPages,
              page: pagination.page,
              perPage: pagination.perPage,
              nextPage: pagination.nextPage,
              prevPage: pagination.prevPage,
              hasNext: hasNextPage(pagination),
            },
            _raw: body,
            page: args.page ?? 1,
            perPage: args.perPage ?? 20,
          },
        };
      },
    }),

    /* ── gitlab_issue_get ─────────────────────────────────────── */

    "gitlab_issue_get": tool({
      description: [
        "Get a single GitLab issue by its project-level IID (the number",
        "displayed in the UI, e.g., #42). Returns full issue details",
        "including description, labels, assignees, and milestone.",
      ].join(" "),
      args: {
        projectId: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (integer) or URL-encoded path (e.g., 'namespace/project').",
          ),
        issueIid: z
          .number()
          .int()
          .positive()
          .describe("The project-level issue IID (e.g., 42)."),
      },
      async execute(
        args: { projectId: string | number; issueIid: number },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const projectParam = projectPathSegment(args.projectId);

        const path = `/api/v4/projects/${projectParam}/issues/${args.issueIid}`;

        let response;
        try {
          response = await client.request(
            "gitlab_issue_get",
            path,
            undefined,
            context.abort,
          );
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `GitLab API error: ${message}` };
        }

        const body = await jsonOrThrow(response);

        if (!response.ok) {
          return {
            output: formatApiError(
              response.status,
              body,
              `Issue #${args.issueIid} not found.`,
            ),
            metadata: { _raw: body },
          };
        }

        const curated = curateIssue(body);

        // Format description with truncation
        const desc = curated.description
          ? curated.description.length > 500
            ? curated.description.slice(0, 500) + "..."
            : curated.description
          : "(no description)";

        const labelStr =
          Array.isArray(curated.labels) && curated.labels.length > 0
            ? curated.labels.join(", ")
            : "(none)";

        const assigneeStr =
          Array.isArray(curated.assignees) && curated.assignees.length > 0
            ? curated.assignees.map((a: any) => a.username ?? a.name).join(", ")
            : "unassigned";

        const output = [
          `Issue #${curated.iid}: ${curated.title}`,
          `  State:       ${curated.state}`,
          `  Author:      ${curated.author}`,
          `  Assignees:   ${assigneeStr}`,
          `  Labels:      ${labelStr}`,
          `  Milestone:   ${curated.milestone?.title ?? "(none)"}`,
          `  Comments:    ${curated.userNotesCount}`,
          `  Votes:       +${curated.upvotes}/-${curated.downvotes}`,
          `  Confidential: ${curated.confidential}`,
          `  Type:        ${curated.issueType}`,
          `  Created:     ${curated.createdAt}`,
          `  Updated:     ${curated.updatedAt}`,
          `  Closed:      ${curated.closedAt ?? "N/A"}`,
          `  Due:         ${curated.dueDate ?? "N/A"}`,
          `  URL:         ${curated.url}`,
          "",
          "Description:",
          desc,
        ].join("\n");

        return {
          output,
          metadata: {
            ...curated,
            _raw: body,
          },
        };
      },
    }),

    /* ── gitlab_issue_create ──────────────────────────────────── */

    "gitlab_issue_create": tool({
      description: [
        "Create a new issue in a GitLab project. At minimum, a title is",
        "required. Optionally set description, labels, milestone, and",
        "assignees. Returns the created issue with full details.",
      ].join(" "),
      args: {
        projectId: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (integer) or URL-encoded path (e.g., 'namespace/project').",
          ),
        title: z
          .string()
          .min(1)
          .describe("Issue title."),
        description: z
          .string()
          .optional()
          .describe("Issue description (Markdown supported)."),
        labels: z
          .string()
          .optional()
          .describe(
            "Comma-separated list of label names (e.g., 'bug,frontend').",
          ),
        milestoneId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Milestone ID to assign."),
        assigneeIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Array of user IDs to assign as assignees."),
        confidential: z
          .boolean()
          .optional()
          .describe("Create a confidential issue."),
        dueDate: z
          .string()
          .optional()
          .describe("Due date in YYYY-MM-DD format."),
      },
      async execute(
        args: {
          projectId: string | number;
          title: string;
          description?: string;
          labels?: string;
          milestoneId?: number;
          assigneeIds?: number[];
          confidential?: boolean;
          dueDate?: string;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const projectParam = projectPathSegment(args.projectId);

        const path = `/api/v4/projects/${projectParam}/issues`;

        // Build request body
        const body: Record<string, unknown> = {
          title: args.title,
        };
        if (args.description !== undefined) {
          body.description = args.description;
        }
        if (args.labels !== undefined) {
          body.labels = args.labels;
        }
        if (args.milestoneId !== undefined) {
          body.milestone_id = args.milestoneId;
        }
        if (args.assigneeIds !== undefined && args.assigneeIds.length > 0) {
          body.assignee_ids = args.assigneeIds;
        }
        if (args.confidential !== undefined) {
          body.confidential = args.confidential;
        }
        if (args.dueDate !== undefined) {
          body.due_date = args.dueDate;
        }

        let response;
        try {
          response = await client.request(
            "gitlab_issue_create",
            path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            context.abort,
          );
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `GitLab API error: ${message}` };
        }

        const resultBody = await jsonOrThrow(response);

        if (!response.ok) {
          return {
            output: formatApiError(
              response.status,
              resultBody,
              "Failed to create issue.",
            ),
            metadata: { _raw: resultBody },
          };
        }

        const curated = curateIssue(resultBody);

        return {
          output: [
            `Issue #${curated.iid} created successfully.`,
            `Title: ${curated.title}`,
            `URL:   ${curated.url}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: resultBody,
          },
        };
      },
    }),

    /* ── gitlab_issue_update ──────────────────────────────────── */

    "gitlab_issue_update": tool({
      description: [
        "Update an existing GitLab issue. Supports partial updates — only",
        "provided fields are modified. Can change state (close/reopen),",
        "title, description, labels, and assignees.",
      ].join(" "),
      args: {
        projectId: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (integer) or URL-encoded path (e.g., 'namespace/project').",
          ),
        issueIid: z
          .number()
          .int()
          .positive()
          .describe("The project-level issue IID to update (e.g., 42)."),
        stateEvent: z
          .enum(["close", "reopen"])
          .optional()
          .describe("State change action: 'close' to close, 'reopen' to reopen."),
        title: z
          .string()
          .min(1)
          .optional()
          .describe("New issue title."),
        description: z
          .string()
          .optional()
          .describe("New issue description (Markdown supported)."),
        labels: z
          .string()
          .optional()
          .describe(
            "Comma-separated list of label names. Overwrites existing labels.",
          ),
        assigneeIds: z
          .array(z.number().int().positive())
          .optional()
          .describe("Array of user IDs to set as assignees."),
        confidential: z
          .boolean()
          .optional()
          .describe("Set confidentiality."),
        dueDate: z
          .string()
          .optional()
          .describe("Due date in YYYY-MM-DD format, or null to remove."),
        discussionLocked: z
          .boolean()
          .optional()
          .describe("Lock or unlock the discussion."),
      },
      async execute(
        args: {
          projectId: string | number;
          issueIid: number;
          stateEvent?: string;
          title?: string;
          description?: string;
          labels?: string;
          assigneeIds?: number[];
          confidential?: boolean;
          dueDate?: string;
          discussionLocked?: boolean;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const projectParam = projectPathSegment(args.projectId);

        const path = `/api/v4/projects/${projectParam}/issues/${args.issueIid}`;

        // Build request body — only set provided fields
        const body: Record<string, unknown> = {};
        if (args.stateEvent !== undefined) {
          body.state_event = args.stateEvent;
        }
        if (args.title !== undefined) {
          body.title = args.title;
        }
        if (args.description !== undefined) {
          body.description = args.description;
        }
        if (args.labels !== undefined) {
          body.labels = args.labels;
        }
        if (args.assigneeIds !== undefined) {
          body.assignee_ids = args.assigneeIds;
        }
        if (args.confidential !== undefined) {
          body.confidential = args.confidential;
        }
        if (args.dueDate !== undefined) {
          // Allow clearing due date by passing empty string or null
          body.due_date = args.dueDate || null;
        }
        if (args.discussionLocked !== undefined) {
          body.discussion_locked = args.discussionLocked;
        }

        // If no fields provided, return early
        if (Object.keys(body).length === 0) {
          return { output: "No fields to update. Provide at least one field to modify." };
        }

        let response;
        try {
          response = await client.request(
            "gitlab_issue_update",
            path,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            context.abort,
          );
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `GitLab API error: ${message}` };
        }

        const resultBody = await jsonOrThrow(response);

        if (!response.ok) {
          return {
            output: formatApiError(
              response.status,
              resultBody,
              `Failed to update issue #${args.issueIid}.`,
            ),
            metadata: { _raw: resultBody },
          };
        }

        const curated = curateIssue(resultBody);

        return {
          output: [
            `Issue #${curated.iid} updated successfully.`,
            `State: ${curated.state}`,
            `Title: ${curated.title}`,
            `URL:   ${curated.url}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: resultBody,
          },
        };
      },
    }),

    /* ── gitlab_issue_comment ─────────────────────────────────── */

    "gitlab_issue_comment": tool({
      description: [
        "Add a note (comment) to an existing GitLab issue. Uses GitLab's",
        "Notes API (POST /projects/:id/issues/:issue_iid/notes).",
        "Returns the created note with its ID and metadata.",
      ].join(" "),
      args: {
        projectId: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (integer) or URL-encoded path (e.g., 'namespace/project').",
          ),
        issueIid: z
          .number()
          .int()
          .positive()
          .describe("The project-level issue IID to comment on (e.g., 42)."),
        body: z
          .string()
          .min(1)
          .describe("The text content of the note (Markdown supported)."),
      },
      async execute(
        args: {
          projectId: string | number;
          issueIid: number;
          body: string;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const projectParam = projectPathSegment(args.projectId);

        const path = `/api/v4/projects/${projectParam}/issues/${args.issueIid}/notes`;

        let response;
        try {
          response = await client.request(
            "gitlab_issue_comment",
            path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body: args.body }),
            },
            context.abort,
          );
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `GitLab API error: ${message}` };
        }

        const resultBody = await jsonOrThrow(response);

        if (!response.ok) {
          return {
            output: formatApiError(
              response.status,
              resultBody,
              "Failed to add comment.",
            ),
            metadata: { _raw: resultBody },
          };
        }

        const note = resultBody;
        const bodyPreview =
          typeof note.body === "string" && note.body.length > 200
            ? note.body.slice(0, 200) + "..."
            : note.body;

        return {
          output: [
            `Comment added to issue #${args.issueIid}.`,
            `Note ID: ${note.id}`,
            `Author:  ${note.author?.name ?? note.author?.username ?? "unknown"}`,
            `Created: ${note.created_at}`,
            "",
            "Body:",
            bodyPreview ?? "(empty)",
          ].join("\n"),
          metadata: {
            id: note.id,
            body: note.body,
            author: note.author
              ? {
                  id: note.author.id,
                  name: note.author.name,
                  username: note.author.username,
                }
              : null,
            createdAt: note.created_at,
            system: note.system ?? false,
            _raw: note,
          },
        };
      },
    }),
  };
}
