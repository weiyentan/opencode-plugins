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

/**
 * Format a user-facing error message for HTTP error responses.
 *
 * Maps HTTP status codes to meaningful error messages the agent
 * can act on (e.g., "not found", "not authorized").
 */
function formatErrorResponse(projectId: number, status: number): string {
  switch (status) {
    case 404:
      return `Project ${projectId} not found. Verify the project ID and try again.`;
    case 401:
    case 403:
      return (
        `Not authorized to sync project ${projectId}. ` +
        "Check your Personal Access Token permissions."
      );
    default:
      return (
        `Failed to sync project ${projectId}. ` +
        `AWX API returned HTTP ${status}.`
      );
  }
}

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
    void input.client.app.log({
      body: {
        service: "plugin-awx",
        level: "error",
        message: `Metrics persistence failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
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
       * Trigger an SCM sync on an AWX project.
       *
       * Accepts a project_id, fetches the project details, and triggers
       * an SCM update via POST /api/v2/projects/<id>/update/.
       * Returns the project_update_id, status, and project metadata.
       * The sync is async on AAP — the agent can poll the project update
       * status using the returned project_update_id.
       */
      syncProject: tool({
        description: [
          "Trigger an SCM sync on an AWX project by project ID.",
          "Fetches project details, triggers the update, and returns",
          "the project update ID, status, and project metadata.",
          "Sync is async — poll the project update status separately.",
        ].join(" "),
        args: {
          project_id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the AWX project to sync."),
        },
        async execute(args, context) {
          // Respect the abort signal
          if (context.abort?.aborted) {
            return "Request was aborted.";
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return (
              "[awx-sync-project] AWX client not available. " +
              "Configure a baseUrl in opencode.jsonc and store your " +
              "Personal Access Token via the plugin auth prompt."
            );
          }

          const toolName = "syncProject";
          const { project_id } = args;

          try {
            // Step 1: Fetch project details
            const projectRes = await awxClient.request(
              toolName,
              `/api/v2/projects/${project_id}/`,
              { method: "GET" },
              context.abort,
            );

            if (!projectRes.ok) {
              return formatErrorResponse(project_id, projectRes.status);
            }

            const project = (await projectRes.json()) as Record<string, unknown>;

            // Step 2: Trigger SCM update
            const updateRes = await awxClient.request(
              toolName,
              `/api/v2/projects/${project_id}/update/`,
              { method: "POST" },
              context.abort,
            );

            if (!updateRes.ok) {
              return formatErrorResponse(project_id, updateRes.status);
            }

            const projectUpdate = (await updateRes.json()) as Record<string, unknown>;

            // Step 3: Return structured output
            const projectName = (project.name as string) ?? "";
            const status = projectUpdate.status as string;

            return {
              output: [
                `SCM sync triggered for project "${projectName}" (ID ${project_id}).`,
                `Project update ID: ${projectUpdate.id as number}, status: ${status}.`,
              ].join(" "),
              metadata: {
                project_update_id: projectUpdate.id as number,
                status,
                project_name: projectName,
                project_id,
                url: (project.url as string) ?? "",
                scm_type: (project.scm_type as string) ?? "",
                last_updated: (project.last_updated as string) ?? "",
              },
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return "Request was aborted.";
            }
            return (
              `[awx-sync-project] Unexpected error syncing project ${project_id}: ` +
              `${err instanceof Error ? err.message : String(err)}`
            );
          }
        },
      }),

      /**
       * List AWX job templates — Phase 0 stub tool.
       *
       * Placeholder that validates the createClient wiring and tool
       * registration pipeline. Will be replaced with a real AWX API
       * call in Phase 1.
       */
      listTemplates: tool({
        description: [
          "List AWX job templates. Phase 0 stub tool — validates",
          "createClient wiring and tool registration pipeline.",
          "Will return a real template list in Phase 1.",
        ].join(" "),
        args: {},
        async execute(_args, context) {
          // Respect the abort signal
          if (context.abort?.aborted) {
            return "Request was aborted.";
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return (
              "[stub] list-templates: AWX client not available. " +
              "Configure a baseUrl in opencode.jsonc and store your " +
              "Personal Access Token via the plugin auth prompt."
            );
          }

          return "[stub] list-templates: AWX integration not yet implemented.";
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
