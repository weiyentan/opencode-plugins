/**
 * ping.ts — Ping / health-check tool factory.
 *
 * awx-ping: Checks connectivity to the AWX instance and returns
 * the raw ping response including version, HA state, instances, etc.
 */
import { tool } from "@opencode-ai/plugin";

import type { AwxClient } from "../client.js";
import { fetchPing } from "../ping.js";

export function createPingTool(
  getAwxClient: () => Promise<AwxClient>,
  baseUrl?: string,
) {
  return tool({
    description: [
      "Check connectivity to the AWX instance and return health/status info.",
      "Calls GET /api/v2/ping/ and returns the raw ping response including",
      "AWX version, HA state, active node, install UUID, and instance info.",
      "No arguments required — checks the already-configured AWX instance.",
    ].join(" "),
    args: {},
    async execute(_args, context) {
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
        const pingResult = await fetchPing(awxClient, context.abort);

        // Build human-readable summary
        const resolvedBaseUrl = baseUrl ?? "the configured AWX instance";
        const version = typeof pingResult.version === "string" ? pingResult.version : "unknown";
        const activeNode = typeof pingResult.active_node === "string" ? pingResult.active_node : "unknown";

        // Count active/total instances
        const instances = Array.isArray(pingResult.instances) ? pingResult.instances : [];
        const totalInstances = instances.length;
        const activeInstances = instances.filter(
          (inst: Record<string, unknown>) => inst.status === "running",
        ).length;

        const output = `AWX instance at ${resolvedBaseUrl} is reachable. Version: ${version}, Instances: ${activeInstances}/${totalInstances}, Active node: ${activeNode}`;

        return {
          output,
          metadata: pingResult as Record<string, unknown>,
        };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { output: "Request was aborted." };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { output: `AWX connectivity check failed: ${message}` };
      }
    },
  });
}
