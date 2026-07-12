/**
 * prs.ts — REST-based pull request tools for the GitHub plugin.
 *
 * Provides CRUD operations for GitHub pull requests via the REST API.
 * All tools use the existing getGitHubClient() HTTP client through the
 * middleware pipeline in client.ts.
 *
 * ## Tools
 *
 * - **github.pr.list** — List pull requests (filterable by state, head, base, sort)
 * - **github.pr.get** — Get a single PR with diffstat and commits
 * - **github.pr.create** — Create a pull request (title, body, head, base, draft)
 * - **github.pr.merge** — Merge a pull request (merge method, commit title/message)
 *
 * ## Design
 *
 * Each tool extracts curated fields from the REST API response and includes
 * the full `_raw` response in metadata. Errors are surfaced as structured
 * messages in the output string. Pagination links are parsed from the Link header.
 */

import { tool } from "@opencode-ai/plugin";
import type { GitHubClient } from "../client.js";

const z = tool.schema;

/* ── Response type helpers ──────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Format a list of PRs as a Markdown summary string */
function formatPrList(prs: any[]): string {
  if (prs.length === 0) return "No pull requests found.";
  return prs
    .map(
      (pr, i) =>
        `${i + 1}. [#${pr.number}](<${pr.html_url}>) **${pr.title}** — ${pr.state} (by ${pr.user?.login ?? "unknown"})`,
    )
    .join("\n");
}

/** Format a single PR as a Markdown summary string */
function formatPrDetail(pr: any): string {
  const lines = [
    `## PR #${pr.number}: ${pr.title}`,
    ``,
    `**State:** ${pr.state}`,
    `**Author:** ${pr.user?.login ?? "unknown"}`,
    `**Base:** ${pr.base?.label ?? "?"} ← **Head:** ${pr.head?.label ?? "?"}`,
    pr.merge_commit_sha ? `**Merge Commit:** \`${pr.merge_commit_sha}\`` : null,
    pr.draft ? `**Draft:** Yes` : null,
    `**Created:** ${pr.created_at}`,
    `**Updated:** ${pr.updated_at}`,
    pr.closed_at ? `**Closed:** ${pr.closed_at}` : null,
    pr.merged_at ? `**Merged:** ${pr.merged_at}` : null,
    `**URL:** ${pr.html_url}`,
  ].filter(Boolean) as string[];

  if (pr.labels && pr.labels.length > 0) {
    lines.push(`**Labels:** ${pr.labels.map((l: any) => l.name).join(", ")}`);
  }

  if (pr.requested_reviewers && pr.requested_reviewers.length > 0) {
    lines.push(
      `**Requested Reviewers:** ${pr.requested_reviewers.map((r: any) => r.login).join(", ")}`,
    );
  }

  if (pr.body) {
    lines.push(``, `---`, ``, pr.body);
  }

  return lines.join("\n");
}

