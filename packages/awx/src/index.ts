/**
 * AWX Plugin for OpenCode
 *
 * Provides native tool access to AWX / Ansible Automation Platform
 * for job templates, projects, and job lifecycle operations.
 *
 * This is the minimal Phase 0 entry stub — the hello-world tool
 * validates the plugin load, tool registration, and hot-reload contracts.
 */
import { tool } from "@opencode-ai/plugin";
import type { PluginInput, Hooks, PluginModule } from "@opencode-ai/plugin";
import { z } from "zod";

/**
 * Plugin server function — the single entry point.
 *
 * Receives PluginInput (client, project, directory, worktree, serverUrl, $)
 * and returns Hooks including tool registrations, auth hooks, and event handlers.
 */
async function server(input: PluginInput): Promise<Hooks> {
  const { serverUrl } = input;

  return {
    tool: {
      /**
       * Hello-world tool — Phase 0 scaffolding tracer.
       *
       * Verifies that tools can be registered, invoked, and hot-reloaded
       * by the OpenCode plugin server.
       */
      hello: tool({
        description: [
          "Returns a hello world greeting. Phase 0 scaffolding tool — verifies",
          "plugin load, tool registration, and hot-reload behavior on the",
          `AWX plugin server (connected to ${serverUrl.href}).`,
        ].join(" "),
        args: {
          name: z
            .string()
            .optional()
            .describe("Name to greet. Defaults to 'world'."),
        },
        async execute(args, context) {
          // Check abort signal before returning
          if (context.abort?.aborted) {
            return "Request was aborted.";
          }

          const name = args.name ?? "world";
          return `Hello, ${name}! 👋`;
        },
      }),
    },
  };
}

/**
 * Plugin module — the default export consumed by the OpenCode plugin server.
 */
const pluginModule: PluginModule = {
  id: "awx",
  server,
};

export default pluginModule;
