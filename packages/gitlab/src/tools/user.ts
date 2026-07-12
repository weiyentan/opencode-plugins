/**
 * user.ts — User profile tool for the GitLab plugin.
 *
 * Provides a REST-based tool for getting the current authenticated
 * user's profile information.
 *
 * ## Tool
 *
 * - **gitlab.user.get** — Get the current authenticated user's profile
 *
 * ## API Reference
 *
 * - GET /api/v4/user
 *
 * @module
 */

import { tool } from "@opencode-ai/plugin";
import type { GitLabClient } from "../client.js";

/* ── Response type helpers ─────────────────────────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Curated user profile fields extracted from API response */
interface CuratedUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  state: string;
  avatar_url: string | null;
  web_url: string;
  created_at: string;
  bio: string | null;
  location: string | null;
  public_email: string | null;
  skype: string | null;
  linkedin: string | null;
  twitter: string | null;
  website_url: string | null;
  organization: string | null;
  job_title: string | null;
  last_sign_in_at: string | null;
  confirmed_at: string | null;
  last_activity_on: string | null;
  current_sign_in_at: string | null;
  can_create_group: boolean | null;
  can_create_project: boolean | null;
  two_factor_enabled: boolean | null;
  is_admin: boolean | null;
  note: string | null;
  pronouns: string | null;
  bot: boolean;
  namespace_id: number | null;
}

/** Extract curated user fields from raw API response */
function extractUser(raw: any): CuratedUser {
  return {
    id: raw.id,
    username: raw.username ?? "",
    name: raw.name ?? "",
    email: raw.email ?? null,
    state: raw.state ?? "active",
    avatar_url: raw.avatar_url ?? null,
    web_url: raw.web_url ?? raw.web ?? "",
    created_at: raw.created_at ?? "",
    bio: raw.bio ?? null,
    location: raw.location ?? null,
    public_email: raw.public_email ?? null,
    skype: raw.skype ?? null,
    linkedin: raw.linkedin ?? null,
    twitter: raw.twitter ?? null,
    website_url: raw.website_url ?? null,
    organization: raw.organization ?? null,
    job_title: raw.job_title ?? null,
    last_sign_in_at: raw.last_sign_in_at ?? null,
    confirmed_at: raw.confirmed_at ?? null,
    last_activity_on: raw.last_activity_on ?? null,
    current_sign_in_at: raw.current_sign_in_at ?? null,
    can_create_group: raw.can_create_group ?? null,
    can_create_project: raw.can_create_project ?? null,
    two_factor_enabled: raw.two_factor_enabled ?? null,
    is_admin: raw.is_admin ?? null,
    note: raw.note ?? null,
    pronouns: raw.pronouns ?? null,
    bot: raw.bot ?? false,
    namespace_id: raw.namespace_id ?? null,
  };
}

/* ── Tool Factory ──────────────────────────────────────────────── */

/**
 * Create the user profile tool.
 *
 * @param getGitLabClient  Async factory for the GitLab REST client
 * @returns A record of tool name → registered tool object
 */
export function createUserTools(
  getGitLabClient: () => Promise<GitLabClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /* ── gitlab.user.get ─────────────────────────────────────── */

    "gitlab.user.get": tool({
      description: [
        "Get the current authenticated user's profile information.",
        "Returns username, name, email, avatar, bio, location,",
        "and account metadata from the GitLab API.",
      ].join(" "),
      args: {},
      async execute(
        _args: Record<string, never>,
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

        try {
          const response = await client.request(
            "gitlab.user.get",
            "/api/v4/user",
            undefined,
            context.abort,
          );

          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const msg = (body as any).message ?? response.statusText;
            return {
              output: `Failed to get user profile: HTTP ${response.status} — ${msg}`,
              metadata: { _raw: { status: response.status, body } },
            };
          }

          const raw = (await response.json()) as any;
          const curated = extractUser(raw);

          const lines: string[] = [
            `## User Profile: ${curated.name} (@${curated.username})`,
            ``,
            `- **ID:** ${curated.id}`,
            `- **Username:** ${curated.username}`,
            `- **Name:** ${curated.name}`,
            `- **State:** ${curated.state}`,
            `- **Email:** ${curated.email ?? "(not public)"}`,
            `- **Bot:** ${curated.bot ? "Yes" : "No"}`,
            `- **Created:** ${curated.created_at}`,
          ];

          if (curated.bio) {
            lines.push(`- **Bio:** ${curated.bio}`);
          }
          if (curated.location) {
            lines.push(`- **Location:** ${curated.location}`);
          }
          if (curated.job_title) {
            lines.push(`- **Job Title:** ${curated.job_title}`);
          }
          if (curated.organization) {
            lines.push(`- **Organization:** ${curated.organization}`);
          }
          if (curated.website_url) {
            lines.push(`- **Website:** ${curated.website_url}`);
          }
          if (curated.pronouns) {
            lines.push(`- **Pronouns:** ${curated.pronouns}`);
          }
          if (curated.is_admin !== null) {
            lines.push(`- **Is Admin:** ${curated.is_admin ? "Yes" : "No"}`);
          }
          if (curated.two_factor_enabled !== null) {
            lines.push(
              `- **2FA Enabled:** ${curated.two_factor_enabled ? "Yes" : "No"}`,
            );
          }
          if (curated.last_sign_in_at) {
            lines.push(`- **Last Sign In:** ${curated.last_sign_in_at}`);
          }
          if (curated.last_activity_on) {
            lines.push(`- **Last Active:** ${curated.last_activity_on}`);
          }

          lines.push(``, `- **Profile URL:** ${curated.web_url}`);

          return {
            output: lines.join("\n"),
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
          return { output: `Failed to get user profile: ${message}` };
        }
      },
    }),
  };
}
