/**
 * mrs.ts — Merge Request tools for the GitLab plugin.
 *
 * Provides REST-based tools for working with GitLab merge requests:
 * list, get, create, and merge.
 *
 * ## Tools
 *
 * - **gitlab.mr.list** — List merge requests with filters (state, labels, branches)
 * - **gitlab.mr.get** — Get a single merge request with diff stats
 * - **gitlab.mr.create** — Create a new merge request
 * - **gitlab.mr.merge** — Merge an existing merge request
 *
 * ## API Reference
 *
 * - GET /api/v4/projects/:id/merge_requests
 * - GET /api/v4/projects/:id/merge_requests/:iid
 * - POST /api/v4/projects/:id/merge_requests
 * - PUT /api/v4/projects/:id/merge_requests/:iid/merge
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import type { GitLabClient } from "../client.js";

const z = tool.schema;

/* ── Response type helpers ─────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Curated merge request fields extracted from API response */
interface CuratedMR {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  author: string | null;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
  merge_status: string;
  draft: boolean;
  labels: string[];
  has_conflicts: boolean;
  merge_error: string | null;
  user_notes_count: number;
  upvotes: number;
  downvotes: number;
  diff_stats?: {
    additions: number;
    deletions: number;
    changes: number;
  };
  commits?: Array<{
    id: string;
    title: string;
    message: string;
    author_name: string;
    committed_date: string;
  }>;
  task_completion_status?: {
    count: number;
    completed_count: number;
  };
}

/** Extract curated MR fields from a raw API response */
function extractMR(raw: any): CuratedMR {
  return {
    iid: raw.iid,
    title: raw.title,
    description: raw.description ?? null,
    state: raw.state,
    web_url: raw.web_url,
    source_branch: raw.source_branch,
    target_branch: raw.target_branch,
    author: raw.author?.username ?? raw.author?.name ?? null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    merged_at: raw.merged_at ?? null,
    closed_at: raw.closed_at ?? null,
    merge_status: raw.merge_status ?? "unknown",
    draft: raw.draft ?? raw.work_in_progress ?? false,
    labels: raw.labels ?? [],
    has_conflicts: raw.has_conflicts ?? false,
    merge_error: raw.merge_error ?? null,
    user_notes_count: raw.user_notes_count ?? 0,
    upvotes: raw.upvotes ?? 0,
    downvotes: raw.downvotes ?? 0,
  };
}

/** Extract diff stats from a raw MR response */
function extractDiffStats(raw: any): { additions: number; deletions: number; changes: number } | undefined {
  if (raw.diff_refs) {
    return {
      additions: raw.diff_refs.additions ?? 0,
      deletions: raw.diff_refs.deletions ?? 0,
      changes: raw.diff_refs.changes ?? 0,
    };
  }
  // Fallback to top-level fields
  if (raw.additions !== undefined || raw.deletions !== undefined) {
    return {
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changes: raw.changes ?? (raw.additions ?? 0) + (raw.deletions ?? 0),
    };
  }
  return undefined;
}

/** Build a single MR markdown summary line */
function mrSummaryLine(mr: CuratedMR, index: number): string {
  const draftLabel = mr.draft ? " [DRAFT]" : "";
  const labels =
    mr.labels.length > 0 ? ` [${mr.labels.join(", ")}]` : "";
  return (
    `${index}. **!${mr.iid}** — ${mr.title}${draftLabel}` +
    ` | ${mr.state} | ${mr.source_branch} → ${mr.target_branch}` +
    ` | by ${mr.author}${labels}`
  );
}

