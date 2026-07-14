/**
 * projects.ts — Project tools for the GitLab plugin.
 *
 * Provides REST-based tools for working with GitLab projects:
 * get metadata and search.
 *
 * ## Tools
 *
 * - **gitlab_project_get** — Get project metadata (description, topics, language, stars, forks)
 * - **gitlab_project_search** — Search projects by query
 *
 * ## API Reference
 *
 * - GET /api/v4/projects/:id
 * - GET /api/v4/projects?search=...
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import type { GitLabClient } from "../client.js";

const z = tool.schema;

/* ── Response type helpers ─────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Curated project fields extracted from API response */
interface CuratedProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  visibility: string;
  topics: string[];
  default_branch: string | null;
  language: string | null;
  star_count: number;
  forks_count: number;
  open_issues_count: number;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  archived: boolean;
  owner: string | null;
  namespace: string | null;
  avatar_url: string | null;
  http_url_to_repo: string | null;
  ssh_url_to_repo: string | null;
  readme_url: string | null;
  tag_list: string[];
  packages_enabled: boolean;
  empty_repo: boolean;
}

/** Extract curated project fields from raw API response */
function extractProject(raw: any): CuratedProject {
  return {
    id: raw.id,
    name: raw.name ?? "",
    name_with_namespace: raw.name_with_namespace ?? raw.path_with_namespace ?? "",
    path_with_namespace: raw.path_with_namespace ?? "",
    description: raw.description ?? null,
    web_url: raw.web_url ?? "",
    visibility: raw.visibility ?? "private",
    topics: raw.topics ?? raw.tag_list ?? [],
    default_branch: raw.default_branch ?? null,
    language: raw.programming_language ?? null,
    star_count: raw.star_count ?? 0,
    forks_count: raw.forks_count ?? 0,
    open_issues_count: raw.open_issues_count ?? 0,
    created_at: raw.created_at ?? "",
    updated_at: raw.updated_at ?? "",
    last_activity_at: raw.last_activity_at ?? "",
    archived: raw.archived ?? false,
    owner: raw.owner?.username ?? raw.owner?.name ?? null,
    namespace: raw.namespace?.name ?? raw.namespace?.full_path ?? null,
    avatar_url: raw.avatar_url ?? null,
    http_url_to_repo: raw.http_url_to_repo ?? null,
    ssh_url_to_repo: raw.ssh_url_to_repo ?? null,
    readme_url: raw.readme_url ?? null,
    tag_list: raw.tag_list ?? [],
    packages_enabled: raw.packages_enabled ?? false,
    empty_repo: raw.empty_repo ?? true,
  };
}

/** Build a single project markdown summary line */
function projectSummaryLine(proj: CuratedProject, index: number): string {
  const topics =
    proj.topics.length > 0 ? ` [${proj.topics.join(", ")}]` : "";
  return (
    `${index}. **${proj.name_with_namespace}**` +
    ` | ${proj.visibility} | ⭐${proj.star_count} 🍴${proj.forks_count}` +
    `${topics}`
  );
}

/** Build a full project detail string */
function projectDetailString(proj: CuratedProject): string {
  const lines: string[] = [
    `**${proj.name_with_namespace}**`,
    ``,
    `- **ID:** ${proj.id}`,
    `- **Visibility:** ${proj.visibility}`,
    `- **Default Branch:** \`${proj.default_branch ?? "N/A"}\``,
    `- **Language:** ${proj.language ?? "N/A"}`,
  ];

  if (proj.topics.length > 0) {
    lines.push(`- **Topics:** ${proj.topics.join(", ")}`);
  }

  lines.push(
    `- **Stars:** ${proj.star_count}`,
    `- **Forks:** ${proj.forks_count}`,
    `- **Open Issues:** ${proj.open_issues_count}`,
    `- **Archived:** ${proj.archived ? "Yes" : "No"}`,
    `- **Empty Repo:** ${proj.empty_repo ? "Yes" : "No"}`,
    `- **Created:** ${proj.created_at}`,
    `- **Updated:** ${proj.updated_at}`,
    `- **Last Activity:** ${proj.last_activity_at}`,
  );

  if (proj.owner) {
    lines.push(`- **Owner:** ${proj.owner}`);
  }
  if (proj.namespace) {
    lines.push(`- **Namespace:** ${proj.namespace}`);
  }
  if (proj.http_url_to_repo) {
    lines.push(`- **HTTP URL:** ${proj.http_url_to_repo}`);
  }
  if (proj.ssh_url_to_repo) {
    lines.push(`- **SSH URL:** ${proj.ssh_url_to_repo}`);
  }

  if (proj.description) {
    const truncated =
      proj.description.length > 500
        ? proj.description.slice(0, 500) + "..."
        : proj.description;
    lines.push(``, `### Description`, ``);
    lines.push(truncated);
  }

  lines.push(``, `- **URL:** ${proj.web_url}`);

  return lines.join("\n");
}

