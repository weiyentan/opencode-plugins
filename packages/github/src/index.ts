/**
 * GitHub Plugin for OpenCode
 *
 * Provides native tool access to the GitHub API for issues, pull requests,
 * search, and code browsing.
 *
 * ## Plugin Lifecycle
 *
 * 1. On load, the plugin registers its tools.
 * 2. Tools communicate with the GitHub REST API using a configurable token.
 * 3. Configuration is provided via environment variables or tool arguments.
 *
 * ## Registration
 *
 * The plugin is registered as a string-only entry in opencode.jsonc:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-github"] }
 * ```
 */
import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

/**
 * Plugin server function — the single entry point.
 *
 * Receives PluginInput (client, project, directory, worktree, serverUrl, $)
 * and returns Hooks. No plugin options are accepted — all configuration
 * comes from environment variables or tool arguments.
 *
 * Returns Hooks including:
 * - Registered tools (github.hello, etc.)
 */
async function server(input: PluginInput): Promise<Hooks> {
  const { serverUrl } = input;

  /* ── Hello-world tool (Phase 0 scaffolding tracer) ────────── */
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

  /* ── Hooks ────────────────────────────────────────────────── */
  return {
    tool: {
      hello,
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
