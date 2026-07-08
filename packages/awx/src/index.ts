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
 * The plugin reads `baseUrl` from the `AWX_BASE_URL` environment variable:
 * ```bash
 * export AWX_BASE_URL="https://example.com"
 * ```
 * The plugin is registered as a string-only entry in opencode.jsonc:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-awx"] }
 * ```
 */
import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";

import { createAwxAuthHook, validateToken } from "./auth.js";
import { MetricsStore, setupMetricsPersistence } from "./metrics.js";
import { createClient, createTimeoutSignal } from "./client.js";
import type { AwxClient } from "./client.js";

import { getCustomConfig } from "./runtime-config.js";

// Tool factory imports
import { createHelloTool } from "./tools/hello.js";
import { createConfigTools } from "./tools/configure.js";
import { createAttachCredentialTool } from "./tools/attach-credential.js";
import { createDetachCredentialTool } from "./tools/detach-credential.js";
import { createSyncProjectTool } from "./tools/sync-project.js";
import { createJobEventsTool } from "./tools/job-events.js";
import { createGetResourceTool } from "./tools/get-resource.js";
import { createListTools } from "./tools/list.js";
import { createJobLifecycleTools } from "./tools/job-lifecycle.js";
import { createCrudTools } from "./tools/crud.js";
import { createPingTool } from "./tools/ping.js";

/**
 * Plugin server function — the single entry point.
 *
 * Receives PluginInput (client, project, directory, worktree, serverUrl, $)
 * and returns Hooks. No plugin options are accepted — all configuration
 * comes from environment variables:
 * - `AWX_BASE_URL`: Base URL of the AAP/AWX instance (required)
 *
 * Returns Hooks including:
 * - Auth hook (type: "api" for bearer token / PAT)
 * - Registered tools (awx-list-templates, awx-launch-job, awx-job-status, etc.)
 */
async function server(input: PluginInput): Promise<Hooks> {
  const { serverUrl } = input;
  const baseUrl = process.env.AWX_BASE_URL;

  /* ── Auth hook ────────────────────────────────────────────── */
  const authHook = createAwxAuthHook();

  /* ── Metrics lifecycle ────────────────────────────────────── */
  // Create the shared MetricsStore early, before the AWX client,
  // so the middleware pipeline can record metrics through it.
  // Restore persisted counters from disk and set up periodic persistence
  // so that in-memory counters survive plugin reloads. The dispose hook
  // (returned via Hooks.dispose) will stop the interval and flush counters.
  const metricsStore = new MetricsStore();
  try {
    await metricsStore.load();
  } catch {
    // load failures (e.g. corrupt file) are non-fatal — counters start fresh
    void input.client.app.log({
      body: {
        service: "plugin-awx",
        level: "error",
        message: "Failed to load persisted metrics; starting fresh",
      },
    });
  }

  const persistence = setupMetricsPersistence(metricsStore, 30_000, (err) => {
    try {
      input.client.app?.log?.({
        body: {
          service: "plugin-awx",
          level: "error",
          message: `Metrics persistence failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    } catch {
      // Swallow logging errors (e.g. during dispose after test teardown)
    }
  });

  /* ── AWX HTTP client — lazy resolver, created on first tool call ── */
  let cachedClient: AwxClient | undefined;
  let cachedToken: string | undefined;
  let cachedBaseUrl: string | undefined;

  async function getAwxClient(): Promise<AwxClient> {
    const resolvedBaseUrl = getCustomConfig()?.baseUrl ?? (process.env.AWX_BASE_URL || undefined);
    if (!resolvedBaseUrl) throw new Error("AWX_BASE_URL not configured. Set the AWX_BASE_URL environment variable to point to your AAP/AWX instance.");

    const token = getCustomConfig()?.token
      ?? await (input.client as any).getSecret?.("awx")
      ?? process.env.AWX_TOKEN;
    if (!token) throw new Error("AWX Personal Access Token (PAT) not configured. Store your PAT via the plugin auth prompt.");

    const tokenString = String(token);

    if (!cachedClient || cachedToken !== tokenString || cachedBaseUrl !== resolvedBaseUrl) {
      cachedToken = tokenString;
      cachedBaseUrl = resolvedBaseUrl;
      cachedClient = createClient(resolvedBaseUrl, tokenString, { metricsStore });
    }

    return cachedClient;
  }

  /* ── Init-time validation ─────────────────────────────────── */
  // If a baseUrl is configured, attempt to validate the connection.
  // Token validation depends on whether the user has already stored a PAT.
  // If no baseUrl is configured, skip — the user will configure it later.
  if (baseUrl) {
    try {
      const storedKey = getCustomConfig()?.token ?? await (input.client as any).getSecret?.("awx") ?? process.env.AWX_TOKEN;
      if (storedKey) {
        const { signal, clear } = createTimeoutSignal(10_000);

        try {
          const result = await validateToken(
            baseUrl,
            String(storedKey),
            signal,
          );

          if (!result.valid) {
            void input.client.app.log({
              body: {
                service: "plugin-awx",
                level: "error",
                message: `Init-time token validation failed: ${result.error}`,
              },
            });
          } else {
            void input.client.app.log({
              body: {
                service: "plugin-awx",
                level: "info",
                message: `Token validated successfully against ${baseUrl}`,
              },
            });
          }
        } finally {
          clear();
        }
      }
    } catch {
      void input.client.app.log({
        body: {
          service: "plugin-awx",
          level: "info",
          message: "No stored token found. Auth will be configured on first use.",
        },
      });
    }
  }

  /* ── Hooks ────────────────────────────────────────────────── */
  return {
    auth: authHook,
    dispose: async () => {
      await persistence.clear();
    },
    tool: {
      hello: createHelloTool(serverUrl),
      ...createConfigTools(),
      ...createCrudTools(getAwxClient),
      ...createJobLifecycleTools(getAwxClient),
      "awx-get-job-events": createJobEventsTool(getAwxClient),
      ...createListTools(getAwxClient, metricsStore),
      "awx-get-resource": createGetResourceTool(getAwxClient),
      "awx-sync-project": createSyncProjectTool(getAwxClient),
      "awx-attach-credential": createAttachCredentialTool(getAwxClient),
      "awx-detach-credential": createDetachCredentialTool(getAwxClient),
      "awx-ping": createPingTool(getAwxClient, baseUrl),
    },
  };
}

/**
 * AWX Plugin — the named async export consumed by the OpenCode plugin server.
 *
 * Registered in opencode.jsonc as a string-only plugin entry:
 * ```jsonc
 * { "plugin": ["@weiyentan/opencode-plugin-awx"] }
 * ```
 *
 * Configuration is read from environment variables:
 * - `AWX_BASE_URL`: Base URL of the AAP/AWX instance (e.g. "https://example.com")
 */
export const AwxPlugin: Plugin = server;
export default AwxPlugin;