/** Build a full MR detail string */
function mrDetailString(mr: CuratedMR): string {
  const lines: string[] = [
    `**!${mr.iid} — ${mr.title}**`,
    ``,
    `- **State:** ${mr.state}`,
    `- **Author:** ${mr.author}`,
    `- **Source Branch:** \`${mr.source_branch}\``,
    `- **Target Branch:** \`${mr.target_branch}\``,
    `- **Draft:** ${mr.draft ? "Yes" : "No"}`,
    `- **Merge Status:** ${mr.merge_status}`,
    `- **Has Conflicts:** ${mr.has_conflicts}`,
  ];

  if (mr.task_completion_status) {
    lines.push(
      `- **Tasks:** ${mr.task_completion_status.completed_count}/${mr.task_completion_status.count} completed`,
    );
  }

  if (mr.labels.length > 0) {
    lines.push(`- **Labels:** ${mr.labels.join(", ")}`);
  }

  lines.push(
    `- **Notes:** ${mr.user_notes_count}`,
    `- **Votes:** ${mr.upvotes} up / ${mr.downvotes} down`,
    `- **Created:** ${mr.created_at}`,
    `- **Updated:** ${mr.updated_at}`,
  );

  if (mr.merged_at) {
    lines.push(`- **Merged At:** ${mr.merged_at}`);
  }
  if (mr.closed_at) {
    lines.push(`- **Closed At:** ${mr.closed_at}`);
  }
  if (mr.merge_error) {
    lines.push(`- **Merge Error:** ${mr.merge_error}`);
  }

  if (mr.diff_stats) {
    lines.push(
      ``,
      `### Diff Stats`,
      `- **Additions:** +${mr.diff_stats.additions}`,
      `- **Deletions:** -${mr.diff_stats.deletions}`,
      `- **Total Changes:** ${mr.diff_stats.changes}`,
    );
  }

  if (mr.commits && mr.commits.length > 0) {
    lines.push(``, `### Commits (${mr.commits.length})`);
    for (let i = 0; i < mr.commits.length; i++) {
      const c = mr.commits[i]!;
      lines.push(`${i + 1}. \`${c.id.slice(0, 8)}\` ${c.title} — ${c.author_name}`);
    }
  }

  if (mr.description) {
    const truncated =
      mr.description.length > 500
        ? mr.description.slice(0, 500) + "..."
        : mr.description;
    lines.push(``, `### Description`, ``);
    lines.push(mr.description.length > 500 ? `${truncated}` : truncated);
  }

  lines.push(``, `- **URL:** ${mr.web_url}`);

  return lines.join("\n");
}

/* ── Tool Factories ────────────────────────────────────────────── */

/**
 * Create merge request tools.
 *
 * @param getGitLabClient  Async factory for the GitLab REST client
 * @returns A record of tool name → registered tool object
 */
