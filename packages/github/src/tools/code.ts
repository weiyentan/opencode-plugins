/**
 * code.ts — REST-based code search tool for the GitHub plugin.
 *
 * Provides a tool for searching code across GitHub repositories via the REST API.
 * Uses the existing getGitHubClient() HTTP client through the middleware pipeline
 * in client.ts.
 *
 * ## Tool
 *
 * - **github.code.search** — Search code across repositories (query, language, repo, path qualifiers)
 *
 * ## Design
 *
 * The tool extracts curated fields from the REST API response and includes
 * the full `_raw` response in metadata. Search qualifiers (language, repo, path)
 * can be provided as separate arguments and are appended to the query.
 */

import { tool } from "@opencode-ai/plugin";
import type { GitHubClient } from "../client.js";

const z = tool.schema;

/* ── Response type helpers ──────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Format code search results as a Markdown summary string */
function formatCodeResults(items: any[], totalCount: number, query: string): string {
  if (items.length === 0) return `No code results found for "${query}".`;
  return [
    `## Code Search Results`,
    `Query: \`${query}\` | Total: ${totalCount} results`,
    ``,
    ...items.map((item, i) => {
      const repoFullName = item.repository?.full_name ?? "unknown";
      const fileUrl = item.html_url ?? "#";
      return `${i + 1}. [\`${item.path}\`](<${fileUrl}>) in [${repoFullName}](<https://github.com/${repoFullName}>)` +
        `${item.matches && item.matches.length > 0 ? ` (${item.matches.length} match${item.matches.length > 1 ? "es" : ""})` : ""}`;
    }),
  ].join("\n");
}

/* ── Tool Factory ───────────────────────────────────────────────── */

/**
 * Create the code search tool.
 *
 * @param getClient  Async factory that returns the GitHub HTTP client
 * @returns A record of tool name → registered tool object
 */
export function createCodeTools(
  getClient: () => Promise<GitHubClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── github.code.search ─────────────────────────────────────── */

    "github.code.search": tool({
      description: [
        "Search for code across GitHub repositories.",
        "Supports qualifiers for language, repository, and file path.",
        "Uses the GitHub code search API.",
      ].join(" "),
      args: {
        query: z
          .string()
          .min(1)
          .describe("Search query (same syntax as GitHub code search)."),
        language: z
          .string()
          .optional()
          .describe("Filter by language (e.g., 'typescript', 'python', 'go')."),
        repo: z
          .string()
          .optional()
          .describe("Filter to a specific repository (format: owner/name)."),
        path: z
          .string()
          .optional()
          .describe("Filter by file path (e.g., 'src/', '*.ts')."),
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
          language?: string;
          repo?: string;
          path?: string;
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

        // Build search query with qualifiers
        let searchQuery = args.query;
        if (args.language) searchQuery += `+language:${encodeURIComponent(args.language)}`;
        if (args.repo) searchQuery += `+repo:${encodeURIComponent(args.repo)}`;
        if (args.path) searchQuery += `+path:${encodeURIComponent(args.path)}`;

        const params = new URLSearchParams();
        params.set("q", searchQuery);
        if (args.perPage) params.set("per_page", String(args.perPage));
        if (args.page) params.set("page", String(args.page));

        const path = `/search/code?${params.toString()}`;

        let response: Response;
        try {
          response = await client.request("code.search", path, undefined, context.abort);
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

          // GitHub may return 422 for code search when the query has issues
          if (response.status === 422) {
            const errors = errorBody.errors
              ? errorBody.errors.map((e: any) => `- ${e.message}`).join("\n")
              : errorBody.message ?? "Invalid search query.";
            return {
              output: `Invalid code search query:\n${errors}`,
              metadata: { _raw: errorBody },
            };
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

        const curated = items.map((item: any) => ({
          name: item.name,
          path: item.path,
          sha: item.sha ?? null,
          url: item.html_url,
          gitUrl: item.git_url ?? null,
          repository: item.repository
            ? {
                fullName: item.repository.full_name ?? null,
                url: item.repository.html_url ?? null,
              }
            : null,
          score: item.score ?? null,
          textMatches: (item.text_matches ?? []).map((m: any) => ({
            fragment: m.fragment ?? null,
            property: m.property ?? null,
          })),
        }));

        return {
          output: formatCodeResults(items, searchResult.total_count ?? 0, args.query),
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