/** Format PR merge result as a Markdown string */
function formatMergeResult(result: any): string {
  const lines = [
    `## Merge Result`,
    ``,
    `**Merged:** ${result.merged ? "✅ Yes" : "❌ No"}`,
    `**Message:** ${result.message}`,
    result.sha ? `**SHA:** \`${result.sha}\`` : null,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}

/* ── Tool Factories ─────────────────────────────────────────────── */

/**
 * Create the four REST-based pull request tools.
 *
 * @param getClient  Async factory that returns the GitHub HTTP client
 * @returns A record of tool name → registered tool object
 */
export function createPrTools(
  getClient: () => Promise<GitHubClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── github.pr.list ─────────────────────────────────────────── */

    "github.pr.list": tool({
      description: [
        "List pull requests in a repository.",
        "Filterable by state (open, closed, all), head branch, base branch,",
        "and sort order (created, updated, popularity, long-running).",
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
          .describe("PR state filter (default: open)."),
        head: z
          .string()
          .optional()
          .describe("Filter by head user or branch name."),
        base: z
          .string()
          .optional()
          .describe("Filter by base branch name."),
        sort: z
          .enum(["created", "updated", "popularity", "long-running"])
          .optional()
          .default("created")
          .describe("Sort field (default: created)."),
        direction: z
          .enum(["asc", "desc"])
          .optional()
          .default("desc")
          .describe("Sort direction (default: desc)."),
        perPage: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(30)
          .describe("Results per page (max 100, default 30)."),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .default(1)
          .describe("Page number (default: 1)."),
      },
      async execute(
        args: {
          owner: string;
          repo: string;
          state?: string;
          head?: string;
          base?: string;
          sort?: string;
          direction?: string;
          perPage?: number;
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

        // Build query parameters
        const params = new URLSearchParams();
        if (args.state) params.set("state", args.state);
        if (args.head) params.set("head", args.head);
        if (args.base) params.set("base", args.base);
        if (args.sort) params.set("sort", args.sort);
        if (args.direction) params.set("direction", args.direction);
        if (args.perPage) params.set("per_page", String(args.perPage));
        if (args.page) params.set("page", String(args.page));

        const queryString = params.toString();
        const path = `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/pulls${queryString ? `?${queryString}` : ""}`;

        let response: Response;
        try {
          response = await client.request("github.pr.list", path, undefined, context.abort);
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        if (!response.ok) {
          let errorBody: any;
          try {
            errorBody = await response.json();
          } catch {
            errorBody = { message: response.statusText };
          }
          return {
            output: `GitHub API error (${response.status}): ${errorBody.message ?? response.statusText}`,
            metadata: { _raw: errorBody },
          };
        }

        let prs: any[];
        try {
          prs = (await response.json()) as any[];
        } catch (err) {
          return {
            output: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        // Parse pagination headers
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");

        // Curated output
        const curated = prs.map((pr: any) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          draft: pr.draft ?? false,
          author: pr.user?.login ?? null,
          head: {
            label: pr.head?.label ?? null,
            ref: pr.head?.ref ?? null,
            sha: pr.head?.sha ?? null,
          },
          base: {
            label: pr.base?.label ?? null,
            ref: pr.base?.ref ?? null,
            sha: pr.base?.sha ?? null,
          },
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          closedAt: pr.closed_at ?? null,
          mergedAt: pr.merged_at ?? null,
          labels: (pr.labels ?? []).map((l: any) => l.name),
          url: pr.html_url,
        }));

        return {
          output: [
            `## Pull Requests in ${args.owner}/${args.repo}`,
            `State: ${args.state} | Page: ${args.page} | Per page: ${args.perPage}`,
            rateLimitRemaining ? `Rate limit remaining: ${rateLimitRemaining}` : null,
            ``,
            formatPrList(prs),
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            results: curated,
            total: prs.length,
            pagination: { page: args.page, perPage: args.perPage },
            rateLimitRemaining: rateLimitRemaining ? Number(rateLimitRemaining) : null,
            _raw: prs,
          },
        };
      },
    }),

    /* ── github.pr.get ──────────────────────────────────────────── */

    "github.pr.get": tool({
      description: [
        "Get a single pull request with full details including diffstat",
        "(additions, deletions, changed files) and commit list.",
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
        prNumber: z
          .number()
          .int()
          .positive()
          .describe("Pull request number."),
      },
      async execute(
        args: { owner: string; repo: string; prNumber: number },
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

        const encodedOwner = encodeURIComponent(args.owner);
        const encodedRepo = encodeURIComponent(args.repo);

        // Fetch PR details
        const prPath = `/repos/${encodedOwner}/${encodedRepo}/pulls/${args.prNumber}`;

        let prResponse: Response;
        try {
          prResponse = await client.request("github.pr.get", prPath, undefined, context.abort);
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        if (!prResponse.ok) {
          let errorBody: any;
          try {
            errorBody = await prResponse.json();
          } catch {
            errorBody = { message: prResponse.statusText };
          }

          if (prResponse.status === 404) {
            return {
              output: [
                `Pull request #${args.prNumber} not found in`,
                `${args.owner}/${args.repo}.`,
                "Verify the PR number and repository name.",
              ].join(" "),
              metadata: { _raw: errorBody },
            };
          }

          return {
            output: `GitHub API error (${prResponse.status}): ${errorBody.message ?? prResponse.statusText}`,
            metadata: { _raw: errorBody },
          };
        }

        let pr: any;
        try {
          pr = await prResponse.json();
        } catch (err) {
          return {
            output: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        // Fetch commits for this PR (first 30)
        let commits: any[] = [];
        const commitsPath = `/repos/${encodedOwner}/${encodedRepo}/pulls/${args.prNumber}/commits?per_page=30`;
        try {
          const commitsResponse = await client.request(
            "github.pr.get",
            commitsPath,
            undefined,
            context.abort,
          );
          if (commitsResponse.ok) {
            commits = (await commitsResponse.json()) as any[];
          }
        } catch {
          // Commits are optional — if this fails, we still return the PR
        }

        // Fetch files for this PR (first 30)
        let files: any[] = [];
        const filesPath = `/repos/${encodedOwner}/${encodedRepo}/pulls/${args.prNumber}/files?per_page=30`;
        try {
          const filesResponse = await client.request(
            "github.pr.get",
            filesPath,
            undefined,
            context.abort,
          );
          if (filesResponse.ok) {
            files = (await filesResponse.json()) as any[];
          }
        } catch {
          // Files are optional — if this fails, we still return the PR
        }

        const curated = {
          pr: {
            number: pr.number,
            title: pr.title,
            body: pr.body ?? null,
            state: pr.state,
            draft: pr.draft ?? false,
            url: pr.html_url,
            createdAt: pr.created_at,
            updatedAt: pr.updated_at,
            closedAt: pr.closed_at ?? null,
            mergedAt: pr.merged_at ?? null,
            mergeCommitSha: pr.merge_commit_sha ?? null,
            author: pr.user?.login ?? null,
            assignees: (pr.assignees ?? []).map((a: any) => a.login),
            requestedReviewers: (pr.requested_reviewers ?? []).map((r: any) => r.login),
            labels: ((pr.labels ?? []) as any[]).map((l: any) => ({ name: l.name, color: l.color })),
            head: {
              label: pr.head?.label ?? null,
              ref: pr.head?.ref ?? null,
              sha: pr.head?.sha ?? null,
              repo: pr.head?.repo?.full_name ?? null,
            },
            base: {
              label: pr.base?.label ?? null,
              ref: pr.base?.ref ?? null,
              sha: pr.base?.sha ?? null,
              repo: pr.base?.repo?.full_name ?? null,
            },
            stats: {
              additions: pr.additions ?? 0,
              deletions: pr.deletions ?? 0,
              changedFiles: pr.changed_files ?? 0,
              commits: pr.commits ?? 0,
            },
          },
          commits: commits.map((c: any) => ({
            sha: c.sha,
            message: c.commit?.message ?? null,
            author: c.commit?.author?.name ?? c.author?.login ?? null,
            date: c.commit?.author?.date ?? null,
          })),
          files: files.map((f: any) => ({
            filename: f.filename,
            status: f.status,
            additions: f.additions ?? 0,
            deletions: f.deletions ?? 0,
            changes: f.changes ?? 0,
            patch: f.patch ?? null,
          })),
        };

        const labelStr =
          curated.pr.labels.length > 0
            ? curated.pr.labels.map((l) => l.name).join(", ")
            : "(none)";

        return {
          output: [
            formatPrDetail(pr),
            ``,
            `## Diff Stats`,
            `+${curated.pr.stats.additions} -${curated.pr.stats.deletions} (${curated.pr.stats.changedFiles} files, ${curated.pr.stats.commits} commits)`,
            ``,
            `## Commits (${curated.commits.length})`,
            ``,
            ...curated.commits.map(
              (c, i) =>
                `${i + 1}. \`${c.sha?.slice(0, 7) ?? "?????"}\` ${c.message?.split("\n")[0] ?? "(empty)"} — ${c.author ?? "unknown"}`,
            ),
            ``,
            `## Files Changed (${curated.files.length})`,
            ``,
            ...curated.files.map(
              (f) =>
                `- \`${f.filename}\` (${f.status}, +${f.additions} -${f.deletions})`,
            ),
            ``,
            `**Labels:** ${labelStr}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: { pr, commits, files },
          },
        };
      },
    }),

    /* ── github.pr.create ───────────────────────────────────────── */

    "github.pr.create": tool({
      description: [
        "Create a new pull request in a repository.",
        "Supports draft PRs and full title/body content.",
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
          .describe("Pull request title."),
        body: z
          .string()
          .optional()
          .describe("Pull request body/description."),
        head: z
          .string()
          .min(1)
          .describe("The name of the branch where changes are implemented."),
        base: z
          .string()
          .min(1)
          .describe("The name of the branch you want the changes pulled into."),
        draft: z
          .boolean()
          .optional()
          .default(false)
          .describe("Create as a draft pull request (default: false)."),
      },
      async execute(
        args: {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          head: string;
          base: string;
          draft?: boolean;
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

        const path = `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/pulls`;

        const body: Record<string, unknown> = {
          title: args.title,
          head: args.head,
          base: args.base,
        };
        if (args.body) body.body = args.body;
        if (args.draft) body.draft = true;

        let response: Response;
        try {
          response = await client.request(
            "github.pr.create",
            path,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
            context.abort,
          );
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        let responseBody: any;
        try {
          responseBody = await response.json();
        } catch (err) {
          return {
            output: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (!response.ok) {
          // Surface validation errors from the API
          const errors = responseBody.errors
            ? responseBody.errors.map((e: any) => `- ${e.message}`).join("\n")
            : responseBody.message ?? response.statusText;
          return {
            output: `Failed to create pull request (${response.status}):\n${errors}`,
            metadata: { _raw: responseBody },
          };
        }

        const curated = {
          number: responseBody.number,
          title: responseBody.title,
          state: responseBody.state,
          draft: responseBody.draft ?? false,
          url: responseBody.html_url,
          author: responseBody.user?.login ?? null,
          head: {
            label: responseBody.head?.label ?? null,
            ref: responseBody.head?.ref ?? null,
          },
          base: {
            label: responseBody.base?.label ?? null,
            ref: responseBody.base?.ref ?? null,
          },
          createdAt: responseBody.created_at,
        };

        return {
          output: [
            `## Pull Request Created ✅`,
            ``,
            `**#${curated.number}: ${curated.title}**`,
            `**State:** ${curated.state}`,
            curated.draft ? `**Draft:** Yes` : null,
            `**Base:** ${curated.base.label} ← **Head:** ${curated.head.label}`,
            `**Author:** ${curated.author}`,
            ``,
            `**URL:** ${curated.url}`,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {
            ...curated,
            _raw: responseBody,
          },
        };
      },
    }),

    /* ── github.pr.merge ────────────────────────────────────────── */

    "github.pr.merge": tool({
      description: [
        "Merge a pull request using the specified merge method.",
        "Supports merge, squash, and rebase merge strategies.",
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
        prNumber: z
          .number()
          .int()
          .positive()
          .describe("Pull request number to merge."),
        mergeMethod: z
          .enum(["merge", "squash", "rebase"])
          .optional()
          .default("merge")
          .describe("Merge method (default: merge)."),
        commitTitle: z
          .string()
          .optional()
          .describe("Title for the auto-generated commit."),
        commitMessage: z
          .string()
          .optional()
          .describe("Extra detail for the auto-generated commit message."),
      },
      async execute(
        args: {
          owner: string;
          repo: string;
          prNumber: number;
          mergeMethod?: string;
          commitTitle?: string;
          commitMessage?: string;
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

        const path = `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/pulls/${args.prNumber}/merge`;

        const mergeBody: Record<string, unknown> = {
          merge_method: args.mergeMethod ?? "merge",
        };
        if (args.commitTitle) mergeBody.commit_title = args.commitTitle;
        if (args.commitMessage) mergeBody.commit_message = args.commitMessage;

        let response: Response;
        try {
          response = await client.request(
            "github.pr.merge",
            path,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(mergeBody),
            },
            context.abort,
          );
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        let responseBody: any;
        try {
          responseBody = await response.json();
        } catch (err) {
          return {
            output: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        if (!response.ok) {
          const errors = responseBody.errors
            ? responseBody.errors.map((e: any) => `- ${e.message}`).join("\n")
            : responseBody.message ?? response.statusText;
          return {
            output: `Failed to merge pull request (${response.status}):\n${errors}`,
            metadata: { _raw: responseBody },
          };
        }

        return {
          output: formatMergeResult(responseBody),
          metadata: {
            merged: responseBody.merged,
            message: responseBody.message,
            sha: responseBody.sha ?? null,
            _raw: responseBody,
          },
        };
      },
    }),
  };
}