/* ── Tool Factories ────────────────────────────────────────────── */

/**
 * Create project tools.
 *
 * @param getGitLabClient  Async factory for the GitLab REST client
 * @returns A record of tool name → registered tool object
 */
export function createProjectTools(
  getGitLabClient: () => Promise<GitLabClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── gitlab_project_get ───────────────────────────────────── */

    "gitlab_project_get": tool({
      description: [
        "Get a single GitLab project's metadata including description,",
        "topics, programming language, star/fork counts, visibility,",
        "and repository URLs.",
      ].join(" "),
      args: {
        project_id: z
          .union([z.string(), z.number()])
          .describe(
            "Project ID (number) or URL-encoded path (e.g., 'group/subgroup/project').",
          ),
      },
      async execute(
        args: { project_id: string | number },
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

        const path = `/api/v4/projects/${args.project_id}`;

        try {
          const response = await client.request(
            "gitlab_project_get",
            path,
            undefined,
            context.abort,
          );

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const msg = (body as any).message ?? response.statusText;
            return {
              output: `Failed to get project: HTTP ${response.status} — ${msg}`,
              metadata: { _raw: { status: response.status, body } },
            };
          }

          const raw = (await response.json()) as any;
          const curated = extractProject(raw);

          return {
            output: projectDetailString(curated),
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
          return { output: `Failed to get project: ${message}` };
        }
      },
    }),

    /* ── gitlab_project_search ────────────────────────────────── */

    "gitlab_project_search": tool({
      description: [
        "Search GitLab projects by query string.",
        "Returns projects matching the search with metadata.",
      ].join(" "),
      args: {
        query: z
          .string()
          .min(1)
          .describe("Search query for project name or description."),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Number of results per page (max 100, default 20)."),
        order_by: z
          .enum(["id", "name", "path", "created_at", "updated_at", "last_activity_at"])
          .optional()
          .default("last_activity_at")
          .describe("Sort order of results."),
        sort: z
          .enum(["asc", "desc"])
          .optional()
          .default("desc")
          .describe("Sort direction."),
        visibility: z
          .enum(["public", "internal", "private"])
          .optional()
          .describe("Filter by visibility level."),
      },
      async execute(
        args: {
          query: string;
          per_page?: number;
          order_by?: string;
          sort?: string;
          visibility?: string;
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

        const params = new URLSearchParams();
        params.set("search", args.query);
        params.set("per_page", String(args.per_page ?? 20));
        params.set("order_by", args.order_by ?? "last_activity_at");
        params.set("sort", args.sort ?? "desc");
        if (args.visibility) params.set("visibility", args.visibility);

        const path = `/api/v4/projects?${params.toString()}`;

        try {
          const response = await client.request(
            "gitlab_project_search",
            path,
            undefined,
            context.abort,
          );

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const msg = (body as any).message ?? response.statusText;
            return {
              output: `Failed to search projects: HTTP ${response.status} — ${msg}`,
              metadata: { _raw: { status: response.status, body } },
            };
          }

          const raw = (await response.json()) as any[];
          const projects = Array.isArray(raw) ? raw : [];

          if (projects.length === 0) {
            return {
              output: `No projects found matching "${args.query}".`,
            };
          }

          const curated = projects.map((p) => extractProject(p));
          const lines: string[] = [
            `## Project Search Results: "${args.query}" (${curated.length})`,
            ``,
          ];

          for (let i = 0; i < curated.length; i++) {
            lines.push(projectSummaryLine(curated[i]!, i + 1));
          }

          return {
            output: lines.join("\n"),
            metadata: {
              count: curated.length,
              query: args.query,
              results: curated,
              _raw: raw,
            },
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return { output: `Failed to search projects: ${message}` };
        }
      },
    }),
  };
}
