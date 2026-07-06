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

const z = tool.schema;
import { createAwxAuthHook, validateToken } from "./auth.js";
import { MetricsStore, setupMetricsPersistence } from "./metrics.js";
import { createClient, createTimeoutSignal } from "./client.js";
import type { AwxClient } from "./client.js";
import { listTemplates, type TemplateResult } from "./list-templates.js";
import { listProjects } from "./list-projects.js";
import { listJobs } from "./list-jobs.js";
import type { JobResult } from "./list-jobs.js";
import { getResource } from "./get-resource.js";
import type { ResourceDetailOutput } from "./get-resource.js";
import { executeCrud } from "./crud.js";
import { attachCredential } from "./attach-credential.js";
import { formatErrorResponse, wrapMutationResult } from "./utils.js";
import { createHelloTool } from "./tools/hello.js";
import {
  createLaunchJobTool,
  createJobStatusTool,
  createWaitJobTool,
} from "./tools/job-status.js";

import { getCustomConfig, setCustomConfig } from "./runtime-config.js";

/**
 * Build a Markdown pipe-delimited table from an array of items.
 * Pipe characters (`|`) in cell values are escaped to `\|`.
 * The separator row uses `---` alignment (not left/right).
 */
function buildPipeTable<T>(
  items: T[],
  columns: Array<{ header: string; value: (item: T) => string }>,
): string {
  if (items.length === 0) {
    const headerRow = "| " + columns.map((c) => c.header).join(" | ") + " |";
    const sepRow = "| " + columns.map(() => "---").join(" | ") + " |";
    return [headerRow, sepRow].join("\n");
  }
  const headerRow = "| " + columns.map((c) => c.header).join(" | ") + " |";
  const sepRow = "| " + columns.map(() => "---").join(" | ") + " |";
  const dataRows = items.map(
    (item) =>
      "| " +
      columns.map((c) => String(c.value(item)).replace(/\|/g, "\\|")).join(" | ") +
      " |",
  );
  return [headerRow, sepRow, ...dataRows].join("\n");
}

/**
 * Format a structured resource detail into a human-readable multi-line string.
 * Dispatches on resource type to show the most relevant fields for each kind.
 */
