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
import { MetricsStore, setupMetricsPersistence } from "./metrics.js";
import { createClient, createTimeoutSignal } from "./client.js";
import type { AwxClient } from "./client.js";
import { listTemplates } from "./list-templates.js";

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

  async function getAwxClient(): Promise<AwxClient | undefined> {
    if (!baseUrl) return undefined;

    const token = await input.client.getSecret?.("awx");
    if (!token) return undefined;

    const tokenString = String(token);

    if (!cachedClient || cachedToken !== tokenString) {
      cachedToken = tokenString;
      cachedClient = createClient(baseUrl, tokenString, { metricsStore });
    }

    return cachedClient;
  }

  /* ── Init-time validation ─────────────────────────────────── */
  // If a baseUrl is configured, attempt to validate the connection.
  // Token validation depends on whether the user has already stored a PAT.
  // If no baseUrl is configured, skip — the user will configure it later.
  if (baseUrl) {
    try {
      const storedKey = await input.client.getSecret?.("awx");
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

      /**
       * List AWX job templates with pagination.
       *
       * Fetches job templates from the AWX /api/v2/job_templates/ endpoint,
       * consolidating results across pages up to a configurable page cap.
       * Results are sorted by name. Supports per-page size override and
       * returns a warning when the page cap limits results.
       *
       * The per-page timeout budget is derived from the tool-level timeout
       * divided by (maxPages + 1).
       */
      awxListTemplates: tool({
        description: [
          "List AWX job templates with pagination. Fetches templates from",
          "/api/v2/job_templates/, consolidating across pages up to a",
          "configurable cap. Results sorted by name. Supports page size",
          "override. Returns warning when page cap limits results.",
        ].join(" "),
        args: {
          pageSize: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe("Items per page (1-200, default: 50)"),
          maxPages: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Maximum pages to fetch (0 = no cap, default: 5)"),
        },
        async execute(args, context) {
          // Respect the abort signal
          if (context.abort?.aborted) {
            return JSON.stringify({
              count: 0,
              results: [],
              warning: "Request was aborted.",
            });
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return JSON.stringify({
              count: 0,
              results: [],
              warning:
                "AWX client not available. Configure a baseUrl in " +
                "opencode.jsonc and store your Personal Access Token " +
                "via the plugin auth prompt.",
            });
          }

          try {
            const result = await listTemplates(
              awxClient,
              30_000,
              {
                pageSize: args.pageSize,
                maxPages: args.maxPages,
              },
              context.abort,
            );
            return JSON.stringify(result);
          } catch (err) {
            return JSON.stringify({
              count: 0,
              results: [],
              warning: `Failed to fetch templates: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
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
