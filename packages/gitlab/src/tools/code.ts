/**
 * code.ts — Code search tool for the GitLab plugin.
 *
 * Provides a REST-based tool for searching code across GitLab projects.
 *
 * ## Tool
 *
 * - **gitlab_code_search** — Search code across projects by query
 *
 * ## API Reference
 *
 * - GET /api/v4/projects/:id/search?scope=blobs&search=...
 *
 * ## Design
 *
 * Uses GitLab's project-scoped search API with `scope=blobs` to search
 * code content. Supports filtering by project and language. Results
 * include file path, filename, and matching content preview.
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import type { GitLabClient } from "../client.js";
import { projectPathSegment } from "../project-path.js";

const z = tool.schema;

/* ── Response type helpers ─────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Curated code search result fields */
interface CuratedCodeResult {
  filename: string;
  path: string;
  ref: string;
  language: string | null;
  data: string;
  startline: number;
  project_id: number;
}

/** Extract curated code search result from raw API response */
function extractCodeResult(raw: any): CuratedCodeResult {
  return {
    filename: raw.filename ?? "",
    path: raw.path ?? "",
    ref: raw.ref ?? "",
    language: raw.language ?? null,
    data: raw.data ?? "",
    startline: raw.startline ?? 0,
    project_id: raw.project_id ?? 0,
  };
}

/** Build a code search result markdown line */
function codeResultLine(result: CuratedCodeResult, index: number): string {
  const content = result.data.length > 200
    ? result.data.slice(0, 200) + "..."
    : result.data;
  return (
    `${index}. **${result.path}** (${result.language ?? "unknown"})` +
    `\n   \`\`\`\n   ${content.replace(/\n/g, "\n   ")}\n   \`\`\``
  );
}

/* ── Tool Factory ──────────────────────────────────────────────── */

/**
 * Create the code search tool.
 *
 * @param getGitLabClient  Async factory for the GitLab REST client
 * @returns A record of tool name → registered tool object
 */
export function createCodeTools(
  getGitLabClient: () => Promise<GitLabClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── gitlab_code_search ──────────────────────────────────── */

    "gitlab_code_search": tool({
      description: [
        "Search code content across GitLab projects.",
        "Uses the GitLab project-scoped search API with scope=blobs.",
        "Filter by project ID and programming language.",
        "Returns file paths with matching code previews.",
      ].join(" "),
      args: {
        query: z
          .string()
          .min(1)
          .describe("Search query to find in code content."),
        project_id: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (number) or full path (e.g., 'group/subgroup/project') to search within.",
          ),
        language: z
          .string()
          .optional()
          .describe(
            "Filter results by programming language (e.g., 'python', 'typescript', 'go').",
          ),
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
          query: string;
          project_id: string | number;
          language?: string;
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

        const encodedId = projectPathSegment(args.project_id);
        const params = new URLSearchParams();
        params.set("scope", "blobs");
        params.set("search", args.query);
        params.set("per_page", String(args.per_page ?? 20));

        const path =
          `/api/v4/projects/${encodedId}/search?${params.toString()}`;

        try {
          const response = await client.request(
            "gitlab_code_search",
            path,
            undefined,
            context.abort,
          );

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const msg = (body as any).message ?? response.statusText;
            return {
              output: `Failed to search code: HTTP ${response.status} — ${msg}`,
              metadata: { _raw: { status: response.status, body } },
            };
          }

          const raw = (await response.json()) as any[];
          const results = Array.isArray(raw) ? raw : [];

          if (results.length === 0) {
            return {
              output: `No code results found for "${args.query}" in the specified project.`,
            };
          }

          let curated = results.map((r) => extractCodeResult(r));

          // Apply language filter if specified (client-side since GitLab search
          // doesn't natively support language filtering via query params)
          if (args.language) {
            const langLower = args.language.toLowerCase();
            curated = curated.filter(
              (r) => r.language?.toLowerCase() === langLower,
            );
          }

          if (curated.length === 0) {
            return {
              output: `No code results found for "${args.query}" matching language "${args.language}".`,
            };
          }

          const lines: string[] = [
            `## Code Search Results: "${args.query}" (${curated.length})`,
            ``,
          ];

          for (let i = 0; i < curated.length; i++) {
            lines.push(codeResultLine(curated[i]!, i + 1));
          }

          return {
            output: lines.join("\n"),
            metadata: {
              count: curated.length,
              query: args.query,
              project_id: args.project_id,
              language: args.language ?? null,
              results: curated,
              _raw: raw,
            },
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `Failed to search code: ${message}` };
        }
      },
    }),
  };
}
