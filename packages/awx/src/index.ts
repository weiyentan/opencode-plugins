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
import { tool } from "@opencode-ai/plugin";
import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";
import { z } from "zod";
import { createAwxAuthHook, validateToken } from "./auth.js";
import { MetricsStore, setupMetricsPersistence } from "./metrics.js";
import { createClient, createTimeoutSignal } from "./client.js";
import type { AwxClient } from "./client.js";
import { listTemplates } from "./list-templates.js";
import { listProjects } from "./list-projects.js";
import { launchJob } from "./launch.js";
import { fetchJobStatus } from "./job-status.js";

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
      "awx-sync-project": tool({
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
            return { output: "Request was aborted." };
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return {
              output:
                "[awx-sync-project] AWX client not available. " +
                "Set AWX_BASE_URL and store your " +
                "Personal Access Token via the plugin auth prompt.",
            };
          }

          const toolName = "awx-sync-project";
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
              return { output: formatErrorResponse(project_id, projectRes.status) };
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
              return { output: formatErrorResponse(project_id, updateRes.status) };
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
              return { output: "Request was aborted." };
            }
            return {
              output:
                `[awx-sync-project] Unexpected error syncing project ${project_id}: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            };
          }
        },
      }),

      /**
       * List AWX job templates.
       *
       * Fetches job templates from the AWX /api/v2/job_templates/ endpoint,
       * consolidating results across pages up to a configurable page cap.
       * Results are sorted by name. Supports per-page size override and
       * returns a warning when the page cap limits results.
       *
       * The per-page timeout budget is derived from the tool-level timeout
       * divided by (maxPages + 1).
       */
      "awx-list-templates": tool({
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
            return { output: "Request was aborted." };
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return {
              output:
                "AWX client not available. Set AWX_BASE_URL " +
                "and store your Personal Access Token " +
                "via the plugin auth prompt.",
              metadata: {
                count: 0,
                results: [],
                warning:
                  "AWX client not available. Set AWX_BASE_URL " +
                  "and store your Personal Access Token " +
                  "via the plugin auth prompt.",
              },
            };
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
            const output = `Found ${result.count} template(s).`;
            return {
              output: result.warning ? `${output} Warning: ${result.warning}` : output,
              metadata: result as unknown as Record<string, unknown>,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to fetch templates: ${message}`,
              metadata: {
                count: 0,
                results: [],
                warning: `Failed to fetch templates: ${message}`,
              },
            };
          }
        },
      }),

      /**
       * List AWX projects with pagination.
       *
       * Fetches projects from the AWX /api/v2/projects/ endpoint,
       * consolidating results across multiple pages up to a configurable
       * page cap. Results are sorted alphabetically by name.
       *
       * Pagination behavior:
       * - Default: up to 5 pages × 50 items/page = 250 items max
       * - If more pages exist beyond the cap, returns a warning field
       * - Per-page timeout: total tool timeout / (maxPages + 1)
       */
      "awx-list-projects": tool({
        description: [
          "List AWX projects with pagination. Fetches projects from",
          "the AWX /api/v2/projects/ endpoint, consolidating results",
          "across multiple pages up to a configurable page cap.",
          "Results are sorted alphabetically by name.",
        ].join(" "),
        args: {
          maxPages: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Maximum pages to fetch (default: 5, max: 100)."),
          pageSize: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe("Items per page (default: 50, max: 200)."),
          timeout: z
            .number()
            .int()
            .min(1_000)
            .optional()
            .describe("Total tool timeout in milliseconds (default: 30000)."),
        },
        async execute(args, context) {
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return {
              output:
                "[stub] list-projects: AWX client not available. " +
                "Set AWX_BASE_URL and store your " +
                "Personal Access Token via the plugin auth prompt.",
            };
          }

          try {
            const result = await listProjects(awxClient, {
              maxPages: args.maxPages,
              pageSize: args.pageSize,
              timeout: args.timeout,
              abortSignal: context.abort,
            });

            return {
              output: `Found ${result.count} project(s).`,
              metadata: result as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to list projects: ${message}`,
              metadata: { error: message },
            };
          }
        },
      }),

      /**
       * Launch an AWX job template with extra-vars transforms.
       *
       * Runs the transforms pipeline (SCM URL normalization, git branch
       * inference, required vars validation) before calling the AWX launch
       * API. If any transform fails, the launch is aborted with actionable
       * error messages.
       *
       * Returns a JSON string with:
       * - jobId: The AWX job ID (0 if transforms failed)
       * - jobStatus: The AWX job status ("failed" if transforms failed)
       * - warnings: Non-fatal transforms warnings
       * - errors: Fatal transforms errors (empty on success)
       */
      "awx-launch-job": tool({
        description: [
          "Launch an AWX job template by ID with extra-vars transforms.",
          "Transforms SCM URLs (SSH→HTTPS), infers git branches from",
          "refs/heads/ refs, and validates required variables before",
          "calling the AWX launch API. If any transform fails, the",
          "launch is aborted and an error is returned.",
        ].join(" "),
        args: {
          template_id: z
            .number()
            .int()
            .positive()
            .describe("The AWX job template ID to launch."),
          extra_vars: z
            .record(z.string(), z.unknown())
            .optional()
            .describe(
              "Extra variables to pass to the job template. Transforms:" +
              " scm_url (SSH→HTTPS), scm_branch (refs/heads/→short name)," +
              " plus required vars validation (inventory, scm_url, scm_branch).",
            ),
        },
        async execute(args, context) {
          // Respect the abort signal
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return {
              output:
                "AWX client not available. Set AWX_BASE_URL" +
                " and store your Personal Access Token" +
                " via the plugin auth prompt.",
              metadata: {
                jobId: 0,
                jobStatus: "failed",
                warnings: [],
                errors: [
                  "AWX client not available. Set AWX_BASE_URL" +
                  " and store your Personal Access Token" +
                  " via the plugin auth prompt.",
                ],
              },
            };
          }

          try {
            const result = await launchJob(
              awxClient,
              args.template_id,
              args.extra_vars,
              { abortSignal: context.abort },
            );

            const output = result.jobId > 0
              ? `Job ${result.jobId} launched (${result.jobStatus}).`
              : "Launch aborted due to transform errors.";
            return {
              output,
              metadata: result as unknown as Record<string, unknown>,
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to launch job: ${message}`,
              metadata: {
                jobId: 0,
                jobStatus: "failed",
                warnings: [],
                errors: [message],
              },
            };
          }
        },
      }),

      /**
       * Fetch job status from AWX.
       *
       * Retrieves detailed job information from /api/v2/jobs/<id>/
       * and returns it formatted according to the JobDetailOutput v1.0
       * contract. Optionally includes full job stdout.
       */
      "awx-job-status": tool({
        description: [
          "Fetch detailed status of an AWX job by job ID.",
          "Returns structured output matching the JobDetailOutput v1.0",
          "contract: job metadata, resolved related resource names,",
          "host status counts, derived boolean flags, warnings, and errors.",
          "Supports optional --include-stdout to include the full job",
          "console output as a string.",
        ].join(" "),
        args: {
          job_id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the AWX job to check."),
          include_stdout: z
            .boolean()
            .optional()
            .describe(
              "If true, fetch and include the full job stdout text.",
            ),
        },
        async execute(args, context) {
          // Respect the abort signal
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return {
              output:
                "awx-job-status: AWX client not available. " +
                "Set AWX_BASE_URL and store your " +
                "Personal Access Token via the plugin auth prompt.",
            };
          }

          try {
            const result = await fetchJobStatus(
              awxClient,
              args.job_id,
              args.include_stdout,
              context.abort,
            );

            const status = result?.job?.status ?? "unknown";
            return {
              output: `Job ${args.job_id} status: ${status}`,
              metadata: result as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : String(err);
            return {
              output: `awx-job-status error: ${message}`,
            };
          }
        },
      }),

      /**
       * Returns the current status of an AWX job by job ID.
       *
       * This is a NON-BLOCKING tool — it returns immediately with the current
       * job status without waiting for job completion. It calls the AWX API
       * GET /api/v2/jobs/<id>/ to verify the job exists and returns its
       * current status.
       *
       * ## Agent-Side Polling Pattern
       *
       * To wait for job completion, the agent should call `awx-job-status`
       * in a loop, checking for a terminal status (successful, failed, etc.).
       *
       * ## Orphaned Job Warning
       *
       * If the agent session is interrupted, the launched job continues
       * running on AAP. Skills using this tool should set
       * max_poll_attempts and recommend a job timeout to avoid orphaned
       * jobs consuming cluster resources indefinitely.
       */
      "awx-wait-job": tool({
        description: [
          "Returns the current status of an AWX job by job ID.",
          "",
          "NON-BLOCKING: This tool returns immediately without polling.",
          "The agent should call awx-job-status in a loop to wait for completion.",
          "",
          "ORPHANED JOB WARNING: If the agent session is interrupted,",
          "the job continues running on AAP. Skills should set",
          "max_poll_attempts and recommend job timeout.",
        ].join("\n"),
        args: {
          job_id: z
            .number()
            .int()
            .positive()
            .describe("The AWX job ID to check status for"),
        },
        async execute(args, context) {
          // Respect the abort signal
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return {
              output:
                "awx-wait-job: AWX client not available. " +
                "Set AWX_BASE_URL and store your " +
                "Personal Access Token via the plugin auth prompt.",
            };
          }

          try {
            const result = await fetchJobStatus(
              awxClient,
              args.job_id,
              false,
              context.abort,
              "awx-wait-job",
            );

            return {
              output: `Job ${args.job_id} status: ${result.job.status}`,
              metadata: result as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            const message =
              err instanceof Error ? err.message : String(err);
            return { output: `awx-wait-job error: ${message}` };
          }
        },
      }),

      /**
       * Get job events from an AWX job.
       *
       * Retrieves job events from the AWX API at
       * `/api/v2/jobs/<job_id>/job_events/`. Supports optional
       * filtering by event type and pagination for jobs with
       * 500+ events.
       *
       * Returns structured JSON with `count`, `results`, and
       * optional `next_page`.
       */
      "awx-get-job-events": tool({
        description: [
          "Get job events from an AWX job. Retrieves events from",
          "`/api/v2/jobs/<job_id>/job_events/`. Supports optional",
          "filtering by event type (e.g., `playbook_on_task_start`)",
          "and pagination via the `page` parameter.",
        ].join(" "),
        args: {
          job_id: z
            .number()
            .int()
            .positive()
            .describe("AWX job ID to retrieve events for"),
          event_filter: z
            .string()
            .optional()
            .describe(
              "Optional event type filter (e.g., 'playbook_on_task_start', 'runner_on_ok')",
            ),
          page: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Page number for paginated results"),
        },
        async execute(args, context) {
          // Respect the abort signal
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          const awxClient = await getAwxClient();
          if (!awxClient) {
            return {
              output:
                "AWX client not available. Set AWX_BASE_URL " +
                "and store your Personal Access Token " +
                "via the plugin auth prompt.",
              metadata: {
                count: 0,
                results: [],
                next_page: null,
                error:
                  "AWX client not available. Set AWX_BASE_URL " +
                  "and store your Personal Access Token " +
                  "via the plugin auth prompt.",
              },
            };
          }

          try {
            // Build query parameters
            const params = new URLSearchParams();
            if (args.event_filter) {
              params.set("event", args.event_filter);
            }
            if (args.page) {
              params.set("page", String(args.page));
            }

            const queryString = params.toString();
            const path = `/api/v2/jobs/${args.job_id}/job_events/${queryString ? `?${queryString}` : ""}`;

            const response = await awxClient.request(
              "awx-get-job-events",
              path,
              undefined,
              context.abort,
            );

            if (!response.ok) {
              return {
                output: `AWX API returned status ${response.status}: ${response.statusText}`,
                metadata: {
                  count: 0,
                  results: [],
                  next_page: null,
                  error: `AWX API returned status ${response.status}: ${response.statusText}`,
                },
              };
            }

            const data = (await response.json()) as {
              count?: number;
              next?: string | null;
              results?: unknown[];
            };

            // Extract next_page from the `next` URL if present
            let nextPage: number | null = null;
            if (data.next) {
              const nextUrl = new URL(data.next);
              const pageParam = nextUrl.searchParams.get("page");
              if (pageParam) {
                nextPage = Number.parseInt(pageParam, 10);
              }
            }

            return {
              output: `Found ${data.count ?? 0} event(s).`,
              metadata: {
                count: data.count ?? 0,
                results: data.results ?? [],
                next_page: nextPage,
              },
            };
          } catch (err) {
            const message =
              err instanceof Error
                ? err.message
                : "Unknown error fetching job events";
            return {
              output: `Failed to get job events: ${message}`,
              metadata: {
                count: 0,
                results: [],
                next_page: null,
                error: message,
              },
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
