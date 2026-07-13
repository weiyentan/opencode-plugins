/**
 * rich.ts — GraphQL-powered rich data tools for the GitLab plugin.
 *
 * Provides tools that combine multiple data sources into single GraphQL
 * round-trips, minimizing API calls and returning curated output with
 * full `_raw` fallback.
 *
 * ## Tools
 *
 * - **gitlab.issue.get-full** &mdash; Issue with description, labels, notes,
 *   linked MRs, and resource events in one query.
 * - **gitlab.mr.get-full** &mdash; MR with commits, discussions, pipelines,
 *   merge status, and approvals in one query.
 * - **gitlab.issue.search** &mdash; Cross-project issue search with rich
 *   results including project context.
 * - **gitlab.project.get-full** &mdash; Project with description, languages,
 *   README, recent commits, and top contributors in one query.
 *
 * ## Design
 *
 * Each tool extracts curated fields from the GraphQL response and includes
 * the full `_raw` response in metadata. GraphQL schema errors are surfaced
 * as structured messages in the output string. Connection pagination uses
 * the standard edges/node/pageInfo model.
 */

import { tool } from "@opencode-ai/plugin";
import type { GraphQLClient } from "../graphql.js";

const z = tool.schema;

/* ── GraphQL Query Strings ─────────────────────────────────────── */

const ISSUE_FULL_QUERY = `
  query($fullPath: ID!, $iid: String!) {
    project(fullPath: $fullPath) {
      id
      fullPath
      issue(iid: $iid) {
        id
        iid
        title
        description
        state
        webUrl
        createdAt
        updatedAt
        closedAt
        author { username name }
        labels(first: 20) {
          nodes { title color description }
        }
        notes(first: 15) {
          nodes { id body author { username } createdAt system }
          pageInfo { hasNextPage endCursor }
        }
        mergeRequests(first: 5) {
          nodes { iid title state webUrl }
        }
      }
    }
  }
`;

const MR_FULL_QUERY = `
  query($fullPath: ID!, $iid: String!) {
    project(fullPath: $fullPath) {
      id
      fullPath
      mergeRequest(iid: $iid) {
        id
        iid
        title
        description
        state
        webUrl
        createdAt
        updatedAt
        closedAt
        mergedAt
        mergeStatusEnum
        mergeError
        sourceBranch
        targetBranch
        diffStatsSummary {
          additions
          deletions
          fileCount
        }
        author { username name }
        labels(first: 20) {
          nodes { title color }
        }
        commits(first: 30) {
          nodes {
            sha
            title
            message
            authoredDate
            author { name email }
          }
          pageInfo { hasNextPage endCursor }
        }
        discussions(first: 10) {
          nodes {
            id
            resolved
            notes(first: 5) {
              nodes {
                id
                body
                author { username }
                createdAt
                system
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
        pipelines(first: 5) {
          nodes {
            id
            status
            ref
            createdAt
            stages {
              nodes {
                name
                status
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
        approvedBy(first: 10) {
          nodes { username name }
        }
      }
    }
  }
`;

const ISSUE_SEARCH_QUERY = `
  query($search: String!, $first: Int!) {
    projects(search: $search, first: $first) {
      nodes {
        id
        fullPath
        name
        description
        webUrl
        issues(first: 5) {
          nodes {
            iid
            title
            description
            state
            webUrl
            createdAt
            updatedAt
            author { username }
            labels(first: 5) {
              nodes { title color }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PROJECT_FULL_QUERY = `
  query($fullPath: ID!) {
    project(fullPath: $fullPath) {
      id
      name
      fullPath
      description
      webUrl
      avatarUrl
      createdAt
      updatedAt
      lastActivityAt
      starCount
      forksCount
      openIssuesCount
      visibility
      languages {
        name
        share
      }
      repository {
        rootRef
        tree(ref: "HEAD", path: "/") {
          blobs(first: 20) {
            nodes { name type }
          }
        }
        blobs(paths: ["README.md"]) {
          nodes {
            name
            rawTextBlob
          }
        }
      }
    }
  }
