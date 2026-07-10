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
import { createRunCommandTool } from "./tools/run-command.js";
import { createLaunchWorkflowTool } from "./tools/launch-workflow.js";
import { createPingTool } from "./tools/ping.js";
import { executeCrud } from "./crud.js";
import { wrapMutationResult } from "./utils.js";

import { tool } from "@opencode-ai/plugin";
const z = tool.schema;

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
      "awx-run-command": createRunCommandTool(getAwxClient),
      ...createLaunchWorkflowTool(getAwxClient),
      "awx-ping": createPingTool(getAwxClient, baseUrl),

      // ═════════════════════════════════════════════════════════
      // User / Team / Schedule / Notification Template CRUD tools
      // (from PR feat/crud-users-teams-schedules-notifications)
      // ═════════════════════════════════════════════════════════
      "awx-create-user": tool({
        description: [
          "Create a new AWX user. Requires username and password.",
          "Optional fields: first_name, last_name, email, is_superuser,",
          "is_system_auditor, and organization_id.",
          "Returns the created user detail in the standard mutation envelope.",
        ].join(" "),
        args: {
          username: z.string().min(1).describe("Username for the new user"),
          password: z.string().min(1).describe("Password for the new user (create-only)"),
          first_name: z.string().optional().describe("First name"),
          last_name: z.string().optional().describe("Last name"),
          email: z.string().optional().describe("Email address"),
          is_superuser: z.boolean().optional().describe("Whether the user is a superuser"),
          is_system_auditor: z.boolean().optional().describe("Whether the user is a system auditor"),
          organization_id: z.number().int().positive().optional().describe("Resolved organization ID to assign the user to"),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {
              username: args.username,
              password: args.password,
            };
            if (args.first_name !== undefined) body.first_name = args.first_name;
            if (args.last_name !== undefined) body.last_name = args.last_name;
            if (args.email !== undefined) body.email = args.email;
            if (args.is_superuser !== undefined) body.is_superuser = args.is_superuser;
            if (args.is_system_auditor !== undefined) body.is_system_auditor = args.is_system_auditor;
            if (args.organization_id !== undefined) body.organization = args.organization_id;

            const result = await executeCrud(
              awxClient,
              "user",
              "create",
              undefined,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `User "${args.username}" created (ID ${result.id}).`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to create user: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "user",
                id: 0,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Update an existing AWX user.
       *
       * Modifies a user in AWX via PATCH /api/v2/users/{id}/.
       * Only provided fields are updated (partial update semantics).
       * Returns the updated user detail in the standard mutation envelope.
       */
      "awx-update-user": tool({
        description: [
          "Update an existing AWX user by ID. Partial update — only",
          "provided fields are modified. Supports updating username,",
          "first_name, last_name, email, is_superuser,",
          "is_system_auditor, and organization_id.",
          "Returns the updated user detail in the standard mutation envelope.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the user to update"),
          username: z.string().optional().describe("New username"),
          first_name: z.string().optional().describe("First name"),
          last_name: z.string().optional().describe("Last name"),
          email: z.string().optional().describe("Email address"),
          is_superuser: z.boolean().optional().describe("Whether the user is a superuser"),
          is_system_auditor: z.boolean().optional().describe("Whether the user is a system auditor"),
          organization_id: z.number().int().positive().optional().describe("Resolved organization ID to assign"),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {};
            if (args.username !== undefined) body.username = args.username;
            if (args.first_name !== undefined) body.first_name = args.first_name;
            if (args.last_name !== undefined) body.last_name = args.last_name;
            if (args.email !== undefined) body.email = args.email;
            if (args.is_superuser !== undefined) body.is_superuser = args.is_superuser;
            if (args.is_system_auditor !== undefined) body.is_system_auditor = args.is_system_auditor;
            if (args.organization_id !== undefined) body.organization = args.organization_id;

            const result = await executeCrud(
              awxClient,
              "user",
              "update",
              args.id,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `User ${args.id} updated.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to update user ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "user",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Delete an AWX user.
       *
       * Removes a user from AWX via DELETE /api/v2/users/{id}/.
       * Returns the standard mutation envelope with data: null on success.
       */
      "awx-delete-user": tool({
        description: [
          "Delete an AWX user by ID.",
          "Removes the user from AWX via DELETE /api/v2/users/{id}/.",
          "Returns a standard mutation envelope with data set to null.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the user to delete."),
        },
        async execute(args, context) {
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
            const result = await executeCrud(
              awxClient,
              "user",
              "delete",
              args.id,
              undefined,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `User ${args.id} deleted.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to delete user ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "user",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Create a new AWX team.
       *
       * Creates a team in AWX via POST /api/v2/teams/.
       * `name` and `organization_id` are required.
       * `description` is optional.
       * Returns the created team detail in the standard mutation envelope.
       */
      "awx-create-team": tool({
        description: [
          "Create a new AWX team. Requires name and organization_id",
          "(resolved numeric ID, not a name).",
          "Optional description is supported.",
          "Returns created team detail in a standard mutation envelope.",
        ].join(" "),
        args: {
          name: z.string().min(1).describe("The name of the new team."),
          organization_id: z.number().int().positive().describe("The resolved AWX organization ID to assign this team to."),
          description: z.string().optional().describe("Optional description for the team."),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {
              name: args.name,
              organization: args.organization_id,
            };
            if (args.description !== undefined) body.description = args.description;

            const result = await executeCrud(
              awxClient,
              "team",
              "create",
              undefined,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Team "${args.name}" created (ID ${result.id}).`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to create team: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "team",
                id: 0,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Update an existing AWX team.
       *
       * Modifies a team in AWX via PATCH /api/v2/teams/{id}/.
       * Only provided fields are updated (partial update semantics).
       * Returns the updated team detail in the standard mutation envelope.
       */
      "awx-update-team": tool({
        description: [
          "Update an existing AWX team by ID. Partial update — only",
          "provided fields are modified. Supports updating name,",
          "organization_id, and description.",
          "Returns the updated team detail in the standard mutation envelope.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the team to update."),
          name: z.string().min(1).optional().describe("New name for the team."),
          organization_id: z.number().int().positive().optional().describe("Resolved organization ID for the team."),
          description: z.string().optional().describe("New description for the team."),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {};
            if (args.name !== undefined) body.name = args.name;
            if (args.organization_id !== undefined) body.organization = args.organization_id;
            if (args.description !== undefined) body.description = args.description;

            const result = await executeCrud(
              awxClient,
              "team",
              "update",
              args.id,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Team ${args.id} updated.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to update team ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "team",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Delete an AWX team.
       *
       * Removes a team from AWX via DELETE /api/v2/teams/{id}/.
       * Returns the standard mutation envelope with data: null on success.
       */
      "awx-delete-team": tool({
        description: [
          "Delete an AWX team by ID.",
          "Removes the team from AWX via DELETE /api/v2/teams/{id}/.",
          "Returns a standard mutation envelope with data set to null.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the team to delete."),
        },
        async execute(args, context) {
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
            const result = await executeCrud(
              awxClient,
              "team",
              "delete",
              args.id,
              undefined,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Team ${args.id} deleted.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to delete team ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "team",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Create a new AWX schedule.
       *
       * Creates a schedule in AWX via POST /api/v2/schedules/.
       * `name`, `rrule`, and `unified_job_template_id` are required.
       * `rrule` is an RFC 5545 recurrence rule string passed through as-is.
       * Returns the created schedule detail in the standard mutation envelope.
       */
      "awx-create-schedule": tool({
        description: [
          "Create a new AWX schedule. Requires name, rrule (RFC 5545 recurrence",
          "rule string), and unified_job_template_id (resolved numeric ID).",
          "Optional fields: description and extra_data.",
          "Returns created schedule detail in a standard mutation envelope.",
        ].join(" "),
        args: {
          name: z.string().min(1).describe("The name of the new schedule."),
          rrule: z.string().min(1).describe("RFC 5545 recurrence rule string (e.g., 'DTSTART:20250101T000000Z RRULE:FREQ=DAILY;INTERVAL=1')"),
          unified_job_template_id: z.number().int().positive().describe("The resolved AWX job template ID to schedule."),
          description: z.string().optional().describe("Optional description for the schedule."),
          extra_data: z.record(z.string(), z.unknown()).optional().describe("Optional extra variables to pass to the scheduled job."),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {
              name: args.name,
              rrule: args.rrule,
              unified_job_template: args.unified_job_template_id,
            };
            if (args.description !== undefined) body.description = args.description;
            if (args.extra_data !== undefined) body.extra_data = args.extra_data;

            const result = await executeCrud(
              awxClient,
              "schedule",
              "create",
              undefined,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Schedule "${args.name}" created (ID ${result.id}).`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to create schedule: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "schedule",
                id: 0,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Update an existing AWX schedule.
       *
       * Modifies a schedule in AWX via PATCH /api/v2/schedules/{id}/.
       * Only provided fields are updated (partial update semantics).
       * Returns the updated schedule detail in the standard mutation envelope.
       */
      "awx-update-schedule": tool({
        description: [
          "Update an existing AWX schedule by ID. Partial update — only",
          "provided fields are modified. Supports updating name, rrule,",
          "unified_job_template_id, description, and extra_data.",
          "Returns the updated schedule detail in the standard mutation envelope.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the schedule to update."),
          name: z.string().min(1).optional().describe("New name for the schedule."),
          rrule: z.string().min(1).optional().describe("RFC 5545 recurrence rule string."),
          unified_job_template_id: z.number().int().positive().optional().describe("Resolved AWX job template ID."),
          description: z.string().optional().describe("New description for the schedule."),
          extra_data: z.record(z.string(), z.unknown()).optional().describe("Extra variables to pass to the scheduled job."),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {};
            if (args.name !== undefined) body.name = args.name;
            if (args.rrule !== undefined) body.rrule = args.rrule;
            if (args.unified_job_template_id !== undefined) body.unified_job_template = args.unified_job_template_id;
            if (args.description !== undefined) body.description = args.description;
            if (args.extra_data !== undefined) body.extra_data = args.extra_data;

            const result = await executeCrud(
              awxClient,
              "schedule",
              "update",
              args.id,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Schedule ${args.id} updated.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to update schedule ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "schedule",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Delete an AWX schedule.
       *
       * Removes a schedule from AWX via DELETE /api/v2/schedules/{id}/.
       * Returns the standard mutation envelope with data: null on success.
       */
      "awx-delete-schedule": tool({
        description: [
          "Delete an AWX schedule by ID.",
          "Removes the schedule from AWX via DELETE /api/v2/schedules/{id}/.",
          "Returns a standard mutation envelope with data set to null.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the schedule to delete."),
        },
        async execute(args, context) {
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
            const result = await executeCrud(
              awxClient,
              "schedule",
              "delete",
              args.id,
              undefined,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Schedule ${args.id} deleted.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to delete schedule ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "schedule",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Create a new AWX notification template.
       *
       * Creates a notification template in AWX via POST /api/v2/notification_templates/.
       * `name`, `notification_type`, `organization_id`, and `notification_configuration`
       * are required.
       * `notification_configuration` shape depends on `notification_type`
       * (e.g., email, slack, webhook) — AWX validates server-side.
       * Returns the created notification template detail in the standard mutation envelope.
       */
      "awx-create-notification-template": tool({
        description: [
          "Create a new AWX notification template. Requires name,",
          "notification_type (e.g., email, slack, webhook),",
          "organization_id (resolved numeric ID), and",
          "notification_configuration (type-dependent object).",
          "Returns created notification template detail in a standard",
          "mutation envelope.",
        ].join(" "),
        args: {
          name: z.string().min(1).describe("The name of the notification template."),
          notification_type: z.enum(["email", "slack", "webhook", "pagerduty", "grafana", "irc", "twilio", "mattermost", "rocketchat"]).describe("Notification type (email, slack, webhook, etc.)"),
          organization_id: z.number().int().positive().describe("The resolved AWX organization ID to assign this notification template to."),
          notification_configuration: z.record(z.string(), z.unknown()).describe("Type-dependent configuration object (e.g., {channels: ['#ops']} for slack)"),
          description: z.string().optional().describe("Optional description for the notification template."),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {
              name: args.name,
              notification_type: args.notification_type,
              organization: args.organization_id,
              notification_configuration: args.notification_configuration,
            };
            if (args.description !== undefined) body.description = args.description;

            const result = await executeCrud(
              awxClient,
              "notification_template",
              "create",
              undefined,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Notification template "${args.name}" created (ID ${result.id}).`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to create notification template: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "notification_template",
                id: 0,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Update an existing AWX notification template.
       *
       * Modifies a notification template in AWX via PATCH /api/v2/notification_templates/{id}/.
       * Only provided fields are updated (partial update semantics).
       * Returns the updated notification template detail in the standard mutation envelope.
       */
      "awx-update-notification-template": tool({
        description: [
          "Update an existing AWX notification template by ID. Partial update",
          "— only provided fields are modified. Supports updating name,",
          "notification_type, organization_id, notification_configuration,",
          "and description.",
          "Returns the updated notification template detail in the standard",
          "mutation envelope.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the notification template to update."),
          name: z.string().min(1).optional().describe("New name for the notification template."),
          notification_type: z.enum(["email", "slack", "webhook", "pagerduty", "grafana", "irc", "twilio", "mattermost", "rocketchat"]).optional().describe("Notification type."),
          organization_id: z.number().int().positive().optional().describe("Resolved organization ID for the notification template."),
          notification_configuration: z.record(z.string(), z.unknown()).optional().describe("Type-dependent configuration object."),
          description: z.string().optional().describe("New description for the notification template."),
        },
        async execute(args, context) {
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
            const body: Record<string, unknown> = {};
            if (args.name !== undefined) body.name = args.name;
            if (args.notification_type !== undefined) body.notification_type = args.notification_type;
            if (args.organization_id !== undefined) body.organization = args.organization_id;
            if (args.notification_configuration !== undefined) body.notification_configuration = args.notification_configuration;
            if (args.description !== undefined) body.description = args.description;

            const result = await executeCrud(
              awxClient,
              "notification_template",
              "update",
              args.id,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Notification template ${args.id} updated.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to update notification template ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "notification_template",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),

      /**
       * Delete an AWX notification template.
       *
       * Removes a notification template from AWX via DELETE /api/v2/notification_templates/{id}/.
       * Returns the standard mutation envelope with data: null on success.
       */
      "awx-delete-notification-template": tool({
        description: [
          "Delete an AWX notification template by ID.",
          "Removes the notification template from AWX via",
          "DELETE /api/v2/notification_templates/{id}/.",
          "Returns a standard mutation envelope with data set to null.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the notification template to delete."),
        },
        async execute(args, context) {
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
            const result = await executeCrud(
              awxClient,
              "notification_template",
              "delete",
              args.id,
              undefined,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Notification template ${args.id} deleted.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to delete notification template ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "notification_template",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              } as unknown as Record<string, unknown>,
            };
          }
        },
      }),
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
