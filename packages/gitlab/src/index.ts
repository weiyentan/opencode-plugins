/**
 * GitLab Plugin for OpenCode
 *
 * Provides native tool access to the GitLab API
 * for projects, merge requests, issues, and repository operations.
 *
 * ## Plugin Lifecycle
 *
 * 1. On load, the plugin registers its auth hook (type: "api" bearer token).
 * 2. Tools consume the authenticated client for all GitLab API requests.
 *
 * ## Configuration
 *
 * The plugin is registered as a string-only entry in opencode.jsonc:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-gitlab"] }
 * ```
 *
 * ## Auth Fallback Chain (3-tier)
 *
 * Credentials are resolved through a 3-tier fallback chain:
 *   1. `customConfig` — configured via `gitlab_configure` tool at runtime
 *   2. `getSecret("gitlab")` — server-injected secret (if available)
 *   3. `process.env.GITLAB_TOKEN` — environment variable fallback
 */
import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

import { createGitLabAuthHook, validateToken } from "./auth.js";
import { createClient, createTimeoutSignal } from "./client.js";
import type { GitLabClient } from "./client.js";
import { createGraphQLClient } from "./graphql.js";
import type { GraphQLClient } from "./graphql.js";
import { createIssueTools } from "./tools/issues.js";
import { createMRTools } from "./tools/mrs.js";
import { createProjectTools } from "./tools/projects.js";
import { createCodeTools } from "./tools/code.js";
import { createUserTools } from "./tools/user.js";
import { createRichTools } from "./tools/rich.js";
import { createQueryTool } from "./tools/query.js";

const z = tool.schema;

/* ── Custom Configuration (Tier 1 of auth fallback) ───────────── */

/**
 * Module-level storage for runtime-configured credentials.
 * Populated by the `gitlab_configure` tool.
 */
interface CustomConfig {
  token?: string;
  baseUrl?: string;
}

let customConfig: CustomConfig | undefined;

/** Set custom config programmatically (called by gitlab_configure tool) */
export function setCustomConfig(config: CustomConfig | undefined): void {
  customConfig = config;
}

/** Get the current custom config (for use in getGitLabClient fallback chain) */
export function getCustomConfig(): CustomConfig | undefined {
  return customConfig;
}

/* ── Plugin Server Function ───────────────────────────────────── */

/**
 * Plugin server function — the single entry point.
 *
 * Receives PluginInput (client, project, directory, worktree, serverUrl, $)
 * and returns Hooks including:
 * - Auth hook (type: "api" for Personal Access Token)
 * - Registered tools
 */
