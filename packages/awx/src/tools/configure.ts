/**
 * configure.ts — Config/debug tool factories.
 *
 * awx-debug-env: Reports current AWX environment configuration.
 * awx-configure: Configures AWX connection settings (base URL and/or PAT token).
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import { getCustomConfig, setCustomConfig } from "../runtime-config.js";

export function createConfigTools() {
  return {
    /**
     * Debug tool that returns current AWX environment configuration.
     *
     * Reports whether AWX_BASE_URL is set and what its value is.
     * Useful for diagnosing configuration issues without making
     * any API calls.
     */
    "awx-debug-env": tool({
      description: "Debug tool that returns current AWX environment configuration.",
      args: {},
      async execute(_args, context) {
        if (context.abort?.aborted) return { output: "Request was aborted." };
        return {
          output: JSON.stringify({
            AWX_BASE_URL: process.env.AWX_BASE_URL ?? null,
            hasAwxBaseUrl: Boolean(process.env.AWX_BASE_URL),
          }),
        };
      },
    }),

    "awx-configure": tool({
      description: "Configure AWX connection settings (base URL and/or PAT token).",
      args: {
        baseUrl: z.string().optional().describe("AWX/AAP base URL"),
        token: z.string().optional().describe("AWX Personal Access Token (PAT)"),
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

        if (args.baseUrl && args.token) {
          return { output: "AWX client configured and ready." };
        }

        return { output: "Configuration stored." };
      },
    }),
  };
}
