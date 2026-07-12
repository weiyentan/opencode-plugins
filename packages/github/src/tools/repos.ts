/**
 * repos.ts — REST-based repository tools for the GitHub plugin.
 *
 * Provides tools for retrieving and searching repositories via the REST API.
 * All tools use the existing getGitHubClient() HTTP client through the
 * middleware pipeline in client.ts.
 *
 * ## Tools
 *
 * - **github.repo.get** — Get repository metadata (description, topics, language, stars, fork count)
 * - **github.repo.search** — Search repositories by query (sort by stars, forks, updated)
 *
 * ## Design
 *
 * Each tool extracts curated fields from the REST API response and includes
 * the full `_raw` response in metadata. Errors are surfaced as structured
 * messages in the output string.
 */

import { tool } from "@opencode-ai/plugin";
import type { GitHubClient } from "../client.js";

const z = tool.schema;

/* ── Response type helpers ──────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Format a repository as a Markdown summary string */
function formatRepo(repo: any): string {
  const lines = [
    `## ${repo.full_name}`,
    ``,
    repo.description ? `${repo.description}` : null,
    ``,
    `**Stars:** ${repo.stargazers_count}  **Forks:** ${repo.forks_count}`,
    repo.language ? `**Primary Language:** ${repo.language}` : null,
    repo.topics && repo.topics.length > 0
      ? `**Topics:** ${repo.topics.join(", ")}`
      : null,
    repo.license ? `**License:** ${repo.license.spdx_id ?? repo.license.name}` : null,
    `**Open Issues:** ${repo.open_issues_count}`,
    repo.visibility ? `**Visibility:** ${repo.visibility}` : null,
    repo.archived ? `**Archived:** Yes` : null,
    repo.fork ? `**Fork:** Yes (from ${repo.parent?.full_name ?? "unknown"})` : null,
    `**Default Branch:** ${repo.default_branch}`,
    `**Created:** ${repo.created_at}`,
    `**Updated:** ${repo.updated_at}`,
    repo.pushed_at ? `**Last Push:** ${repo.pushed_at}` : null,
    repo.homepage ? `**Homepage:** ${repo.homepage}` : null,
    `**URL:** ${repo.html_url}`,
  ].filter(Boolean) as string[];
  return lines.join("\n");
}

/** Format a list of repo search results as a Markdown summary */
function formatSearchResults(items: any[], totalCount: number, query: string): string {
  if (items.length === 0) return `No repositories found for "${query}".`;
  return [
    `## Repository Search Results`,
    `Query: \`${query}\` | Total: ${totalCount} repositories`,
    ``,
    ...items.map(
      (repo, i) =>
        `${i + 1}. [${repo.full_name}](<${repo.html_url}>)` +
        `${repo.description ? ` — ${repo.description.slice(0, 80)}${repo.description.length > 80 ? "…" : ""}` : ""}` +
        ` ⭐${repo.stargazers_count} 🍴${repo.forks_count}`,
    ),
  ].join("\n");
}

/* ── Tool Factories ─────────────────────────────────────────────── */

/**
 * Create the two REST-based repository tools.
 *
 * @param getClient  Async factory that returns the GitHub HTTP client
 * @returns A record of tool name → registered tool object
 */
export function createRepoTools(
  getClient: () => Promise<GitHubClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── github.repo.get ────────────────────────────────────────── */

    "github.repo.get": tool({
      description: [
        "Get a GitHub repository's metadata including description, topics,",
        "primary language, stars, forks, license, and visibility.",
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
      },
      async execute(
        args: { owner: string; repo: string },
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

        const path = `/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}`;

        let response: Response;
        try {
          response = await client.request("github.repo.get", path, undefined, context.abort);
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

          if (response.status === 404) {
            return {
              output: [
                `Repository "${args.owner}/${args.repo}" not found.`,
                "Verify the owner and repository name.",
              ].join(" "),
              metadata: { _raw: errorBody },
            };
          }

          return {
            output: `GitHub API error (${response.status}): ${errorBody.message ?? response.statusText}`,
            metadata: { _raw: errorBody },
          };
        }

        let repo: any;
        try {
          repo = await response.json();
        } catch (err) {
          return {
            output: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        const curated = {
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner?.login ?? null,
          description: repo.description ?? null,
          url: repo.html_url,
          homepage: repo.homepage ?? null,
          defaultBranch: repo.default_branch,
          visibility: repo.visibility ?? null,
          archived: repo.archived ?? false,
          fork: repo.fork ?? false,
          language: repo.language ?? null,
          topics: repo.topics ?? [],
          license: repo.license
            ? {
                key: repo.license.key ?? null,
                name: repo.license.name ?? null,
                spdxId: repo.license.spdx_id ?? null,
              }
            : null,
          stats: {
            stars: repo.stargazers_count ?? 0,
            forks: repo.forks_count ?? 0,
            openIssues: repo.open_issues_count ?? 0,
            watchers: repo.subscribers_count ?? 0,
          },
          createdAt: repo.created_at,
          updatedAt: repo.updated_at,
          pushedAt: repo.pushed_at ?? null,
          size: repo.size ?? null,
          parent: repo.parent
            ? {
                fullName: repo.parent.full_name ?? null,
                url: repo.parent.html_url ?? null,
              }
            : null,
        };

        return {
          output: formatRepo(repo),
          metadata: {
            ...curated,
            _raw: repo,
          },
        };
      },
    }),

    /* ── github.repo.search ─────────────────────────────────────── */

    "github.repo.search": tool({
      description: [
        "Search for GitHub repositories by query.",
        "Results can be sorted by stars, forks, or last updated.",
      ].join(" "),
      args: {
        query: z
          .string()
          .min(1)
          .describe("Search query (same syntax as GitHub repo search)."),
        sort: z
          .enum(["stars", "forks", "updated"])
          .optional()
          .default("stars")
          .describe("Sort field (default: stars)."),
        order: z
          .enum(["asc", "desc"])
          .optional()
          .default("desc")
          .describe("Sort order (default: desc)."),
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
          query: string;
          sort?: string;
          order?: string;
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

        const params = new URLSearchParams();
        params.set("q", args.query);
        if (args.sort) params.set("sort", args.sort);
        if (args.order) params.set("order", args.order);
        if (args.perPage) params.set("per_page", String(args.perPage));
        if (args.page) params.set("page", String(args.page));

        const path = `/search/repositories?${params.toString()}`;

        let response: Response;
        try {
          response = await client.request("github.repo.search", path, undefined, context.abort);
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

        let searchResult: any;
        try {
          searchResult = await response.json();
        } catch (err) {
          return {
            output: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        const items: any[] = searchResult.items ?? [];

        const curated = items.map((repo: any) => ({
          name: repo.name,
          fullName: repo.full_name,
          owner: repo.owner?.login ?? null,
          description: repo.description ?? null,
          url: repo.html_url,
          language: repo.language ?? null,
          topics: repo.topics ?? [],
          stars: repo.stargazers_count ?? 0,
          forks: repo.forks_count ?? 0,
          openIssues: repo.open_issues_count ?? 0,
          license: repo.license?.spdx_id ?? null,
          visibility: repo.visibility ?? null,
          updatedAt: repo.updated_at,
          createdAt: repo.created_at,
        }));

        return {
          output: formatSearchResults(items, searchResult.total_count ?? 0, args.query),
          metadata: {
            totalCount: searchResult.total_count ?? 0,
            incompleteResults: searchResult.incomplete_results ?? false,
            results: curated,
            _raw: searchResult,
          },
        };
      },
    }),
  };
}
