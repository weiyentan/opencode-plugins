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
import { launchJob } from "./launch.js";
import { fetchJobStatus } from "./job-status.js";
import { getResource } from "./get-resource.js";
import type { ResourceDetailOutput } from "./get-resource.js";
import { attachCredential } from "./attach-credential.js";
import { createCrudTools } from "./tools/crud.js";

import { getCustomConfig, setCustomConfig } from "./runtime-config.js";
import { formatErrorResponse } from "./utils.js";
import { createHelloTool } from "./tools/hello.js";

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
      /**
       * Hello-world tool — Phase 0 scaffolding tracer.
       *
       * Verifies that tools can be registered, invoked, and hot-reloaded
       * by the OpenCode plugin server. This tool exercises the full plugin
       * lifecycle: import, register, execute, return.
       */
      hello: createHelloTool(getAwxClient),

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

      /**
       * Launch an AWX job template by ID.
       *
       * Passes raw extra_vars directly to POST
       * /api/v2/job_templates/{id}/launch/ and returns the raw AWX
       * API response.
       */
      "awx-launch-job": tool({
        description: [
          "Launch an AWX job template by ID with extra-vars.",
          "Passes extra_vars directly to POST",
          "/api/v2/job_templates/{id}/launch/ and returns",
          "the raw AWX API response body.",
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
              "Extra variables to pass to the job template as a key-value object.",
            ),
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
            const result = await launchJob(
              awxClient,
              args.template_id,
              args.extra_vars,
              context.abort,
            );

            return {
              output: JSON.stringify(result),
              metadata: result as Record<string, unknown>,
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err);
            return {
              output: `Failed to launch job: ${message}`,
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

          let awxClient: AwxClient;
          try {
            awxClient = await getAwxClient();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: message };
          }

          try {
            const result = await fetchJobStatus(
              awxClient,
              args.job_id,
              args.include_stdout,
              context.abort,
            );

            return {
              output: JSON.stringify(result),
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

          let awxClient: AwxClient;
          try {
            awxClient = await getAwxClient();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { output: message };
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
              output: JSON.stringify(result),
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

      ...createCrudTools(getAwxClient),

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