`;

/* ── Response type helpers ──────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Extract an array safely from a GraphQL connection */
function nodesOf(connection: any): any[] {
  if (!connection || !Array.isArray(connection.nodes)) return [];
  return connection.nodes;
}

/** Truncate a string to a maximum length, appending "..." if truncated */
function truncate(str: string | null | undefined, maxLen: number): string | null {
  if (str == null) return null;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

/** Get a summary string for an MR merge status */
function mergeStatusLabel(status: string | null | undefined): string {
  if (!status) return "unknown";
  const map: Record<string, string> = {
    CAN_BE_MERGED: "can be merged",
    CANNOT_BE_MERGED: "cannot be merged",
    CHECKING: "checking...",
    UNCHECKED: "unchecked",
    CI_MUST_PASS: "CI must pass",
    CI_STILL_RUNNING: "CI still running",
    DISCUSSIONS_NOT_RESOLVED: "discussions not resolved",
    DRAFT_STATUS: "draft",
    BLOCKED_STATUS: "blocked",
    NEED_REBASE: "needs rebase",
  };
  return map[status] ?? status;
}

/* ── Tool Factories ─────────────────────────────────────────────── */

/**
 * Create the four rich GraphQL tools.
 *
 * @param getGQL  Async factory that returns the GitLab GraphQL client
 * @returns A record of tool name → registered tool object
 */
export function createRichTools(
  getGQL: () => Promise<GraphQLClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── gitlab.issue.get-full ────────────────────────────────── */

    "gitlab.issue.get-full": tool({
      description: [
        "Fetch a single GitLab issue with full details: description, labels,",
        "notes (comments, first 15), linked merge requests, and system events.",
        "All data comes from a single GraphQL query.",
      ].join(" "),
      args: {
        projectPath: z
          .string()
          .min(1)
          .describe("Project full path (e.g., 'group/subgroup/project')."),
        iid: z
          .string()
          .min(1)
          .describe("Issue IID (e.g., '42')."),
      },
      async execute(
        args: { projectPath: string; iid: string },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let gql: GraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(
          ISSUE_FULL_QUERY,
          {
            fullPath: args.projectPath,
            iid: args.iid,
          },
          context.abort,
        );

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const project = (result.data as any)?.project;
        const issue = project?.issue;

        // Handle issue not found
        if (!issue) {
          return {
            output: [
              `Issue #${args.iid} not found in ${args.projectPath}.`,
              "Verify the issue IID and project path.",
            ].join(" "),
            metadata: { _raw: result.data },
          };
        }

        // Extract linked MRs
        const linkedMRs = nodesOf(issue.mergeRequests).map((m: any) => ({
          iid: m.iid,
          title: m.title,
          state: m.state,
          webUrl: m.webUrl,
        }));

        // Build curated output
        const curated = {
          issue: {
            iid: issue.iid,
            title: issue.title,
            description: issue.description ?? null,
            state: issue.state,
            webUrl: issue.webUrl,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            closedAt: issue.closedAt ?? null,
            author: issue.author?.username ?? null,
            authorName: issue.author?.name ?? null,
          },
          labels: nodesOf(issue.labels).map((l: any) => ({
            title: l.title,
            color: l.color ?? null,
            description: l.description ?? null,
          })),
          notes: issue.notes ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          linkedMRs,
        };

        const labelStr =
          curated.labels.length > 0
            ? curated.labels.map((l) => l.title).join(", ")
            : "(none)";
        const noteCount = curated.notes.nodes?.length ?? 0;
        const mrCount = linkedMRs.length;

        return {
          output: [
            `Issue #${curated.issue.iid}: ${curated.issue.title}`,
            `  State:     ${curated.issue.state}`,
            `  Author:    ${curated.issue.author}`,
            `  Labels:    ${labelStr}`,
            `  Notes:     ${noteCount}`,
            `  Linked MRs: ${mrCount}`,
            `  Created:   ${curated.issue.createdAt}`,
            `  Updated:   ${curated.issue.updatedAt}`,
            `  URL:       ${curated.issue.webUrl}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: result.data,
          },
        };
      },
    }),

    /* ── gitlab.mr.get-full ───────────────────────────────────── */

    "gitlab.mr.get-full": tool({
      description: [
        "Fetch a single GitLab merge request with full details: commits (first 30),",
        "discussions, pipelines, merge status, approvals, and diff stats.",
        "All data comes from a single GraphQL query.",
      ].join(" "),
      args: {
        projectPath: z
          .string()
          .min(1)
          .describe("Project full path (e.g., 'group/subgroup/project')."),
        iid: z
          .string()
          .min(1)
          .describe("Merge request IID (e.g., '7')."),
      },
      async execute(
        args: { projectPath: string; iid: string },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let gql: GraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(
          MR_FULL_QUERY,
          {
            fullPath: args.projectPath,
            iid: args.iid,
          },
          context.abort,
        );

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const project = (result.data as any)?.project;
        const mr = project?.mergeRequest;

        // Handle MR not found
        if (!mr) {
          return {
            output: [
              `Merge request #${args.iid} not found in ${args.projectPath}.`,
              "Verify the MR IID and project path.",
            ].join(" "),
            metadata: { _raw: result.data },
          };
        }

        // Extract diff stats summary
        const diffStats = mr.diffStatsSummary
          ? {
              additions: mr.diffStatsSummary.additions ?? 0,
              deletions: mr.diffStatsSummary.deletions ?? 0,
              fileCount: mr.diffStatsSummary.fileCount ?? 0,
            }
          : null;

        // Extract approvals
        const approvals = nodesOf(mr.approvedBy).map((u: any) => ({
          username: u.username,
          name: u.name ?? null,
        }));

        // Extract pipeline status
        const pipelines = nodesOf(mr.pipelines).map((p: any) => ({
          id: p.id,
          status: p.status,
          ref: p.ref ?? null,
          createdAt: p.createdAt,
          stages: nodesOf(p.stages).map((s: any) => ({
            name: s.name,
            status: s.status,
          })),
        }));

        const curated = {
          mr: {
            iid: mr.iid,
            title: mr.title,
            description: mr.description ?? null,
            state: mr.state,
            webUrl: mr.webUrl,
            createdAt: mr.createdAt,
            updatedAt: mr.updatedAt,
            closedAt: mr.closedAt ?? null,
            mergedAt: mr.mergedAt ?? null,
            mergeStatus: mr.mergeStatusEnum ?? null,
            mergeError: mr.mergeError ?? null,
            sourceBranch: mr.sourceBranch ?? null,
            targetBranch: mr.targetBranch ?? null,
            author: mr.author?.username ?? null,
            authorName: mr.author?.name ?? null,
            diffStats,
          },
          labels: nodesOf(mr.labels).map((l: any) => ({
            title: l.title,
            color: l.color ?? null,
          })),
          commits: mr.commits ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          discussions: mr.discussions ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          pipelines,
          approvals,
        };

        const labelStr =
          curated.labels.length > 0
            ? curated.labels.map((l) => l.title).join(", ")
            : "(none)";
        const commitCount = curated.commits.nodes?.length ?? 0;
        const discussionCount = curated.discussions.nodes?.length ?? 0;
        const pipelineCount = pipelines.length;
        const statusLabel = mergeStatusLabel(curated.mr.mergeStatus);

        return {
          output: [
            `MR #${curated.mr.iid}: ${curated.mr.title}`,
            `  State:      ${curated.mr.state}`,
            `  Author:     ${curated.mr.author}`,
            `  Branches:   ${curated.mr.sourceBranch} → ${curated.mr.targetBranch}`,
            `  Labels:     ${labelStr}`,
            `  Status:     ${statusLabel}`,
            `  Pipelines:  ${pipelineCount}`,
            `  Commits:    ${commitCount}`,
            `  Discussions: ${discussionCount}`,
            `  Approvals:  ${approvals.length}`,
            `  Changes:    ${diffStats ? `+${diffStats.additions} -${diffStats.deletions} (${diffStats.fileCount} files)` : "N/A"}`,
            `  Created:    ${curated.mr.createdAt}`,
            `  URL:        ${curated.mr.webUrl}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: result.data,
          },
        };
      },
    }),

    /* ── gitlab.issue.search ──────────────────────────────────── */

    "gitlab.issue.search": tool({
      description: [
        "Search for GitLab issues across projects.",
        "Returns rich results with project context, labels, and linked info.",
        "Powered by the GitLab GraphQL API — searches projects by name/description",
        "and returns their recent issues.",
      ].join(" "),
      args: {
        query: z
          .string()
          .min(1)
          .describe("Search query to find projects (by name or path)."),
        first: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .default(10)
          .describe("Number of projects to search (default 10, max 50)."),
      },
      async execute(
        args: { query: string; first?: number },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let gql: GraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(
          ISSUE_SEARCH_QUERY,
          {
            search: args.query,
            first: args.first ?? 10,
          },
          context.abort,
        );

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const projectsData = (result.data as any)?.projects;
        const projectNodes = nodesOf(projectsData);

        // Flatten issues from all projects
        type SearchResultIssue = {
          iid: string;
          title: string;
          state: string;
          webUrl: string;
          projectPath: string;
          projectName: string;
          author: string | null;
          createdAt: string;
          updatedAt: string;
          labels: Array<{ title: string; color: string | null }>;
        };

        const allIssues: SearchResultIssue[] = [];
        for (const proj of projectNodes) {
          const issueNodes = nodesOf(proj.issues);
          for (const iss of issueNodes) {
            allIssues.push({
              iid: iss.iid,
              title: iss.title,
              state: iss.state,
              webUrl: iss.webUrl,
              projectPath: proj.fullPath,
              projectName: proj.name,
              author: iss.author?.username ?? null,
              createdAt: iss.createdAt,
              updatedAt: iss.updatedAt,
              labels: nodesOf(iss.labels).map((l: any) => ({
                title: l.title,
                color: l.color ?? null,
              })),
            });
          }
        }

        const projectCount = projectNodes.length;
        const issueCount = allIssues.length;

        // Build summary string
        const summary = [
          `Search results for "${args.query}": ${projectCount} project(s), ${issueCount} issue(s)`,
          "",
          ...allIssues.map(
            (r, i) =>
              `${i + 1}. [${r.state}] #${r.iid} ${r.title} (${r.projectPath})`,
          ),
          ...(projectNodes.length === 0
            ? ["No projects found matching your query."]
            : allIssues.length === 0
              ? ["No issues found in matching projects."]
              : []),
        ].join("\n");

        return {
          output: summary,
          metadata: {
            projectCount,
            issueCount,
            results: allIssues,
            pageInfo: projectsData?.pageInfo ?? { hasNextPage: false, endCursor: null },
            _raw: result.data,
          },
        };
      },
    }),

    /* ── gitlab.project.get-full ──────────────────────────────── */

    "gitlab.project.get-full": tool({
      description: [
        "Fetch a GitLab project with full details: description, languages,",
        "README summary, top-level file tree, recent activity, and stats.",
        "All data comes from a single GraphQL query.",
      ].join(" "),
      args: {
        projectPath: z
          .string()
          .min(1)
          .describe("Project full path (e.g., 'group/subgroup/project')."),
      },
      async execute(
        args: { projectPath: string },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let gql: GraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(
          PROJECT_FULL_QUERY,
          {
            fullPath: args.projectPath,
          },
          context.abort,
        );

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const repo = (result.data as any)?.project;

        // Handle project not found
        if (!repo) {
          return {
            output: [
              `Project "${args.projectPath}" not found.`,
              "Verify the project full path.",
            ].join(" "),
            metadata: { _raw: result.data },
          };
        }

        // Extract README text
        const readmeNodes = nodesOf(repo.repository?.blobs);
        const readmeContent = readmeNodes.length > 0
          ? (readmeNodes[0]?.rawTextBlob ?? null)
          : null;

        // Extract file tree (top-level blobs)
        const fileTree = nodesOf(repo.repository?.tree?.blobs).map((b: any) => ({
          name: b.name,
          type: b.type,
        }));

        // Extract languages
        const languages = Array.isArray(repo.languages)
          ? repo.languages.map((l: any) => ({
              name: l.name,
              share: l.share ?? null,
            }))
          : [];

        const curated = {
          name: repo.name,
          fullPath: repo.fullPath,
          description: repo.description ?? null,
          webUrl: repo.webUrl,
          avatarUrl: repo.avatarUrl ?? null,
          visibility: repo.visibility ?? null,
          createdAt: repo.createdAt,
          updatedAt: repo.updatedAt,
          lastActivityAt: repo.lastActivityAt ?? null,
          languages,
          stats: {
            stars: repo.starCount ?? 0,
            forks: repo.forksCount ?? 0,
            openIssues: repo.openIssuesCount ?? 0,
          },
          defaultBranch: repo.repository?.rootRef ?? null,
          readme: truncate(readmeContent, 5000),
          fileTree,
        };

        const fileTreeStr =
          fileTree.length > 0
            ? fileTree.map((f: any) => `  ${f.type === "tree" ? "📁" : "📄"} ${f.name}`).join("\n")
            : "  (none)";

        return {
          output: [
            `Project: ${curated.fullPath}`,
            `  Description: ${curated.description ?? "(none)"}`,
            `  Visibility:  ${curated.visibility ?? "N/A"}`,
            `  Default Branch: ${curated.defaultBranch ?? "N/A"}`,
            `  Languages:   ${languages.length > 0 ? languages.map((l: any) => `${l.name} (${(l.share * 100).toFixed(0)}%)`).join(", ") : "N/A"}`,
            `  Stars: ${curated.stats.stars}  Forks: ${curated.stats.forks}`,
            `  Open Issues: ${curated.stats.openIssues}`,
            `  README: ${readmeContent ? truncate(readmeContent, 100) : "(none)"}`,
            `  Top-level files:`,
            fileTreeStr,
            `  Last Activity: ${curated.lastActivityAt ?? "N/A"}`,
            `  URL: ${curated.webUrl}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: result.data,
          },
        };
      },
    }),
  };
}
