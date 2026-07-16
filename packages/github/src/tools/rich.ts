/**
 * rich.ts — GraphQL-powered rich data tools for the GitHub plugin.
 *
 * Provides tools that combine multiple data sources into single GraphQL
 * round-trips, minimizing API calls and returning curated output with
 * full `_raw` fallback.
 *
 * ## Tools
 *
 * - **github_issue_get_full** &mdash; Issue with body, labels, comments,
 *   linked PRs, and timeline events in one query.
 * - **github_pr_get_full** &mdash; PR with commits, reviews, review threads,
 *   merge status, and CI status in one query.
 * - **github_issue_search** &mdash; Cross-repo issue search with rich
 *   results including repo context.
 * - **github_repo_get_full** &mdash; Repo with README, recent commits,
 *   and top contributors in one query.
 *
 * ## Design
 *
 * Each tool extracts curated fields from the GraphQL response and includes
 * the full `_raw` response in metadata. GraphQL schema errors are surfaced
 * as structured messages in the output string. Connection pagination uses
 * the standard edges/node/pageInfo model.
 */

import { tool } from "@opencode-ai/plugin";
import type { GitHubGraphQLClient } from "../graphql.js";

const z = tool.schema;

/* ── GraphQL Query Strings ─────────────────────────────────────── */

