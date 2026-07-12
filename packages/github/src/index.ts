/**
 * GitHub Plugin for OpenCode
 *
 * Provides native tool access to the GitHub API for issues, pull requests,
 * search, and code browsing.
 *
 * ## Plugin Lifecycle
 *
 * 1. On load, the plugin registers its auth hook (type: "api" bearer token).
 * 2. If a PAT was previously stored, init-time validation calls GET /user
 *    to verify the token is still active.
 * 3. Tools consume the validated token for all GitHub API requests.
 *
 * ## Configuration
 *
 * The plugin reads its base URL and token from a 3-tier fallback chain:
 *   customConfig → getSecret → process.env.GITHUB_TOKEN
 *
 * The plugin is registered as a string-only entry in opencode.jsonc:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-github"] }
 * ```
 */

import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

import { createGitHubAuthHook, validateGitHubToken } from "./auth.js";
import { createGitHubClient, createTimeoutSignal } from "./client.js";
import type { GitHubClient } from "./client.js";
import { createGraphQLClient } from "./graphql.js";
import type { GitHubGraphQLClient } from "./graphql.js";
import { createRichTools } from "./tools/rich.js";
import { createQueryTool } from "./tools/query.js";

const z = tool.schema;

/* ── Runtime configuration storage ──────────────────────────────── */

let customConfig: { baseUrl?: string; token?: string } | undefined;

function getCustomConfig(): { baseUrl?: string; token?: string } | undefined {
  return customConfig;
}

function setCustomConfig(config: { baseUrl?: string; token?: string } | undefined): void {
  customConfig = config;
}

/* ── Plugin server function ─────────────────────────────────────── */

/**
 * Plugin server function — the single entry point.
 *
 * Receives PluginInput (client, project, directory, worktree, serverUrl, $)
 * and returns Hooks. No plugin options are accepted — all configuration
 * comes from environment variables or tool arguments:
 * - `GITHUB_TOKEN`: GitHub Personal Access Token (PAT) (optional, env var fallback)
 * - `GITHUB_BASE_URL`: GitHub API base URL (optional, defaults to "https://api.github.com")
 *
 * Returns Hooks including:
 * - Auth hook (type: "api" for bearer token / PAT)
 * - Registered tools: github.hello, github-configure, github-debug-env,
 *   github.issue.get-full, github.pr.get-full, github.issue.search,
 *   github.repo.get-full, github.query
 */