function formatResourceOutput(result: ResourceDetailOutput): string {
  switch (result.resource_type) {
    case "project": {
      const d = result.data;
      return [
        `Project ${d.id}: ${d.name}`,
        `  SCM Type:        ${d.scm_type}`,
        `  SCM URL:         ${d.scm_url}`,
        `  Branch:          ${d.scm_branch || "(none)"}`,
        `  SCM Revision:    ${d.scm_revision || "(none)"}`,
        `  Credential:      ${d.credential_name && d.credential_id ? `${d.credential_name} (ID: ${d.credential_id})` : (d.credential_name || "(none)")}`,
        `  Default Env:     ${d.default_environment_name && d.default_environment_id ? `${d.default_environment_name} (ID: ${d.default_environment_id})` : (d.default_environment_name || "(none)")}`,
        `  Status:          ${d.status}`,
        `  Org:             ${d.organization_name}`,
        `  Updated:         ${d.last_updated ?? "(never)"}`,
      ].join("\n");
    }
    case "template": {
      const d = result.data;
      return [
        `Template ${d.id}: ${d.name}`,
        `  Job Type:  ${d.job_type}`,
        `  Playbook:  ${d.playbook}`,
        `  Status:    ${d.status}`,
        `  Inventory: ${d.inventory_name}`,
        `  Project:   ${d.project_name}`,
        `  Last Run:  ${d.last_job_run ?? "(never)"}`,
      ].join("\n");
    }
    case "inventory": {
      const d = result.data;
      return [
        `Inventory ${d.id}: ${d.name}`,
        `  Kind:       ${d.kind || "(normal)"}`,
        `  Host Count: ${d.host_count}`,
        `  Groups:     ${d.total_groups}`,
        `  Org:        ${d.organization_name}`,
      ].join("\n");
    }
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
  let cachedBaseUrl: string | undefined;

  async function getAwxClient(): Promise<AwxClient> {
    const resolvedBaseUrl = getCustomConfig()?.baseUrl ?? (process.env.AWX_BASE_URL || undefined);
    if (!resolvedBaseUrl) throw new Error("AWX_BASE_URL not configured. Set the AWX_BASE_URL environment variable to point to your AAP/AWX instance.");

    const token = getCustomConfig()?.token
      ?? await input.client.getSecret?.("awx")
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
      const storedKey = await input.client.getSecret?.("awx") ?? process.env.AWX_TOKEN;
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
      hello: createHelloTool(getAwxClient, serverUrl),

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

          let awxClient: AwxClient;
          try {
            awxClient = await getAwxClient();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: message };
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
          "override, server-side filtering, and configurable timeout.",
          "Returns warning when page cap limits results.",
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
          filter: z
            .array(z.string())
            .optional()
            .describe("Filter templates by field (e.g., --filter name__icontains=workspace)"),
          timeout: z
            .number()
            .int()
            .min(1_000)
            .max(300_000)
            .optional()
            .describe("Total tool timeout in milliseconds (default: 30000)"),
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
            return {
              output: message,
              metadata: {
                count: 0,
                results: [],
                warning: message,
              },
            };
          }

          try {
            const result = await listTemplates(
              awxClient,
              args.timeout ?? 30_000,
              {
                pageSize: args.pageSize,
                maxPages: args.maxPages,
                filters: args.filter,
              },
              context.abort,
            );

            const table = buildPipeTable(result.results, [
              { header: "ID", value: (t: TemplateResult) => String(t.id) },
              { header: "Name", value: (t: TemplateResult) => t.name },
              { header: "Description", value: (t: TemplateResult) => t.description },
              { header: "Job Type", value: (t: TemplateResult) => t.job_type },
              { header: "Playbook", value: (t: TemplateResult) => t.playbook },
              { header: "Status", value: (t: TemplateResult) => t.status },
              { header: "Project", value: (t: TemplateResult) => t.project_name },
              { header: "Inventory", value: (t: TemplateResult) => t.inventory_name },
            ]);

            const output = `Found ${result.count} template(s).\n\n${table}`;
            return {
              output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
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
          "Results are sorted alphabetically by name. Supports",
          "server-side filtering.",
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
          filter: z
            .array(z.string())
            .optional()
            .describe("Filter projects by field (e.g., --filter name__icontains=workspace)"),
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
            const result = await listProjects(awxClient, {
              maxPages: args.maxPages,
              pageSize: args.pageSize,
              timeout: args.timeout,
              abortSignal: context.abort,
              filters: args.filter,
            });

            const table = buildPipeTable(result.results, [
              { header: "ID", value: (p) => String(p.id) },
              { header: "Name", value: (p) => p.name },
              { header: "Description", value: (p) => p.description },
              { header: "SCM", value: (p) => p.scm_type },
              { header: "Status", value: (p) => p.status },
              { header: "Branch", value: (p) => p.scm_branch || "" },
              { header: "Org", value: (p) => p.summary_fields?.organization?.name ?? "" },
              { header: "Updated", value: (p) => p.last_updated ?? "" },
            ]);

            const output = `Found ${result.count} project(s).\n\n${table}`;
            return {
              output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
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
       * List AWX jobs with pagination.
       *
       * Fetches jobs from the AWX /api/v2/jobs/ endpoint,
       * consolidating results across pages up to a configurable page cap.
       * Results are sorted by created descending (newest first).
       * Supports per-page size override, server-side filtering, and
       * configurable timeout. Returns a warning when page cap limits results.
       *
       * The per-page timeout budget is derived from the tool-level timeout
       * divided by (maxPages + 1).
       */
      "awx-list-jobs": tool({
        description: [
          "List AWX jobs with pagination. Fetches jobs from",
          "/api/v2/jobs/, consolidating across pages up to a",
          "configurable cap. Results sorted by created descending",
          "(newest first). Supports page size override, server-side",
          "filtering, and configurable timeout. Returns warning when",
          "page cap limits results.",
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
          filter: z
            .array(z.string())
            .optional()
            .describe("Filter jobs by field (e.g., --filter name__icontains=workspace)"),
          timeout: z
            .number()
            .int()
            .min(1_000)
            .max(300_000)
            .optional()
            .describe("Total tool timeout in milliseconds (default: 30000)"),
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
            return {
              output: message,
              metadata: {
                schema_version: "1.0",
                total_jobs: 0,
                results: [],
                pages_fetched: 0,
                warning: message,
              },
            };
          }

          try {
            const result = await listJobs(
              awxClient,
              args.timeout ?? 30_000,
              {
                pageSize: args.pageSize,
                maxPages: args.maxPages,
                filters: args.filter,
              },
              context.abort,
            );

            const table = buildPipeTable(result.results, [
              { header: "ID", value: (j: JobResult) => String(j.id) },
              { header: "Name", value: (j: JobResult) => j.name },
              { header: "Job Type", value: (j: JobResult) => j.job_type },
              { header: "Status", value: (j: JobResult) => j.status },
              { header: "Created", value: (j: JobResult) => j.created },
              { header: "Started", value: (j: JobResult) => j.started ?? "" },
              { header: "Finished", value: (j: JobResult) => j.finished ?? "" },
              { header: "Launched By", value: (j: JobResult) => j.launched_by ?? "" },
            ]);

            const output = `Found ${result.total_jobs} job(s).\n\n${table}`;
            return {
              output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
              metadata: result as unknown as Record<string, unknown>,
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to fetch jobs: ${message}`,
              metadata: {
                schema_version: "1.0",
                total_jobs: 0,
                results: [],
                pages_fetched: 0,
                warning: `Failed to fetch jobs: ${message}`,
              },
            };
          }
        },
      }),

      "awx-launch-job": createLaunchJobTool(getAwxClient),

      "awx-job-status": createJobStatusTool(getAwxClient),

      "awx-wait-job": createWaitJobTool(getAwxClient),

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

          let awxClient: AwxClient;
          try {
            awxClient = await getAwxClient();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: message,
              metadata: {
                count: 0,
                results: [],
                next_page: null,
                error: message,
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
              try {
                const nextUrl = new URL(data.next);
                const pageParam = nextUrl.searchParams.get("page");
                if (pageParam) {
                  nextPage = Number.parseInt(pageParam, 10);
                }
              } catch {
                // Handle relative URLs (e.g., /api/v2/jobs/42/job_events/?page=2)
                const qs = data.next.includes("?") ? data.next.split("?")[1] ?? "" : "";
                const pageParam = new URLSearchParams(qs).get("page");
                if (pageParam) {
                  nextPage = Number.parseInt(pageParam, 10);
                }
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

      /**
       * Get individual resource detail from AWX.
       *
       * Generalized resource detail getter with type→endpoint dispatch.
       * Supports "template", "project", and "inventory" resource types.
       * Fetches the resource from the AWX API and returns structured
       * output in a standard envelope: { schema_version, resource_type, id, data }.
       *
       * For templates: returns name, description, job_type, resolved
       * inventory/project/organization names, playbook, verbosity,
       * boolean launch flags, last_job_run, status, next_schedule,
       * and labels.
       * For projects: returns id, name, scm_type, scm_url, scm_branch,
       * status, last_updated, organization_name, created_by, derived
       * success/failure flags.
       * For inventories: returns id, name, description, kind, host_count,
       * total_groups, has_inventory_sources, total_inventory_sources,
       * organization_name, and variables.
       */
      "awx-get-resource": tool({
        description: [
          "Get individual resource detail from AWX.",
          "Generalized resource detail getter with type→endpoint dispatch.",
          "Supports 'template', 'project', and 'inventory' resource types.",
          "Returns structured output in a standard envelope:",
          "{ schema_version, resource_type, id, data }.",
          "For templates: name, description, job_type, resolved names,",
          "playbook, verbosity, launch flags, last_job_run, status,",
          "next_schedule, and labels.",
          "For projects: id, name, scm_type, scm_url, scm_branch, status,",
          "last_updated, resolved organization_name and created_by, derived",
          "success/failure flags.",
          "For inventories: name, description, kind, host_count,",
          "total_groups, has_inventory_sources, total_inventory_sources,",
          "organization_name, and variables.",
        ].join(" "),
        args: {
          type: z
            .enum(["template", "project", "inventory"])
            .describe("Resource type to fetch. Supports: template, project, inventory"),
          id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the resource to fetch."),
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
            const result = await getResource(
              awxClient,
              args.type,
              args.id,
              context.abort,
            );

            return {
              output: formatResourceOutput(result),
              metadata: result,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message =
              err instanceof Error ? err.message : String(err);
            return {
              output: `awx-get-resource error: ${message}`,
            };
          }
        },
      }),

      /**
        * Create a new AWX project.
       *
       * Creates a project in AWX with the specified name and organization.
       * The organization_id must be a resolved numeric ID (not a name).
       * Optionally configure SCM type, URL, and description.
       * Delegates to crud.ts for the HTTP dispatch and mapProject for the response.
       * Returns the created project detail in the standard mutation envelope.
       */
      "awx-create-project": tool({
        description: [
          "Create a new AWX project with the specified name and organization.",
          "The organization_id must be a resolved numeric ID (not a name).",
          "Optionally configure SCM type with optional SCM source (git, svn, archive, insights, or manual), SCM URL, and description.",
          "Returns the created project detail in the standard mutation envelope.",
        ].join(" "),
        args: {
          name: z
            .string().min(1)
            .describe("Project name"),
          organization_id: z
            .number()
            .int()
            .positive()
            .describe("Resolved organization ID"),
          scm_type: z
            .enum(["", "git", "svn", "archive", "insights"])
            .optional()
            .describe("SCM type (git, svn, archive, insights, or empty for manual)"),
          scm_url: z
            .string()
            .optional()
            .describe("SCM URL (required if scm_type=git)"),
          description: z
            .string()
            .optional()
            .describe("Project description"),
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
            const body: Record<string, unknown> = {
              name: args.name,
              organization: args.organization_id,
            };
            if (args.scm_type !== undefined) body.scm_type = args.scm_type;
            if (args.scm_url !== undefined) body.scm_url = args.scm_url;
            if (args.description !== undefined) body.description = args.description;

            const result = await executeCrud(
              awxClient,
              "project",
              "create",
              undefined,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            const projectName = mutationOutput.data
              ? (mutationOutput.data as Record<string, unknown>).name as string ?? ""
              : "";
            return {
              output: `Project ${result.id} created successfully. Name: ${projectName}`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to create project: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "project",
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
       * Create a new AWX job template.
       *
       * Accepts template fields including name, job_type, project_id,
       * inventory_id, and playbook. The agent provides resolved IDs
       * (no internal name-to-ID resolution). Delegates to the shared
       * CRUD registry which maps to POST /api/v2/job_templates/.
       * Returns the created template detail wrapped in the standard
       * ResourceMutationOutput envelope.
       */
      "awx-create-template": tool({
        description: [
          "Create a new AWX job template. Accepts template fields",
          "including name, job_type, project_id, inventory_id,",
          "and playbook. Provide resolved IDs (not names).",
          "Returns the created template detail in the standard",
          "ResourceMutationOutput envelope.",
        ].join(" "),
        args: {
          name: z.string().min(1).describe("Template name"),
          job_type: z.enum(["run", "check", "scan"]).describe("Template job type"),
          project_id: z.number().int().positive().describe("Resolved AWX project ID"),
          inventory_id: z.number().int().positive().describe("Resolved AWX inventory ID"),
          playbook: z.string().min(1).describe("Playbook filename (e.g., site.yml)"),
          description: z.string().optional().describe("Optional template description"),
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
              job_type: args.job_type,
              project: args.project_id,
              inventory: args.inventory_id,
              playbook: args.playbook,
            };
            if (args.description !== undefined) {
              body.description = args.description;
            }

            const crudResult = await executeCrud(
              awxClient,
              "template",
              "create",
              undefined,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(crudResult);
            return {
              output: `Template ${crudResult.id} created.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `awx-create-template error: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "template",
                id: 0,
                data: null,
                warnings: [],
                errors: [message],
              },
            };
          }
        },
      }),

      /**
       * Create a new AWX inventory.
       *
       * Creates an inventory resource in AWX via POST /api/v2/inventories/.
       * Requires name and organization_id. The organization_id must be a
       * pre-resolved AWX organization ID (no internal name-to-ID resolution).
       * Optional description field is supported.
       *
       * Returns a ResourceMutationOutput envelope containing the created
       * inventory detail (mapped via mapInventory).
       */
      "awx-create-inventory": tool({
        description: [
          "Create a new AWX inventory.",
          "Requires name and organization_id (resolved organization ID).",
          "Optional description is supported.",
          "Returns created inventory detail in a standard mutation envelope.",
        ].join(" "),
        args: {
          name: z
            .string()
            .min(1)
            .describe("The name of the new inventory."),
          organization_id: z
            .number()
            .int()
            .positive()
            .describe("The resolved AWX organization ID to assign this inventory to."),
          description: z
            .string()
            .optional()
            .describe("Optional description for the inventory."),
        },
        async execute(args, context) {
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          let awxClient;
          try {
            awxClient = await getAwxClient();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: message,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "inventory",
                id: 0,
                data: null,
                warnings: [],
                errors: [message],
              },
            };
          }

          try {
            const body: Record<string, unknown> = {
              name: args.name,
              organization: args.organization_id,
            };
            if (args.description !== undefined) {
              body.description = args.description;
            }

            const result = await executeCrud(
              awxClient,
              "inventory",
              "create",
              undefined,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Inventory "${args.name}" created (ID ${result.id}).`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message =
              err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to create inventory: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "created",
                resource_type: "inventory",
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
       * Update an existing AWX project.
       *
       * Modifies an existing project by PATCHing the specified fields.
       * Only provided fields are updated (partial update semantics).
       * The organization_id must be a resolved numeric ID (not a name).
       * Delegates to crud.ts for the HTTP dispatch and mapProject for the response.
       * Returns the updated project detail in the standard mutation envelope.
       */
      "awx-update-project": tool({
        description: [
          "Update an existing AWX project by ID. Partial update — only",
          "provided fields are modified. Supports updating name,",
          "organization_id, scm_type (git, svn, archive, insights, or manual), scm_url, and description.",
          "Returns the updated project detail in the standard mutation envelope.",
        ].join(" "),
        args: {
          id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the AWX project to update."),
          name: z
            .string()
            .optional()
            .describe("New project name"),
          organization_id: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Resolved organization ID"),
          scm_type: z
            .enum(["", "git", "svn", "archive", "insights"])
            .optional()
            .describe("SCM type (git, svn, archive, insights, or empty for manual)"),
          scm_url: z
            .string()
            .optional()
            .describe("SCM URL"),
          description: z
            .string()
            .optional()
            .describe("Project description"),
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
            const body: Record<string, unknown> = {};
            if (args.name !== undefined) body.name = args.name;
            if (args.organization_id !== undefined) body.organization = args.organization_id;
            if (args.scm_type !== undefined) body.scm_type = args.scm_type;
            if (args.scm_url !== undefined) body.scm_url = args.scm_url;
            if (args.description !== undefined) body.description = args.description;

            const result = await executeCrud(
              awxClient,
              "project",
              "update",
              args.id,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Project ${result.id} updated successfully.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to update project ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "project",
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
       * Update an existing AWX job template.
       *
       * Accepts partial template fields (only the fields to change).
       * The id parameter is required to identify the template.
       * Delegates to the shared CRUD registry which maps to
       * PATCH /api/v2/job_templates/{id}/.
       * Returns the updated template detail in the standard
       * ResourceMutationOutput envelope.
       */
      "awx-update-template": tool({
        description: [
          "Update an existing AWX job template. Accepts partial",
          "template fields. The id parameter identifies the template.",
          "Provide resolved IDs (project_id, inventory_id) for any",
          "lookup fields being changed. Returns the updated template",
          "detail in the standard ResourceMutationOutput envelope.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the template to update"),
          name: z.string().min(1).optional().describe("Template name"),
          job_type: z.enum(["run", "check", "scan"]).optional().describe("Template job type"),
          project_id: z.number().int().positive().optional().describe("Resolved AWX project ID"),
          inventory_id: z.number().int().positive().optional().describe("Resolved AWX inventory ID"),
          playbook: z.string().min(1).optional().describe("Playbook filename (e.g., site.yml)"),
          description: z.string().optional().describe("Optional template description"),
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
            // Build body from only the fields that were provided (excluding id)
            const body: Record<string, unknown> = {};
            if (args.name !== undefined) body.name = args.name;
            if (args.job_type !== undefined) body.job_type = args.job_type;
            if (args.project_id !== undefined) body.project = args.project_id;
            if (args.inventory_id !== undefined) body.inventory = args.inventory_id;
            if (args.playbook !== undefined) body.playbook = args.playbook;
            if (args.description !== undefined) body.description = args.description;

            const crudResult = await executeCrud(
              awxClient,
              "template",
              "update",
              args.id,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(crudResult);
            return {
              output: `Template ${crudResult.id} updated.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `awx-update-template error: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "template",
                id: args.id ?? 0,
                data: null,
                warnings: [],
                errors: [message],
              },
            };
          }
        },
      }),

      /**
       * Update an existing AWX inventory.
       *
       * Modifies an inventory resource in AWX via PATCH /api/v2/inventories/<id>/.
       * Requires the inventory ID; name, description, and organization_id
       * are optional partial-update fields.
       *
       * Returns a ResourceMutationOutput envelope containing the updated
       * inventory detail (mapped via mapInventory).
       */
      "awx-update-inventory": tool({
        description: [
          "Update an existing AWX inventory by ID.",
          "Accepts partial fields (name, description, organization_id).",
          "Returns updated inventory detail in a standard mutation envelope.",
        ].join(" "),
        args: {
          id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the inventory to update."),
          name: z
            .string()
            .min(1)
            .optional()
            .describe("New name for the inventory."),
          description: z
            .string()
            .optional()
            .describe("New description for the inventory."),
          organization_id: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("New resolved organization ID for the inventory."),
        },
        async execute(args, context) {
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          let awxClient;
          try {
            awxClient = await getAwxClient();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: message,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "inventory",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              },
            };
          }

          try {
            const body: Record<string, unknown> = {};
            if (args.name !== undefined) {
              body.name = args.name;
            }
            if (args.description !== undefined) {
              body.description = args.description;
            }
            if (args.organization_id !== undefined) {
              body.organization = args.organization_id;
            }

            const result = await executeCrud(
              awxClient,
              "inventory",
              "update",
              args.id,
              body,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Inventory ${args.id} updated.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message =
              err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to update inventory ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "updated",
                resource_type: "inventory",
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
       * Delete an AWX project.
       *
       * Deletes a project by ID from AWX. This action is irreversible.
       * The project must exist and the user must have sufficient permissions.
       * Delegates to crud.ts for the HTTP dispatch.
       * Returns the standard mutation envelope with data: null on success.
       */
      "awx-delete-project": tool({
        description: [
          "Delete an AWX project by ID. This action is irreversible.",
          "The project must exist and the user must have sufficient",
          "permissions to delete it. Returns the standard mutation",
          "envelope with data: null on success.",
        ].join(" "),
        args: {
          id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the AWX project to delete."),
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
            const result = await executeCrud(
              awxClient,
              "project",
              "delete",
              args.id,
              undefined,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Project ${result.id} deleted successfully.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to delete project ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "project",
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
       * Delete an AWX job template.
       *
       * Accepts a template id and removes it from AWX.
       * Delegates to the shared CRUD registry which maps to
       * DELETE /api/v2/job_templates/{id}/.
       * Returns the standard ResourceMutationOutput envelope with
       * action "deleted" and data set to null.
       */
      "awx-delete-template": tool({
        description: [
          "Delete an AWX job template by ID. Delegates to the",
          "shared CRUD registry which maps to",
          "DELETE /api/v2/job_templates/{id}/.",
          "Returns the standard ResourceMutationOutput envelope",
          "with action 'deleted' and data set to null.",
        ].join(" "),
        args: {
          id: z.number().int().positive().describe("The numeric ID of the template to delete"),
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
            const crudResult = await executeCrud(
              awxClient,
              "template",
              "delete",
              args.id,
              undefined,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(crudResult);
            return {
              output: `Template ${args.id} deleted.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `awx-delete-template error: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "template",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              },
            };
          }
        },
      }),

      /**
       * Delete an AWX inventory.
       *
       * Removes an inventory resource from AWX via DELETE /api/v2/inventories/<id>/.
       * Requires the inventory ID. Returns a ResourceMutationOutput envelope
       * with data set to null.
       */
      "awx-delete-inventory": tool({
        description: [
          "Delete an AWX inventory by ID.",
          "Removes the inventory from AWX via DELETE /api/v2/inventories/<id>/.",
          "Returns a standard mutation envelope with data set to null.",
        ].join(" "),
        args: {
          id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the inventory to delete."),
        },
        async execute(args, context) {
          if (context.abort?.aborted) {
            return { output: "Request was aborted." };
          }

          let awxClient;
          try {
            awxClient = await getAwxClient();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: message,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "inventory",
                id: args.id,
                data: null,
                warnings: [],
                errors: [message],
              },
            };
          }

          try {
            const result = await executeCrud(
              awxClient,
              "inventory",
              "delete",
              args.id,
              undefined,
              context.abort,
            );

            const mutationOutput = wrapMutationResult(result);
            return {
              output: `Inventory ${args.id} deleted.`,
              metadata: mutationOutput as unknown as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message =
              err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to delete inventory ${args.id}: ${message}`,
              metadata: {
                schema_version: "1.0",
                action: "deleted",
                resource_type: "inventory",
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
       * Attach a credential to an AWX job template.
       *
       * Makes a POST request to /api/v2/job_templates/{job_template_id}/credentials/
       * with body { "id": credential_id }. Returns the AWX API response.
       */
      "awx-attach-credential": tool({
        description: [
          "Attach a credential to an AWX job template.",
          "Makes a POST request to",
          "/api/v2/job_templates/{job_template_id}/credentials/",
          "with body { \"id\": credential_id }.",
          "Returns the AWX API response body.",
        ].join(" "),
        args: {
          job_template_id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the AWX job template to attach the credential to."),
          credential_id: z
            .number()
            .int()
            .positive()
            .describe("The numeric ID of the credential to attach."),
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
            const result = await attachCredential(
              awxClient,
              args.job_template_id,
              args.credential_id,
              context.abort,
            );

            return {
              output: `Credential ${args.credential_id} attached to template ${args.job_template_id}.`,
              metadata: result as Record<string, unknown>,
            };
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") {
              return { output: "Request was aborted." };
            }
            const message = err instanceof Error ? err.message : String(err);
            return {
              output: `awx-attach-credential error: ${message}`,
            };
          }
        },
      }),

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
