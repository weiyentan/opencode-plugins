/**
 * GitLab Plugin for OpenCode
 *
 * Provides native tool access to GitLab API
 * for projects, merge requests, issues, and repository operations.
 *
 * ## Plugin Lifecycle
 *
 * 1. On load, the plugin registers its auth hook.
 * 2. Tools consume the authenticated client for all GitLab API requests.
 *
 * ## Configuration
 *
 * The plugin is registered as a string-only entry in opencode.jsonc:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-gitlab"] }
 * ```
 */
import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

/**
 * Plugin server function — the single entry point.
 *
 * Receives PluginInput (client, project, directory, worktree, serverUrl, $)
 * and returns Hooks including a hello-world tool for verification.
 */
async function server(input: PluginInput): Promise<Hooks> {
  const { serverUrl } = input;

  return {
    tool: {
      hello: tool({
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
      }),
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
 */
export const GitLabPlugin: Plugin = server;
export default GitLabPlugin;