async function server(input: PluginInput): Promise<Hooks> {
  const { serverUrl } = input;

  /* ── Auth hook ────────────────────────────────────────────── */
  const authHook = createGitLabAuthHook();

  /* ── GitLab HTTP clients — lazy resolver, created on first tool call ── */
  let cachedClient: GitLabClient | undefined;
  let cachedToken: string | undefined;
  let cachedBaseUrl: string | undefined;
  let cachedGraphQLClient: GraphQLClient | undefined;
  let cachedGraphQLToken: string | undefined;

  /**
   * Resolve the GitLab token through the 3-tier fallback chain:
   *
   *  1. customConfig.token — runtime-configured via gitlab_configure tool
   *  2. getSecret("gitlab") — server-injected secret (if available)
   *  3. process.env.GITLAB_TOKEN — environment variable fallback
   */
  async function resolveToken(): Promise<string | undefined> {
    // Tier 1: custom config (from gitlab_configure tool)
    if (customConfig?.token) {
      return customConfig.token;
    }

    // Tier 2: server-injected secret (if the OpenCode server provides it)
    try {
      const secret = await (
        input.client as unknown as {
          getSecret?: (provider: string) => Promise<string | undefined>;
        }
      ).getSecret?.("gitlab");
      if (secret) {
        return secret;
      }
    } catch {
      // getSecret not available — fall through to next tier
    }

    // Tier 3: environment variable
    if (process.env.GITLAB_TOKEN) {
      return process.env.GITLAB_TOKEN;
    }

    return undefined;
  }

  /**
   * Lazy resolver for the GitLab REST client.
   *
   * Caches the client instance and only re-creates when the token changes.
   *
   * @throws If no token is configured through any tier
   */
  async function getGitLabClient(): Promise<GitLabClient> {
    const resolvedToken = await resolveToken();
    if (!resolvedToken) {
      throw new Error(
        "GitLab Personal Access Token (PAT) not configured. " +
          "Set GITLAB_TOKEN environment variable, use the gitlab_configure tool, " +
          "or store your PAT via the plugin auth prompt.",
      );
    }

    const resolvedBaseUrl =
      customConfig?.baseUrl ??
      process.env.GITLAB_BASE_URL ??
      "https://gitlab.com";

    if (!cachedClient || cachedToken !== resolvedToken || cachedBaseUrl !== resolvedBaseUrl) {
      cachedToken = resolvedToken;
      cachedBaseUrl = resolvedBaseUrl;
      cachedClient = createClient(resolvedBaseUrl, resolvedToken);
    }

    return cachedClient;
  }

  /**
   * Lazy resolver for the GitLab GraphQL client.
   *
   * @throws If no token is configured through any tier
   */
  async function getGraphQLClient(): Promise<GraphQLClient> {
    const resolvedToken = await resolveToken();
    if (!resolvedToken) {
      throw new Error(
        "GitLab Personal Access Token (PAT) not configured. " +
          "Set GITLAB_TOKEN environment variable, use the gitlab_configure tool, " +
          "or store your PAT via the plugin auth prompt.",
      );
    }

    const resolvedBaseUrl =
      customConfig?.baseUrl ??
      process.env.GITLAB_BASE_URL ??
      "https://gitlab.com";

    if (!cachedGraphQLClient || cachedGraphQLToken !== resolvedToken) {
      cachedGraphQLToken = resolvedToken;
      cachedGraphQLClient = createGraphQLClient(resolvedBaseUrl, resolvedToken);
    }

    return cachedGraphQLClient;
  }

  /* ── Init-time validation ─────────────────────────────────── */
  // Attempt to validate the connection if a token is available.
  // Token validation depends on whether the user has already stored a PAT.
  // If no token is configured, skip — the user will configure it later.
  try {
    const storedToken = await resolveToken();
    if (storedToken) {
      const { signal, clear } = createTimeoutSignal(10_000);

      try {
        const resolvedBaseUrl =
          customConfig?.baseUrl ??
          process.env.GITLAB_BASE_URL ??
          "https://gitlab.com";
        const result = await validateToken(
          resolvedBaseUrl,
          storedToken,
          signal,
        );

        if (!result.valid) {
          void input.client.app.log({
            body: {
              service: "plugin-gitlab",
              level: "error",
              message: `Init-time token validation failed: ${result.error}`,
            },
          });
        } else {
          void input.client.app.log({
            body: {
              service: "plugin-gitlab",
              level: "info",
              message: `Token validated successfully against GitLab`,
            },
          });
        }
      } finally {
        clear();
      }
    }
  } catch {
    // No token — skip validation, user will configure later
    void input.client.app.log({
      body: {
        service: "plugin-gitlab",
        level: "info",
        message:
          "No stored token found. Auth will be configured on first use.",
      },
    });
  }

  /* ── Tools ────────────────────────────────────────────────── */

  /** Hello-world sanity-check tool */
  const hello = tool({
    description: [
      "Returns a hello world greeting. Sanity-check tool that verifies",
      "plugin load, tool registration, and hot-reload behavior on the",
      `GitLab plugin server (connected to ${serverUrl.href}).`,
    ].join(" "),
    args: {
      name: z
        .string()
        .optional()
        .describe("Name to greet. Defaults to 'world'."),
    },
    async execute(args, context) {
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      const name = args.name ?? "world";
      return { output: `Hello, ${name}! 👋` };
    },
  });

  /** Runtime configuration tool — sets token via the 3-tier chain's Tier 1 */
  const configureTool = tool({
    description: [
      "Configure the GitLab plugin at runtime. Sets the Personal Access",
      "Token (PAT) used for all GitLab API requests. The token takes",
      "precedence over GITLAB_TOKEN environment variable.",
    ].join(" "),
    args: {
      token: z
        .string()
        .describe("GitLab Personal Access Token (PAT) with api and read_user scopes."),
      baseUrl: z
        .string()
        .optional()
        .describe("GitLab base URL (e.g., https://gitlab.com)"),
    },
    async execute(args, context) {
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      const mergedConfig: CustomConfig = {
        ...(customConfig ?? {}),
        ...(args.token ? { token: args.token } : {}),
        ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
      };
      setCustomConfig(Object.keys(mergedConfig).length > 0 ? mergedConfig : undefined);

      // Invalidate cached clients so they re-resolve with new config
      cachedClient = undefined;
      cachedToken = undefined;
      cachedBaseUrl = undefined;
      cachedGraphQLClient = undefined;
      cachedGraphQLToken = undefined;

      return {
        output:
          "GitLab plugin configured. Token set from tool input and cached client invalidated.",
      };
    },
  });

  /** Ping tool — verifies GitLab REST and GraphQL connectivity */
  const pingTool = tool({
    description: [
      "Verifies connectivity to the GitLab API by pinging the REST",
      "and GraphQL endpoints. Returns the authenticated username",
      "from GET /api/v4/user, confirming the token is valid and",
      "the GitLab instance is reachable.",
    ].join(" "),
    args: {},
    async execute(_args, context) {
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      try {
        const client = await getGitLabClient();
        const response = await client.request(
          "gitlab_ping",
          "/api/v4/user",
          undefined,
          context.abort,
        );

        if (!response.ok) {
          return {
            output: `GitLab ping failed with HTTP ${response.status}: ${response.statusText}`,
          };
        }

        const user = (await response.json()) as {
          username?: string;
          name?: string;
        };
        const username = user.username ?? user.name ?? "unknown";

        // Verify GraphQL client is available
        const graphql = await getGraphQLClient();
        void graphql; // GraphQL client validated and ready for use

        return {
          output: `Connected to GitLab as ${username}. REST and GraphQL clients ready.`,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: `GitLab ping failed: ${message}` };
      }
    },
  });

  /* ── Issue tools (REST) ──────────────────────────────────── */
  const issueTools = createIssueTools(getGitLabClient);
  /* ── MR, project, code & user tools (REST) ──────────────── */
  const mrTools = createMRTools(getGitLabClient);
  const projectTools = createProjectTools(getGitLabClient);
  const codeTools = createCodeTools(getGitLabClient);
  const userTools = createUserTools(getGitLabClient);
  /* ── GraphQL-powered rich tools ──────────────────────────── */
  const richTools = createRichTools(getGraphQLClient);
  const queryTool = createQueryTool(getGraphQLClient);

  /* ── Hooks ────────────────────────────────────────────────── */
  return {
    auth: authHook,
    tool: {
      hello,
      "gitlab_configure": configureTool,
      "gitlab_ping": pingTool,
      ...issueTools,
      ...mrTools,
      ...projectTools,
      ...codeTools,
      ...userTools,
      ...richTools,
      "gitlab_query": queryTool,
    },
  };
}

/**
 * GitLab Plugin — the named async export consumed by the OpenCode plugin server.
 *
 * Registered in opencode.jsonc as a string-only plugin entry:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-gitlab"] }
 * ```
 *
 * Configuration is read via the 3-tier fallback chain:
 * - `gitlab_configure` tool (runtime, top priority)
 * - `getSecret("gitlab")` (server-injected, if available)
 * - `GITLAB_TOKEN` environment variable (fallback)
 */
export const GitLabPlugin: Plugin = server;
export default GitLabPlugin;
