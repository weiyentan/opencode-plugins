/**
 * hello.ts — Hello-world tool factory.
 *
 * Phase 0 scaffolding tracer that verifies plugin load, tool registration,
 * and hot-reload behavior.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

export function createHelloTool(serverUrl: URL) {
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
