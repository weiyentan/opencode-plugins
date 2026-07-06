import { tool } from "@opencode-ai/plugin";
const z = tool.schema;

import type { AwxClient } from "../client.js";

/**
 * Hello-world tool — Phase 0 scaffolding tracer.
 *
 * Verifies that tools can be registered, invoked, and hot-reloaded
 * by the OpenCode plugin server. This tool exercises the full plugin
 * lifecycle: import, register, execute, return.
 *
 * Factory pattern: receives `getAwxClient` as a closure parameter
 * to avoid circular dependencies. Future tools will use this same
 * pattern.
 */
export function createHelloTool(
  getAwxClient: () => Promise<AwxClient>,
  serverUrl: URL,
) {
  void getAwxClient; // unused in this tool — present for factory pattern consistency
  return tool({
    description: [
      "Returns a hello world greeting. Sanity-check tool that verifies",
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
      // Respect the abort signal
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      const name = args.name ?? "world";
      return { output: `Hello, ${name}! 👋` };
    },
  });
}
