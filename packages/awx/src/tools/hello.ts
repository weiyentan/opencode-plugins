/**
 * hello.ts — Hello-world tool factory for the AWX plugin.
 *
 * Provides a simple greeting tool that verifies plugin load, tool
 * registration, and hot-reload behavior on the OpenCode plugin server.
 * This is the canonical home for the hello tool, extracted from the
 * inline definition that previously lived in index.ts.
 */
import { tool } from "@opencode-ai/plugin";
import type { AwxClient } from "../client.js";

const z = tool.schema;

/**
 * Create a hello-world tool.
 *
 * @param getAwxClient - Lazy resolver for the AWX HTTP client.
 *   Passed for consistency with the factory pattern used by other
 *   tools, though this tool does not make any API calls.
 * @returns A registered tool definition.
 */
export function createHelloTool(_getAwxClient: () => Promise<AwxClient>) {
  return tool({
    description: [
      "Returns a hello world greeting. Sanity-check tool that verifies",
      "plugin load, tool registration, and hot-reload behavior on the",
      "AWX plugin server.",
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
