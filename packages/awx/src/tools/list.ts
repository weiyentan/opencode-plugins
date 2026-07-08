/**
 * list.ts — List tools factory.
 *
 * Combines awx-list-templates, awx-list-projects, and awx-list-jobs
 * into a single factory function for shared client resolution.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import type { MetricsStore } from "../metrics.js";
import { listTemplates, type TemplateResult } from "../list-templates.js";
import { listProjects } from "../list-projects.js";
import { listJobs } from "../list-jobs.js";
import type { JobResult } from "../list-jobs.js";
import { buildPipeTable } from "../utils.js";
import { listOrganizations, type Organization } from "../list-organizations.js";
import { listCredentials, type Credential } from "../list-credentials.js";
import { listInventories, type Inventory } from "../list-inventories.js";
import { listUsers, type User } from "../list-users.js";
import { listTeams, type Team } from "../list-teams.js";
import { listWorkflowTemplates, type WorkflowTemplate } from "../list-workflow-templates.js";

export function createListTools(
  getAwxClient: () => Promise<AwxClient>,
  _metricsStore?: MetricsStore,
) {
  return {
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
     * List AWX organizations with pagination.
     *
     * Fetches organizations from the AWX /api/v2/organizations/ endpoint,
     * consolidating results across multiple pages up to a configurable
     * page cap. Results are sorted alphabetically by name.
     *
     * Pagination behavior:
     * - Default: up to 5 pages × 50 items/page = 250 items max
     * - If more pages exist beyond the cap, returns a warning field
     * - Per-page timeout: total tool timeout / (maxPages + 1)
     */
    "awx-list-organizations": tool({
      description: [
        "List AWX organizations with pagination. Fetches organizations from",
        "the AWX /api/v2/organizations/ endpoint, consolidating results",
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
          .describe("Filter organizations by field (e.g., --filter name__icontains=workspace)"),
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
          const result = await listOrganizations(awxClient, {
            maxPages: args.maxPages,
            pageSize: args.pageSize,
            timeout: args.timeout,
            abortSignal: context.abort,
            filters: args.filter,
          });

          const table = buildPipeTable(result.results, [
            { header: "ID", value: (o: Organization) => String(o.id) },
            { header: "Name", value: (o: Organization) => o.name },
            { header: "Description", value: (o: Organization) => o.description },
          ]);

          const output = `Found ${result.count} organization(s).\n\n${table}`;
          return {
            output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
            metadata: result as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to list organizations: ${message}`,
            metadata: { error: message },
          };
        }
      },
    }),

    /**
     * List AWX credentials with pagination.
     *
     * Fetches credentials from the AWX /api/v2/credentials/ endpoint,
     * consolidating results across multiple pages up to a configurable
     * page cap. Results are sorted alphabetically by name.
     *
     * Pagination behavior:
     * - Default: up to 5 pages × 50 items/page = 250 items max
     * - If more pages exist beyond the cap, returns a warning field
     * - Per-page timeout: total tool timeout / (maxPages + 1)
     */
    "awx-list-credentials": tool({
      description: [
        "List AWX credentials with pagination. Fetches credentials from",
        "the AWX /api/v2/credentials/ endpoint, consolidating results",
        "across multiple pages up to a configurable page cap.",
        "Results are sorted alphabetically by name. Supports",
        "server-side filtering by name, credential type, and organization.",
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
          .describe("Filter credentials by field (e.g., --filter name__icontains=ssh)"),
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
          const result = await listCredentials(awxClient, {
            maxPages: args.maxPages,
            pageSize: args.pageSize,
            timeout: args.timeout,
            abortSignal: context.abort,
            filters: args.filter,
          });

          const table = buildPipeTable(result.results, [
            { header: "ID", value: (c: Credential) => String(c.id) },
            { header: "Name", value: (c: Credential) => c.name },
            { header: "Type", value: (c: Credential) => c.summary_fields?.credential_type?.name ?? String(c.credential_type) },
            { header: "Org", value: (c: Credential) => c.summary_fields?.organization?.name ?? "" },
            { header: "Description", value: (c: Credential) => c.description },
          ]);

          const output = `Found ${result.count} credential(s).\n\n${table}`;
          return {
            output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
            metadata: result as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to list credentials: ${message}`,
            metadata: { error: message },
          };
        }
      },
    }),

    /**
     * List AWX inventories with pagination.
     *
     * Fetches inventories from the AWX /api/v2/inventories/ endpoint,
     * consolidating results across multiple pages up to a configurable
     * page cap. Results are sorted alphabetically by name.
     *
     * Pagination behavior:
     * - Default: up to 5 pages × 50 items/page = 250 items max
     * - If more pages exist beyond the cap, returns a warning field
     * - Per-page timeout: total tool timeout / (maxPages + 1)
     */
    "awx-list-inventories": tool({
      description: [
        "List AWX inventories with pagination. Fetches inventories from",
        "the AWX /api/v2/inventories/ endpoint, consolidating results",
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
          .describe("Filter inventories by field (e.g., --filter name__icontains=workspace)"),
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
          const result = await listInventories(awxClient, {
            maxPages: args.maxPages,
            pageSize: args.pageSize,
            timeout: args.timeout,
            abortSignal: context.abort,
            filters: args.filter,
          });

          const table = buildPipeTable(result.results, [
            { header: "ID", value: (i: Inventory) => String(i.id) },
            { header: "Name", value: (i: Inventory) => i.name },
            { header: "Kind", value: (i: Inventory) => i.kind || "(normal)" },
            { header: "Hosts", value: (i: Inventory) => String(i.host_count) },
            { header: "Groups", value: (i: Inventory) => String(i.total_groups) },
            { header: "Org", value: (i: Inventory) => i.summary_fields?.organization?.name ?? "" },
            { header: "Description", value: (i: Inventory) => i.description },
          ]);

          const output = `Found ${result.count} inventories.\n\n${table}`;
          return {
            output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
            metadata: result as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to list inventories: ${message}`,
            metadata: { error: message },
          };
        }
      },
    }),

    /**
     * List AWX users with pagination.
     *
     * Fetches users from the AWX /api/v2/users/ endpoint,
     * consolidating results across multiple pages up to a configurable
     * page cap. Results are sorted alphabetically by username. Supports
     * server-side filtering.
     *
     * Pagination behavior:
     * - Default: up to 5 pages × 50 items/page = 250 items max
     * - If more pages exist beyond the cap, returns a warning field
     * - Per-page timeout: total tool timeout / (maxPages + 1)
     */
    "awx-list-users": tool({
      description: [
        "List AWX users with pagination. Fetches users from",
        "the AWX /api/v2/users/ endpoint, consolidating results",
        "across multiple pages up to a configurable page cap.",
        "Results are sorted alphabetically by username. Supports",
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
          .describe("Filter users by field (e.g., --filter username__icontains=admin)"),
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
          const result = await listUsers(awxClient, {
            maxPages: args.maxPages,
            pageSize: args.pageSize,
            timeout: args.timeout,
            abortSignal: context.abort,
            filters: args.filter,
          });

          const table = buildPipeTable(result.results, [
            { header: "ID", value: (u: User) => String(u.id) },
            { header: "Username", value: (u: User) => u.username },
            { header: "First Name", value: (u: User) => u.first_name },
            { header: "Last Name", value: (u: User) => u.last_name },
            { header: "Email", value: (u: User) => u.email },
            { header: "Superuser", value: (u: User) => String(u.is_superuser) },
            { header: "Auditor", value: (u: User) => String(u.is_system_auditor) },
          ]);

          const output = `Found ${result.count} user(s).\n\n${table}`;
          return {
            output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
            metadata: result as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to list users: ${message}`,
            metadata: { error: message },
          };
        }
      },
    }),

    /**
     * List AWX workflow job templates with pagination.
     *
     * Fetches workflow job templates from the AWX /api/v2/workflow_job_templates/ endpoint,
     * consolidating results across multiple pages up to a configurable page cap.
     * Results are sorted alphabetically by name. Supports server-side filtering.
     *
     * Pagination behavior:
     * - Default: up to 5 pages × 50 items/page = 250 items max
     * - If more pages exist beyond the cap, returns a warning field
     * - Per-page timeout: total tool timeout / (maxPages + 1)
     */
    "awx-list-workflow-templates": tool({
      description: [
        "List AWX workflow job templates with pagination. Fetches workflow",
        "job templates from /api/v2/workflow_job_templates/, consolidating",
        "across pages up to a configurable cap. Results sorted by name.",
        "Supports page size override, server-side filtering, and",
        "configurable timeout. Returns warning when page cap limits results.",
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
          .describe("Filter workflow job templates by field (e.g., --filter name__icontains=workspace)"),
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
          const result = await listWorkflowTemplates(awxClient, {
            maxPages: args.maxPages,
            pageSize: args.pageSize,
            timeout: args.timeout,
            abortSignal: context.abort,
            filters: args.filter,
          });

          const table = buildPipeTable(result.results, [
            { header: "ID", value: (w: WorkflowTemplate) => String(w.id) },
            { header: "Name", value: (w: WorkflowTemplate) => w.name },
            { header: "Description", value: (w: WorkflowTemplate) => w.description },
            { header: "Organization", value: (w: WorkflowTemplate) => w.summary_fields?.organization?.name ?? "" },
          ]);

          const output = `Found ${result.count} workflow job template(s).\n\n${table}`;
          return {
            output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
            metadata: result as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to list workflow job templates: ${message}`,
            metadata: { error: message },
          };
        }
      },
    }),

    /**
     * List AWX teams with pagination.
     *
     * Fetches teams from the AWX /api/v2/teams/ endpoint,
     * consolidating results across multiple pages up to a configurable
     * page cap. Results are sorted alphabetically by name. Supports
     * server-side filtering.
     *
     * Pagination behavior:
     * - Default: up to 5 pages × 50 items/page = 250 items max
     * - If more pages exist beyond the cap, returns a warning field
     * - Per-page timeout: total tool timeout / (maxPages + 1)
     */
    "awx-list-teams": tool({
      description: [
        "List AWX teams with pagination. Fetches teams from",
        "the AWX /api/v2/teams/ endpoint, consolidating results",
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
          .describe("Filter teams by field (e.g., --filter name__icontains=engineering)"),
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
          const result = await listTeams(awxClient, {
            maxPages: args.maxPages,
            pageSize: args.pageSize,
            timeout: args.timeout,
            abortSignal: context.abort,
            filters: args.filter,
          });

          const table = buildPipeTable(result.results, [
            { header: "ID", value: (t: Team) => String(t.id) },
            { header: "Name", value: (t: Team) => t.name },
            { header: "Description", value: (t: Team) => t.description },
            { header: "Org", value: (t: Team) => t.summary_fields?.organization?.name ?? "" },
            { header: "Users", value: (t: Team) => String(t.summary_fields?.user_count ?? "") },
          ]);

          const output = `Found ${result.count} team(s).\n\n${table}`;
          return {
            output: result.warning ? `Warning: ${result.warning}\n\n${output}` : output,
            metadata: result as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to list teams: ${message}`,
            metadata: { error: message },
          };
        }
      },
    }),
  };
}
