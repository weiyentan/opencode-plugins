/**
 * AWX Plugin for OpenCode
 *
 * Provides native tool access to AWX / Ansible Automation Platform
 * for job templates, projects, and job lifecycle operations.
 *
 * ## Plugin Lifecycle
 *
 * 1. On load, the plugin registers its auth hook (type: "api" bearer token).
 * 2. If a PAT was previously stored, init-time validation calls GET /api/v2/me/
 *    to verify the token is still active.
 * 3. Tools consume the validated token for all AWX API requests.
 *
 * ## Configuration
 *
 * The plugin reads `baseUrl` from its plugin options in opencode.jsonc:
 * ```jsonc
 * { "plugin": [["./packages/awx", { "baseUrl": "https://aap.tanscloud-internal.com" }]] }
 * ```
 */
import { tool } from "@opencode-ai/plugin";
import type { PluginInput, Hooks, PluginModule } from "@opencode-ai/plugin";
import { z } from "zod";
import { createAwxAuthHook, validateToken } from "./auth.js";

/** Plugin-specific configuration from opencode.jsonc */
export interface AwxPluginOptions {
  /**
   * Base URL of the AAP/AWX instance.
   * Must include protocol (https://) and hostname.
   * Example: "https://aap.tanscloud-internal.com"
   */
  baseUrl?: string;
}

/**
 * Plugin server function — the single entry point.
 *
 * Receives PluginInput (client, project, directory, worktree, serverUrl, $)
 * and optional plugin options from opencode.jsonc configuration.
 *
 * Returns Hooks including:
 * - Auth hook (type: "api" for bearer token / PAT)
 * - Tool registrations (hello-world scaffolding, eventually AWX tools)
 */
async function server(
  input: PluginInput,
  options?: AwxPluginOptions,
): Promise<Hooks> {
  const { serverUrl } = input;
  const baseUrl = options?.baseUrl;

  /* ── Auth hook ────────────────────────────────────────────── */
  const authHook = createAwxAuthHook();

  /* ── Init-time validation ─────────────────────────────────── */
  // If a baseUrl is configured, attempt to validate the connection.
  // Token validation depends on whether the user has already stored a PAT.
  // If no baseUrl is configured, skip — the user will configure it later.
  if (baseUrl) {
    try {
      const storedKey = await input.client.getSecret?.("awx");
      if (storedKey) {
        const result = await validateToken(
          baseUrl,
          String(storedKey),
          AbortSignal.timeout(10_000), // 10s health-check timeout
        );

        if (!result.valid) {
          console.error(
            `[plugin-awx] Init-time token validation failed: ${result.error}`,
          );
        } else {
          console.log(`[plugin-awx] Token validated successfully against ${baseUrl}`);
        }
      }
    } catch {
      console.log(
        `[plugin-awx] No stored token found. Auth will be configured on first use.`,
      );
    }
  }

  /* ── Hooks ────────────────────────────────────────────────── */
  return {
    auth: authHook,
    tool: {
      /**
       * Hello-world tool — Phase 0 scaffolding tracer.
       *
       * Verifies that tools can be registered, invoked, and hot-reloaded
       * by the OpenCode plugin server. This tool exercises the full plugin
       * lifecycle: import, register, execute, return.
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
          // Respect the abort signal
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
