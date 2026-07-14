/**
 * user.ts — REST-based user profile tool for the GitHub plugin.
 *
 * Provides a tool for retrieving the authenticated user's profile via the
 * GitHub REST API. Uses the existing getGitHubClient() HTTP client through
 * the middleware pipeline in client.ts.
 *
 * ## Tool
 *
 * - **github_user_get** — Get the current authenticated user's profile
 *
 * ## Design
 *
 * The tool extracts curated fields from the REST API response and includes
 * the full `_raw` response in metadata.
 */

import { tool } from "@opencode-ai/plugin";
import type { GitHubClient } from "../client.js";

/* ── Response type helpers ──────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Format user profile as a Markdown summary string */
function formatUserProfile(user: any): string {
  const lines = [
    `## ${user.login}`,
    ``,
  ];

  if (user.name) lines.push(`**Name:** ${user.name}`);
  if (user.email) lines.push(`**Email:** ${user.email}`);
  if (user.company) lines.push(`**Company:** ${user.company}`);
  if (user.location) lines.push(`**Location:** ${user.location}`);
  if (user.bio) lines.push(`**Bio:** ${user.bio}`);
  if (user.blog) lines.push(`**Website:** ${user.blog}`);
  if (user.twitter_username) lines.push(`**Twitter:** @${user.twitter_username}`);

  lines.push(``);
  lines.push(`**Public Repos:** ${user.public_repos}`);
  lines.push(`**Public Gists:** ${user.public_gists}`);
  lines.push(`**Followers:** ${user.followers}  **Following:** ${user.following}`);
  lines.push(`**Account Created:** ${user.created_at}`);
  lines.push(`**Profile Updated:** ${user.updated_at}`);
  lines.push(`**URL:** ${user.html_url}`);

  if (user.plan) {
    lines.push(``);
    lines.push(`**Plan:** ${user.plan.name} (${user.plan.monthly_collaborators ?? "N/A"} collaborators, ${user.plan.private_repos ?? "N/A"} private repos)`);
  }

  return lines.join("\n");
}

/* ── Tool Factory ───────────────────────────────────────────────── */

/**
 * Create the user profile tool.
 *
 * @param getClient  Async factory that returns the GitHub HTTP client
 * @returns A record of tool name → registered tool object
 */
export function createUserTools(
  getClient: () => Promise<GitHubClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── github_user_get ────────────────────────────────────────── */

    "github_user_get": tool({
      description: [
        "Get the current authenticated user's GitHub profile.",
        "Returns user metadata including name, email, company, location,",
        "bio, public repository count, follower/following counts, and plan info.",
      ].join(" "),
      args: {},
      async execute(
        _args: Record<string, never>,
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

        let response: Response;
        try {
          response = await client.request("github_user_get", "/user", undefined, context.abort);
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

          if (response.status === 401) {
            return {
              output: "Authentication failed. Your GitHub Personal Access Token (PAT) may be invalid or expired. Use the github-configure tool to update your token.",
              metadata: { _raw: errorBody },
            };
          }

          return {
            output: `GitHub API error (${response.status}): ${errorBody.message ?? response.statusText}`,
            metadata: { _raw: errorBody },
          };
        }

        let user: any;
        try {
          user = await response.json();
        } catch (err) {
          return {
            output: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
          };
        }

        const curated = {
          login: user.login,
          name: user.name ?? null,
          email: user.email ?? null,
          avatarUrl: user.avatar_url,
          url: user.html_url,
          company: user.company ?? null,
          location: user.location ?? null,
          bio: user.bio ?? null,
          blog: user.blog ?? null,
          twitterUsername: user.twitter_username ?? null,
          stats: {
            publicRepos: user.public_repos ?? 0,
            publicGists: user.public_gists ?? 0,
            followers: user.followers ?? 0,
            following: user.following ?? 0,
          },
          plan: user.plan
            ? {
                name: user.plan.name ?? null,
                collaborators: user.plan.monthly_collaborators ?? null,
                privateRepos: user.plan.private_repos ?? null,
                space: user.plan.space ?? null,
              }
            : null,
          createdAt: user.created_at,
          updatedAt: user.updated_at,
        };

        return {
          output: formatUserProfile(user),
          metadata: {
            ...curated,
            _raw: user,
          },
        };
      },
    }),
  };
}
