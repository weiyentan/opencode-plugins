/**
 * run-command.ts — Ad-hoc command tool factory.
 *
 * awx-run-command: Launches an ad-hoc Ansible command via
 * POST /api/v2/ad_hoc_commands/.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { runCommand } from "../run-command.js";

export function createRunCommandTool(getAwxClient: () => Promise<AwxClient>) {
  return tool({
    description: [
      "Run an ad-hoc Ansible command via the AWX API.",
      "POSTs to /api/v2/ad_hoc_commands/ with inventory, credential,",
      "module name, optional module arguments, and optional host limit.",
      "Returns the raw AWX API response body for the created ad-hoc command.",
      "Supports any Ansible module (command, shell, ping, setup, etc.).",
    ].join(" "),
    args: {
      inventory_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric ID of the AWX inventory to run the command against."),
      credential_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric ID of the machine credential (for SSH access)."),
      module_name: z
        .string()
        .min(1)
        .describe("The Ansible module to run (e.g. 'command', 'shell', 'ping', 'setup')."),
      module_args: z
        .string()
        .optional()
        .describe("Optional arguments for the module (e.g. 'uptime', 'ls -la')."),
      limit: z
        .string()
        .optional()
        .describe("Optional host pattern to limit execution (e.g. 'webservers', '*.example.com')."),
    },
    async execute(args, context) {
      // Respect the abort signal
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      let awxClient: AwxClient;
      try {
        awxClient = await getAwxClient();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { output: message };
      }

      try {
        const result = await runCommand(
          awxClient,
          args.inventory_id,
          args.credential_id,
          args.module_name,
          args.module_args,
          args.limit,
          context.abort,
        );

        return {
          output: `Ad-hoc command #${result.id as number} launched. Module: ${args.module_name}, Inventory: ${args.inventory_id}, Status: ${result.status as string}`,
          metadata: result as Record<string, unknown>,
        };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { output: "Request was aborted." };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          output: `awx-run-command error: ${message}`,
        };
      }
    },
  });
}