export function createMRTools(
  getGitLabClient: () => Promise<GitLabClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── gitlab.mr.list ───────────────────────────────────────── */

    "gitlab.mr.list": tool({
      description: [
        "List merge requests for a GitLab project.",
        "Filterable by state (opened/closed/merged/all), labels,",
        "source branch, and target branch.",
        "Returns a markdown-formatted list with key metadata.",
      ].join(" "),
      args: {
        project_id: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (number) or URL-encoded path (e.g., 'group/subgroup/project').",
          ),
        state: z
          .enum(["opened", "closed", "merged", "all"])
          .optional()
          .default("opened")
          .describe("Filter MRs by state. Default: opened."),
        labels: z
          .string()
          .optional()
          .describe(
            "Comma-separated list of label names to filter by (e.g., 'bug,frontend').",
          ),
        source_branch: z
          .string()
          .optional()
          .describe("Return merge requests with the given source branch."),
        target_branch: z
          .string()
          .optional()
          .describe("Return merge requests with the given target branch."),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Number of results per page (max 100, default 20)."),
      },
      async execute(
        args: {
          project_id: string | number;
          state?: string;
          labels?: string;
          source_branch?: string;
          target_branch?: string;
          per_page?: number;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getGitLabClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        // Build query string
        const params = new URLSearchParams();
        params.set("state", args.state ?? "opened");
        params.set("per_page", String(args.per_page ?? 20));
        if (args.labels) params.set("labels", args.labels);
        if (args.source_branch) params.set("source_branch", args.source_branch);
        if (args.target_branch) params.set("target_branch", args.target_branch);

        const path = `/api/v4/projects/${args.project_id}/merge_requests?${params.toString()}`;

        try {
          const response = await client.request(
            "gitlab.mr.list",
            path,
            undefined,
            context.abort,
          );

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const msg =
              (body as any).message ?? response.statusText;
            return {
              output: `Failed to list merge requests: HTTP ${response.status} — ${msg}`,
              metadata: { _raw: { status: response.status, body } },
            };
          }

          const raw = (await response.json()) as any[];
          const mrs = Array.isArray(raw) ? raw : [];

          if (mrs.length === 0) {
            return { output: "No merge requests found matching the filters." };
          }

          const curated = mrs.map((mr) => extractMR(mr));
          const lines: string[] = [
            `## Merge Requests (${curated.length})`,
            ``,
          ];

          for (let i = 0; i < curated.length; i++) {
            lines.push(mrSummaryLine(curated[i]!, i + 1));
          }

          return {
            output: lines.join("\n"),
            metadata: {
              count: curated.length,
              results: curated,
              _raw: raw,
            },
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `Failed to list merge requests: ${message}` };
        }
      },
    }),

    /* ── gitlab.mr.get ────────────────────────────────────────── */

    "gitlab.mr.get": tool({
      description: [
        "Get a single merge request with full details including",
        "diff stats and commit history.",
      ].join(" "),
      args: {
        project_id: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (number) or URL-encoded path (e.g., 'group/subgroup/project').",
          ),
        iid: z
          .number()
          .int()
          .positive()
          .describe("Merge request internal ID (IID)."),
      },
      async execute(
        args: { project_id: string | number; iid: number },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getGitLabClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const basePath = `/api/v4/projects/${args.project_id}/merge_requests/${args.iid}`;

        try {
          // Fetch the MR with diff stats (include_diff=true) and commits
          const response = await client.request(
            "gitlab.mr.get",
            `${basePath}?include_diff=true`,
            undefined,
            context.abort,
          );

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const msg = (body as any).message ?? response.statusText;
            return {
              output: `Failed to get merge request !${args.iid}: HTTP ${response.status} — ${msg}`,
              metadata: { _raw: { status: response.status, body } },
            };
          }

          const raw = (await response.json()) as any;
          const curated = extractMR(raw);

          // Diff stats
          curated.diff_stats = extractDiffStats(raw);

          // Fetch commits separately
          try {
            const commitsResponse = await client.request(
              "gitlab.mr.get",
              `${basePath}/commits`,
              undefined,
              context.abort,
            );

            if (commitsResponse.ok) {
              const commits = (await commitsResponse.json()) as any[];
              curated.commits = (Array.isArray(commits) ? commits : []).map(
                (c: any) => ({
                  id: c.id,
                  title: c.title ?? "",
                  message: c.message ?? "",
                  author_name: c.author_name ?? "",
                  committed_date: c.committed_date ?? "",
                }),
              );
            }
          } catch {
            // Commits are optional — continue without them
          }

          return {
            output: mrDetailString(curated),
            metadata: {
              ...curated,
              _raw: raw,
            },
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to get merge request !${args.iid}: ${message}`,
          };
        }
      },
    }),

    /* ── gitlab.mr.create ─────────────────────────────────────── */

    "gitlab.mr.create": tool({
      description: [
        "Create a new merge request in a GitLab project.",
        "Requires source branch, target branch, and title.",
        "Optionally set as draft (WIP).",
      ].join(" "),
      args: {
        project_id: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (number) or URL-encoded path (e.g., 'group/subgroup/project').",
          ),
        title: z
          .string()
          .min(1)
          .describe("Title of the merge request."),
        source_branch: z
          .string()
          .min(1)
          .describe("Source branch name."),
        target_branch: z
          .string()
          .min(1)
          .describe("Target branch name."),
        description: z
          .string()
          .optional()
          .describe("Description/body of the merge request."),
        draft: z
          .boolean()
          .optional()
          .default(false)
          .describe("Set to true to create the MR as draft/WIP."),
      },
      async execute(
        args: {
          project_id: string | number;
          title: string;
          source_branch: string;
          target_branch: string;
          description?: string;
          draft?: boolean;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getGitLabClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const body: Record<string, unknown> = {
          title: args.title,
          source_branch: args.source_branch,
          target_branch: args.target_branch,
        };

        if (args.description) {
          body.description = args.description;
        }

        if (args.draft) {
          body.draft = true;
        }

        const path = `/api/v4/projects/${args.project_id}/merge_requests`;

        try {
          const response = await client.request(
            "gitlab.mr.create",
            path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            context.abort,
          );

          if (!response.ok) {
            const respBody = await response.json().catch(() => ({}));
            const msg = (respBody as any).message ?? response.statusText;
            return {
              output: `Failed to create merge request: HTTP ${response.status} — ${JSON.stringify(msg)}`,
              metadata: { _raw: { status: response.status, body: respBody } },
            };
          }

          const raw = (await response.json()) as any;
          const curated = extractMR(raw);

          return {
            output: [
              `✅ Merge request created successfully!`,
              ``,
              mrSummaryLine(curated, 1),
              ``,
              `**URL:** ${curated.web_url}`,
            ].join("\n"),
            metadata: {
              ...curated,
              _raw: raw,
            },
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `Failed to create merge request: ${message}` };
        }
      },
    }),

    /* ── gitlab.mr.merge ──────────────────────────────────────── */

    "gitlab.mr.merge": tool({
      description: [
        "Merge a merge request. Supports merge strategy,",
        "squash commits, and removing the source branch.",
      ].join(" "),
      args: {
        project_id: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (number) or URL-encoded path (e.g., 'group/subgroup/project').",
          ),
        iid: z
          .number()
          .int()
          .positive()
          .describe("Merge request internal ID (IID)."),
        merge_strategy: z
          .enum(["merge_commit", "squash", "fast_forward"])
          .optional()
          .default("merge_commit")
          .describe([
            "Merge strategy:",
            "  - merge_commit: Create a merge commit (default)",
            "  - squash: Squash commits into one",
            "  - fast_forward: Fast-forward merge",
          ].join(" ")),
        squash: z
          .boolean()
          .optional()
          .describe("Squash commits before merge. Overrides merge_strategy."),
        should_remove_source_branch: z
          .boolean()
          .optional()
          .default(true)
          .describe("Delete the source branch after merge. Default: true."),
      },
      async execute(
        args: {
          project_id: string | number;
          iid: number;
          merge_strategy?: string;
          squash?: boolean;
          should_remove_source_branch?: boolean;
        },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let client: GitLabClient;
        try {
          client = await getGitLabClient();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const body: Record<string, unknown> = {
          should_remove_source_branch: args.should_remove_source_branch ?? true,
        };

        if (args.squash !== undefined) {
          body.squash = args.squash;
        }

        if (args.merge_strategy === "squash") {
          body.squash = true;
        }

        // GitLab API uses merge_when_pipeline_succeeds for auto-merge
        // For immediate merge, we just PUT with the merge params

        const path = `/api/v4/projects/${args.project_id}/merge_requests/${args.iid}/merge`;

        try {
          const response = await client.request(
            "gitlab.mr.merge",
            path,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            context.abort,
          );

          if (!response.ok) {
            const respBody = await response.json().catch(() => ({}));
            const msg = (respBody as any).message ?? response.statusText;
            return {
              output: `Failed to merge merge request !${args.iid}: HTTP ${response.status} — ${JSON.stringify(msg)}`,
              metadata: { _raw: { status: response.status, body: respBody } },
            };
          }

          const raw = (await response.json()) as any;
          const curated = extractMR(raw);
          curated.diff_stats = extractDiffStats(raw);

          return {
            output: [
              `✅ Merge request !${args.iid} merged successfully!`,
              ``,
              `- **Title:** ${curated.title}`,
              `- **State:** ${curated.state}`,
              `- **Source Branch:** \`${curated.source_branch}\``,
              `- **Target Branch:** \`${curated.target_branch}\``,
              curated.merged_at
                ? `- **Merged At:** ${curated.merged_at}`
                : "",
              `- **URL:** ${curated.web_url}`,
            ]
              .filter(Boolean)
              .join("\n"),
            metadata: {
              ...curated,
              _raw: raw,
            },
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to merge merge request !${args.iid}: ${message}`,
          };
        }
      },
    }),
  };
}
