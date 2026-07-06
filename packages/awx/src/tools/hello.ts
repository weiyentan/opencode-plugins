import { tool } from "@opencode-ai/plugin";
import type { AwxClient } from "../client.js";

const z = tool.schema;

/**
 * Factory function that creates the hello-world tool.
 *
 * Establishes the factory pattern for tool extraction: each tool module
 * exports a `create` function that receives `getAwxClient` (a lazy resolver
 * for the authenticated AWX HTTP client) and returns a registered tool.
 *
 * The hello tool does not actually call the AWX API — it is a Phase 0
 * scaffolding tracer that verifies plugin load, tool registration, and
 * hot-reload behavior.
 */
export function createHelloTool(
  _getAwxClient: () => Promise<AwxClient>,
) {
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