async function server(input: PluginInput): Promise<Hooks> {
  const { serverUrl } = input;

  /* ── Auth hook ────────────────────────────────────────────── */
  const authHook = createGitHubAuthHook();

  /* ── GitHub HTTP client — lazy resolver, created on first tool call ── */
  let cachedClient: GitHubClient | undefined;
  let cachedClientToken: string | undefined;
  let cachedClientBaseUrl: string | undefined;
  let cachedGraphQL: GitHubGraphQLClient | undefined;
  let cachedGraphQLToken: string | undefined;
  let cachedGraphQLBaseUrl: string | undefined;

  async function getGitHubClient(): Promise<GitHubClient> {
    const resolvedBaseUrl =
      getCustomConfig()?.baseUrl ??
      process.env.GITHUB_BASE_URL ??
      "https://api.github.com";

    // 3-tier fallback: customConfig → getSecret → env var
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token =
      getCustomConfig()?.token ??
      await (input.client as any).getSecret?.("github") ??
      process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error(
        "GitHub Personal Access Token (PAT) not configured. " +
        "Store your PAT via the plugin auth prompt, the github-configure tool, " +
        "or the GITHUB_TOKEN environment variable.",
      );
    }

    const tokenString = String(token);

    if (!cachedClient || cachedClientToken !== tokenString || cachedClientBaseUrl !== resolvedBaseUrl) {
      cachedClientToken = tokenString;
      cachedClientBaseUrl = resolvedBaseUrl;
      cachedClient = createGitHubClient(resolvedBaseUrl, tokenString);
    }

    return cachedClient;
  }

  /** Lazy resolver for the GraphQL client, created on first rich-tool call */
  async function getGitHubGraphQL(): Promise<GitHubGraphQLClient> {
    const resolvedBaseUrl =
      getCustomConfig()?.baseUrl ??
      process.env.GITHUB_BASE_URL ??
      "https://api.github.com";

    // 3-tier fallback: customConfig → getSecret → env var
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token =
      getCustomConfig()?.token ??
      await (input.client as any).getSecret?.("github") ??
      process.env.GITHUB_TOKEN;

    if (!token) {
      throw new Error(
        "GitHub Personal Access Token (PAT) not configured. " +
        "Store your PAT via the plugin auth prompt, the github-configure tool, " +
        "or the GITHUB_TOKEN environment variable.",
      );
    }

    const tokenString = String(token);

    if (!cachedGraphQL || cachedGraphQLToken !== tokenString || cachedGraphQLBaseUrl !== resolvedBaseUrl) {
      cachedGraphQLToken = tokenString;
      cachedGraphQLBaseUrl = resolvedBaseUrl;
      cachedGraphQL = createGraphQLClient(tokenString, { baseUrl: resolvedBaseUrl });
    }

    return cachedGraphQL;
  }

  /* ── Init-time validation ─────────────────────────────────── */
  // If a token is configured, attempt to validate the connection.
  // If no token is configured, skip — the user will configure it later.
  (async () => {
    try {
      const resolvedBaseUrl =
        getCustomConfig()?.baseUrl ??
        process.env.GITHUB_BASE_URL ??
        "https://api.github.com";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storedKey =
        getCustomConfig()?.token ??
        await (input.client as any).getSecret?.("github") ??
        process.env.GITHUB_TOKEN;

      if (storedKey) {
        const { signal, clear } = createTimeoutSignal(10_000);

        try {
          const result = await validateGitHubToken(
            resolvedBaseUrl,
            String(storedKey),
            signal,
          );

          if (!result.valid) {
            void input.client.app.log({
              body: {
                service: "plugin-github",
                level: "error",
                message: `Init-time token validation failed: ${result.error}`,
              },
            });
          } else {
            void input.client.app.log({
              body: {
                service: "plugin-github",
                level: "info",
                message: "Token validated successfully against GitHub API.",
              },
            });
          }
        } finally {
          clear();
        }
      }
    } catch {
      void input.client.app.log({
        body: {
          service: "plugin-github",
          level: "info",
          message: "No stored token found. Auth will be configured on first use.",
        },
      });
    }
  })();

  /* ── Tools ────────────────────────────────────────────────── */

  /** Hello-world tool (Phase 0 scaffolding tracer) */
  const hello = tool({
    description: [
      "Returns a hello world greeting. Sanity-check tool that verifies",
      "plugin load, tool registration, and hot-reload behavior on the",
      `GitHub plugin server (connected to ${serverUrl.href}).`,
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

  /** Debug tool that returns current GitHub environment configuration. */
  const debugEnv = tool({
    description: "Debug tool that returns current GitHub environment configuration.",
    args: {},
    async execute(_args, context) {
      if (context.abort?.aborted) return { output: "Request was aborted." };
      const config = getCustomConfig();
      return {
        output: JSON.stringify({
          hasToken: Boolean(
            config?.token ?? process.env.GITHUB_TOKEN,
          ),
          baseUrl:
            config?.baseUrl ??
            process.env.GITHUB_BASE_URL ??
            "https://api.github.com (default)",
        }),
      };
    },
  });

  /** Configure tool for setting GitHub connection settings. */
  const configure = tool({
    description: "Configure GitHub connection settings (base URL and/or PAT token).",
    args: {
      baseUrl: z
        .string()
        .optional()
        .describe("GitHub API base URL (e.g., https://api.github.com)"),
      token: z
        .string()
        .optional()
        .describe("GitHub Personal Access Token (PAT)"),
    },
    async execute(args, context) {
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      if (!args.baseUrl && !args.token) {
        return { output: "Provide at least one of: baseUrl, token" };
      }

      // Merge with existing config so partial updates don't clear previously set values
      const merged: { baseUrl?: string; token?: string } = {
        ...(getCustomConfig() ?? {}),
        ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
        ...(args.token ? { token: args.token } : {}),
      };
      setCustomConfig(Object.keys(merged).length > 0 ? merged : undefined);

      // Invalidate cached clients so they re-resolve with new config
      cachedClient = undefined;
      cachedClientToken = undefined;
      cachedClientBaseUrl = undefined;
      cachedGraphQL = undefined;
      cachedGraphQLToken = undefined;
      cachedGraphQLBaseUrl = undefined;

      // Validate the client resolves with the new config
      let validationMessage = "";
      try {
        await getGitHubClient();
        validationMessage = " Client validated successfully.";
      } catch {
        validationMessage = " (client not validated — store a token and baseUrl to enable API calls)";
      }

      if (args.baseUrl && args.token) {
        return { output: `GitHub client configured and ready.${validationMessage}` };
      }

      return { output: `Configuration stored.${validationMessage}` };
    },
  });

  /* ── GraphQL-powered rich tools ──────────────────────────── */
  const richTools = createRichTools(getGitHubGraphQL);
  const queryTool = createQueryTool(getGitHubGraphQL);

  /* ── Hooks ────────────────────────────────────────────────── */
  return {
    auth: authHook,
    tool: {
      hello,
      "github-debug-env": debugEnv,
      "github-configure": configure,
      ...richTools,
      "github.query": queryTool,
    },
  };
}

/**
 * GitHub Plugin — the named async export consumed by the OpenCode plugin server.
 *
 * Registered in opencode.jsonc as a string-only plugin entry:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-github"] }
 * ```
 */
export const GitHubPlugin: Plugin = server;
export default GitHubPlugin;