const ISSUE_FULL_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        number
        title
        body
        state
        url
        createdAt
        updatedAt
        closedAt
        author { login }
        labels(first: 20) {
          nodes { name color description }
        }
        comments(first: 10) {
          nodes { id body author { login } createdAt }
          pageInfo { hasNextPage endCursor }
        }
        timelineItems(first: 30) {
          nodes {
            __typename
            ... on CrossReferencedEvent {
              id
              createdAt
              actor { login }
              source {
                ... on Issue {
                  __typename
                  number title state
                  repository { owner { login } name }
                }
                ... on PullRequest {
                  __typename
                  number title state
                  repository { owner { login } name }
                }
              }
            }
            ... on ClosedEvent { id createdAt actor { login } }
            ... on ReopenedEvent { id createdAt actor { login } }
            ... on LabeledEvent { id createdAt actor { login } label { name color } }
            ... on AssignedEvent { id createdAt actor { login } user { login } }
            ... on UnassignedEvent { id createdAt actor { login } user { login } }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const PR_FULL_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        id
        number
        title
        body
        state
        url
        createdAt
        updatedAt
        closedAt
        mergedAt
        mergeable
        merged
        mergedBy { login }
        author { login }
        baseRefName
        headRefName
        headRefOid
        additions
        deletions
        changedFiles
        labels(first: 20) {
          nodes { name color }
        }
        commits(first: 30) {
          nodes {
            commit {
              oid
              messageHeadline
              committedDate
              author { user { login } name }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
        reviews(first: 10) {
          nodes {
            id
            body
            state
            author { login }
            createdAt
          }
          pageInfo { hasNextPage endCursor }
        }
        reviewThreads(first: 10) {
          nodes {
            id
            isResolved
            comments(first: 5) {
              nodes { id body author { login } path }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
        # Latest commit CI status
        latestCommit: commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 20) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state description targetUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const ISSUE_SEARCH_QUERY = `
  query($query: String!, $first: Int!) {
    search(query: $query, type: ISSUE, first: $first) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on Issue {
          id
          number
          title
          body
          state
          url
          createdAt
          updatedAt
          author { login }
          labels(first: 10) {
            nodes { name color }
          }
          repository { owner { login } name }
          comments { totalCount }
        }
      }
    }
  }
`;

const REPO_FULL_QUERY = `
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      id
      name
      owner { login }
      description
      url
      homepageUrl
      createdAt
      updatedAt
      pushedAt
      primaryLanguage { name color }
      languages(first: 10) { nodes { name color } }
      stargazerCount
      forkCount
      openIssueCount: issues(states: OPEN) { totalCount }
      openPRCount: pullRequests(states: OPEN) { totalCount }
      readme: object(expression: "HEAD:README.md") {
        ... on Blob { text }
      }
      rootTree: object(expression: "HEAD:") {
        ... on Tree {
          entries {
            name
            type
          }
        }
      }
      defaultBranchRef {
        target {
          ... on Commit {
            history(first: 10) {
              nodes {
                oid
                messageHeadline
                committedDate
                author { name user { login } }
              }
            }
          }
        }
      }
      mentionableUsers(first: 10) {
        nodes { login avatarUrl }
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

/** Extract the first item from a GraphQL connection */
function firstNodeOf(connection: any): any | undefined {
  const items = nodesOf(connection);
  return items.length > 0 ? items[0] : undefined;
}

/** Truncate a string to a maximum length, appending "..." if truncated */
function truncate(str: string | null | undefined, maxLen: number): string | null {
  if (str == null) return null;
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

/* ── Tool Factories ─────────────────────────────────────────────── */

/**
 * Create the four rich GraphQL tools.
 *
 * @param getGQL  Async factory that returns the GitHub GraphQL client
 * @returns A record of tool name → registered tool object
 */
export function createRichTools(
  getGQL: () => Promise<GitHubGraphQLClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── github_issue_get_full ────────────────────────────────── */

    "github_issue_get_full": tool({
      description: [
        "Fetch a single GitHub issue with full details: body, labels,",
        "comments (first 10), linked pull requests, and timeline events.",
        "All data comes from a single GraphQL query.",
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

        let gql: GitHubGraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(ISSUE_FULL_QUERY, {
          owner: args.owner,
          repo: args.repo,
          number: args.issueNumber,
        });

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.type ? `[${e.type}] ` : ""}${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const issue = (result.data as any)?.repository?.issue;

        // Handle issue not found
        if (!issue) {
          return {
            output: [
              `Issue #${args.issueNumber} not found in`,
              `${args.owner}/${args.repo}.`,
              "Verify the issue number and repository name.",
            ].join(" "),
            metadata: { _raw: result.data },
          };
        }

        // Extract linked PRs from timeline events
        const timelineNodes = nodesOf(issue.timelineItems);
        const linkedPRs = timelineNodes
          .filter(
            (n: any) =>
              n.__typename === "CrossReferencedEvent" &&
              n.source?.__typename === "PullRequest",
          )
          .map((n: any) => ({
            number: n.source.number,
            title: n.source.title,
            state: n.source.state,
            repository: `${n.source.repository.owner.login}/${n.source.repository.name}`,
            createdAt: n.createdAt,
            actor: n.actor?.login ?? null,
          }));

        // Build curated output
        const curated = {
          issue: {
            number: issue.number,
            title: issue.title,
            body: issue.body ?? null,
            state: issue.state,
            url: issue.url,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            closedAt: issue.closedAt ?? null,
            author: issue.author?.login ?? null,
          },
          labels: nodesOf(issue.labels).map((l: any) => ({
            name: l.name,
            color: l.color ?? null,
            description: l.description ?? null,
          })),
          comments: issue.comments ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          linkedPRs,
          timelineEvents: {
            nodes: timelineNodes.map((n: any) => ({
              __typename: n.__typename,
              id: n.id,
              createdAt: n.createdAt,
              ...(n.actor ? { actor: n.actor.login } : {}),
              ...(n.label ? { label: { name: n.label.name, color: n.label.color } } : {}),
              ...(n.user ? { user: n.user.login } : {}),
              ...(n.source ? { source: n.source } : {}),
            })),
            pageInfo: issue.timelineItems?.pageInfo ?? { hasNextPage: false, endCursor: null },
          },
        };

        // Format summary string
        const labelStr =
          curated.labels.length > 0
            ? curated.labels.map((l) => l.name).join(", ")
            : "(none)";
        const commentCount = curated.comments.nodes?.length ?? 0;
        const prCount = linkedPRs.length;

        const bodyStr = curated.issue.body ?? "(no body)";

        return {
          output: [
            `Issue #${curated.issue.number}: ${curated.issue.title}`,
            `  State:     ${curated.issue.state}`,
            `  Author:    ${curated.issue.author}`,
            `  Labels:    ${labelStr}`,
            `  Body:      ${bodyStr}`,
            `  Comments:  ${commentCount}`,
            `  Linked PRs: ${prCount}`,
            `  Created:   ${curated.issue.createdAt}`,
            `  Updated:   ${curated.issue.updatedAt}`,
            `  URL:       ${curated.issue.url}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: result.data,
          },
        };
      },
    }),

    /* ── github_pr_get_full ───────────────────────────────────── */

    "github_pr_get_full": tool({
      description: [
        "Fetch a single GitHub pull request with full details: commits,",
        "reviews, review threads, merge status, and CI status.",
        "All data comes from a single GraphQL query.",
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

        let gql: GitHubGraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(PR_FULL_QUERY, {
          owner: args.owner,
          repo: args.repo,
          number: args.prNumber,
        });

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.type ? `[${e.type}] ` : ""}${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const pr = (result.data as any)?.repository?.pullRequest;

        // Handle PR not found
        if (!pr) {
          return {
            output: [
              `Pull request #${args.prNumber} not found in`,
              `${args.owner}/${args.repo}.`,
              "Verify the PR number and repository name.",
            ].join(" "),
            metadata: { _raw: result.data },
          };
        }

        // Extract CI status from latest commit
        const latestCommit = firstNodeOf(pr.latestCommit);
        const rollup = latestCommit?.commit?.statusCheckRollup;
        const ciStatus = rollup
          ? {
              state: rollup.state,
              contexts: nodesOf(rollup.contexts).map((c: any) => ({
                __typename: c.__typename,
                ...(c.__typename === "CheckRun"
                  ? { name: c.name, status: c.status, conclusion: c.conclusion, detailsUrl: c.detailsUrl }
                  : { context: c.context, state: c.state, description: c.description, targetUrl: c.targetUrl }),
              })),
            }
          : null;

        const curated = {
          pr: {
            number: pr.number,
            title: pr.title,
            body: pr.body ?? null,
            state: pr.state,
            url: pr.url,
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            closedAt: pr.closedAt ?? null,
            mergedAt: pr.mergedAt ?? null,
            mergeable: pr.mergeable ?? null,
            merged: pr.merged ?? false,
            mergedBy: pr.mergedBy?.login ?? null,
            author: pr.author?.login ?? null,
            baseRefName: pr.baseRefName ?? null,
            headRefName: pr.headRefName ?? null,
            headRefOid: pr.headRefOid ?? null,
            additions: pr.additions ?? 0,
            deletions: pr.deletions ?? 0,
            changedFiles: pr.changedFiles ?? 0,
          },
          labels: nodesOf(pr.labels).map((l: any) => ({
            name: l.name,
            color: l.color ?? null,
          })),
          commits: pr.commits ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          reviews: pr.reviews ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          reviewThreads: pr.reviewThreads ?? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          ciStatus,
        };

        const labelStr =
          curated.labels.length > 0
            ? curated.labels.map((l) => l.name).join(", ")
            : "(none)";
        const reviewCount = curated.reviews.nodes?.length ?? 0;
        const commitCount = curated.commits.nodes?.length ?? 0;

        return {
          output: [
            `PR #${curated.pr.number}: ${curated.pr.title}`,
            `  State:     ${curated.pr.state}`,
            `  Author:    ${curated.pr.author}`,
            `  Base:      ${curated.pr.baseRefName} ← ${curated.pr.headRefName}`,
            `  Labels:    ${labelStr}`,
            `  Reviews:   ${reviewCount}`,
            `  Commits:   ${commitCount}`,
            `  Changes:   +${curated.pr.additions} -${curated.pr.deletions} (${curated.pr.changedFiles} files)`,
            `  Mergeable: ${curated.pr.mergeable}`,
            `  CI:        ${curated.ciStatus ? curated.ciStatus.state : "N/A"}`,
            `  Created:   ${curated.pr.createdAt}`,
            `  URL:       ${curated.pr.url}`,
          ].join("\n"),
          metadata: {
            ...curated,
            _raw: result.data,
          },
        };
      },
    }),

    /* ── github_issue_search ──────────────────────────────────── */

    "github_issue_search": tool({
      description: [
        "Search for GitHub issues across repositories.",
        "Returns rich results with repo context, labels, and comment counts.",
        "Powered by the GitHub GraphQL search API.",
      ].join(" "),
      args: {
        query: z
          .string()
          .min(1)
          .describe("Search query (same syntax as GitHub issue search)."),
        first: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Number of results to return (max 100, default 20)."),
      },
      async execute(
        args: { query: string; first?: number },
        context: { abort?: AbortSignal },
      ) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let gql: GitHubGraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(ISSUE_SEARCH_QUERY, {
          query: args.query,
          first: args.first ?? 20,
        });

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.type ? `[${e.type}] ` : ""}${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const search = (result.data as any)?.search;
        const issueCount = search?.issueCount ?? 0;
        const searchNodes = nodesOf(search);

        const results = searchNodes.map((n: any) => ({
          number: n.number,
          title: n.title,
          state: n.state,
          url: n.url,
          repository: `${n.repository?.owner?.login ?? "?"}/${n.repository?.name ?? "?"}`,
          author: n.author?.login ?? null,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          labels: nodesOf(n.labels).map((l: any) => ({ name: l.name, color: l.color })),
          commentCount: n.comments?.totalCount ?? 0,
        }));

        // Build summary string
        const summary = [
          `Search results for "${args.query}": ${issueCount} total issues`,
          `Showing ${results.length} result(s):`,
          "",
          ...results.map(
            (r: any, i: number) =>
              `${i + 1}. [${r.state}] #${r.number} ${r.title} (${r.repository})`
          ),
        ].join("\n");

        return {
          output: summary,
          metadata: {
            issueCount,
            pageInfo: search?.pageInfo ?? { hasNextPage: false, endCursor: null },
            results,
            _raw: result.data,
          },
        };
      },
    }),

    /* ── github_repo_get_full ─────────────────────────────────── */

    "github_repo_get_full": tool({
      description: [
        "Fetch a GitHub repository with full details: description, languages,",
        "README summary, recent commits, top contributors, and stats.",
        "All data comes from a single GraphQL query.",
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

        let gql: GitHubGraphQLClient;
        try {
          gql = await getGQL();
        } catch (err) {
          return {
            output: err instanceof Error ? err.message : String(err),
          };
        }

        const result = await gql.request(REPO_FULL_QUERY, {
          owner: args.owner,
          repo: args.repo,
        });

        // Handle GraphQL errors
        if (result.errors && result.errors.length > 0) {
          const messages = result.errors
            .map((e) => `- ${e.type ? `[${e.type}] ` : ""}${e.message}`)
            .join("\n");
          return {
            output: `GraphQL errors:\n${messages}`,
            metadata: { _raw: result },
          };
        }

        const repo = (result.data as any)?.repository;

        // Handle repo not found
        if (!repo) {
          return {
            output: [
              `Repository "${args.owner}/${args.repo}" not found.`,
              "Verify the owner and repository name.",
            ].join(" "),
            metadata: { _raw: result.data },
          };
        }

        // Extract README text (first 5000 chars)
        const readmeText = repo.readme?.text ?? null;

        // Extract root file tree entries
        const rootTree = (repo.rootTree?.entries ?? []).map((e: any) => ({
          name: e.name,
          type: e.type,
        }));

        // Extract recent commits
        const commitHistory = repo.defaultBranchRef?.target?.history;
        const recentCommits = nodesOf(commitHistory).map((c: any) => ({
          oid: c.oid,
          message: c.messageHeadline,
          committedDate: c.committedDate,
          author: c.author?.user?.login ?? c.author?.name ?? null,
        }));

        // Extract top contributors
        const topContributors = nodesOf(repo.mentionableUsers).map((u: any) => ({
          login: u.login,
          avatarUrl: u.avatarUrl,
        }));

        // Languages
        const languages = nodesOf(repo.languages).map((l: any) => ({
          name: l.name,
          color: l.color ?? null,
        }));

        const curated = {
          name: repo.name,
          owner: repo.owner?.login ?? null,
          description: repo.description ?? null,
          url: repo.url,
          homepageUrl: repo.homepageUrl ?? null,
          createdAt: repo.createdAt,
          updatedAt: repo.updatedAt,
          pushedAt: repo.pushedAt,
          primaryLanguage: repo.primaryLanguage?.name ?? null,
          languages,
          stats: {
            stars: repo.stargazerCount ?? 0,
            forks: repo.forkCount ?? 0,
            openIssues: repo.openIssueCount?.totalCount ?? 0,
            openPRs: repo.openPRCount?.totalCount ?? 0,
          },
          readme: truncate(readmeText, 5000),
          rootTree,
          recentCommits,
          topContributors,
        };

        const commitCount = curated.recentCommits.length;
        const contributorCount = curated.topContributors.length;
        const fileTreeStr =
          rootTree.length > 0
            ? rootTree
                .map((e: any) => (e.type === "tree" ? `${e.name}/` : e.name))
                .join(", ")
            : "(empty)";

        return {
          output: [
            `Repository: ${curated.owner}/${curated.name}`,
            `  Description: ${curated.description ?? "(none)"}`,
            `  Primary Language: ${curated.primaryLanguage ?? "N/A"}`,
            `  Languages: ${curated.languages.map((l) => l.name).join(", ")}`,
            `  Stars: ${curated.stats.stars}  Forks: ${curated.stats.forks}`,
            `  Open Issues: ${curated.stats.openIssues}  Open PRs: ${curated.stats.openPRs}`,
            `  Recent Commits: ${commitCount}`,
            `  Top Contributors: ${contributorCount}`,
            `  File Tree: ${fileTreeStr}`,
            `  README: ${readmeText ? truncate(readmeText, 1000) : "(none)"}`,
            `  Pushed: ${curated.pushedAt}`,
            `  URL: ${curated.url}`,
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
