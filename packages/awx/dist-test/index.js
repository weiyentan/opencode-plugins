import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { createAwxAuthHook, validateToken } from "../dist/auth.js";
import { MetricsStore, setupMetricsPersistence } from "../dist/metrics.js";
import { createClient, createTimeoutSignal } from "../dist/client.js";
import { listTemplates } from "../dist/list-templates.js";
import { listProjects } from "../dist/list-projects.js";
import { launchJob } from "../dist/launch.js";
import { fetchJobStatus } from "../dist/job-status.js";

let customConfig;
function setCustomConfig(config) {
    customConfig = config;
}

export default async function server(input) {
  const { serverUrl } = input;
  const baseUrl = process.env.AWX_BASE_URL;

  const authHook = createAwxAuthHook();
  const metricsStore = new MetricsStore();
  try { await metricsStore.load(); } catch {}

  const persistence = setupMetricsPersistence(metricsStore, 30_000, (err) => {
    try {
      input.client.app?.log?.({ body: { service: "plugin-awx", level: "error", message: `Metrics persistence failed: ${err instanceof Error ? err.message : String(err)}` } });
    } catch {}
  });

  let cachedClient;
  let cachedToken;

  async function getAwxClient() {
    const resolvedBaseUrl = customConfig?.baseUrl ?? baseUrl;
    if (!resolvedBaseUrl) return undefined;
    const token = customConfig?.token ?? process.env.AWX_TOKEN;
    if (!token) return undefined;
    const tokenString = String(token);
    if (!cachedClient || cachedToken !== tokenString) {
      cachedToken = tokenString;
      cachedClient = createClient(resolvedBaseUrl, tokenString, { metricsStore });
    }
    return cachedClient;
  }

  if (baseUrl) {
    try {
      const storedKey = await input.client.getSecret?.("awx");
      if (storedKey) {
        const { signal, clear } = createTimeoutSignal(10_000);
        try {
          const result = await validateToken(baseUrl, String(storedKey), signal);
          void input.client.app.log({ body: { service: "plugin-awx", level: result.valid ? "info" : "error", message: result.valid ? `Token validated against ${baseUrl}` : `Validation failed: ${result.error}` } });
        } finally { clear(); }
      }
    } catch {
      void input.client.app.log({ body: { service: "plugin-awx", level: "info", message: "No stored token found." } });
    }
  }

  return {
    auth: authHook,
    dispose: async () => { await persistence.clear(); },
    tool: {
      ping: tool({
        description: "Ping tool",
        args: {},
        execute: async () => ({ output: "pong" }),
      }),
      hello: tool({
        description: [`Returns a hello world greeting. Sanity-check tool.`, `AWX plugin server (connected to ${serverUrl.href}).`].join(" "),
        args: { name: z.string().optional().describe("Name to greet.") },
        async execute(args) { return { output: `Hello, ${args.name ?? "world"}!` }; },
      }),
      "awx-configure": tool({
        description: "Configure AWX connection settings.",
        args: {
          baseUrl: z.string().optional().describe("AWX base URL"),
          token: z.string().optional().describe("AWX PAT"),
        },
        async execute(args) {
          if (!args.baseUrl && !args.token) return { output: "Provide baseUrl or token." };
          setCustomConfig({ baseUrl: args.baseUrl, token: args.token });
          return { output: "AWX client configured and ready." };
        },
      }),
      "awx-sync-project": tool({
        description: "Trigger an SCM sync on an AWX project by project ID.",
        args: { project_id: z.number().int().positive().describe("The numeric ID of the AWX project to sync.") },
        async execute(args, context) {
          if (context.abort?.aborted) return { output: "Request was aborted." };
          const awxClient = await getAwxClient();
          if (!awxClient) return { output: "AWX client not available. Set AWX_BASE_URL and AWX_TOKEN." };
          try {
            const projectRes = await awxClient.request("awx-sync-project", `/api/v2/projects/${args.project_id}/`, { method: "GET" }, context.abort);
            if (!projectRes.ok) return { output: `Project fetch failed: HTTP ${projectRes.status}` };
            const project = await projectRes.json();
            const updateRes = await awxClient.request("awx-sync-project", `/api/v2/projects/${args.project_id}/update/`, { method: "POST" }, context.abort);
            if (!updateRes.ok) return { output: `Update trigger failed: HTTP ${updateRes.status}` };
            const update = await updateRes.json();
            return { output: `SCM sync triggered for "${project.name}" (ID ${args.project_id}). Update ID: ${update.id}, status: ${update.status}.`, metadata: { project_update_id: update.id, status: update.status, project_name: project.name } };
          } catch (err) { return { output: `Error syncing project ${args.project_id}: ${err instanceof Error ? err.message : String(err)}` }; }
        },
      }),
      "awx-get-job-events": tool({
        description: "Get job events from an AWX job.",
        args: {
          job_id: z.number().int().positive().describe("AWX job ID"),
          event_filter: z.string().optional().describe("Optional event type filter"),
          page: z.number().int().positive().optional().describe("Page number"),
        },
        async execute(args, context) {
          if (context.abort?.aborted) return { output: "Request was aborted." };
          const awxClient = await getAwxClient();
          if (!awxClient) return { output: "AWX client not available. Set AWX_BASE_URL and AWX_TOKEN." };
          try {
            const params = new URLSearchParams();
            if (args.event_filter) params.set("event", args.event_filter);
            if (args.page) params.set("page", String(args.page));
            const qs = params.toString();
            const path = `/api/v2/jobs/${args.job_id}/job_events/${qs ? `?${qs}` : ""}`;
            const response = await awxClient.request("awx-get-job-events", path, undefined, context.abort);
            if (!response.ok) return { output: `AWX API error: ${response.status}` };
            const data = await response.json();
            return { output: `Found ${data.count ?? 0} event(s).`, metadata: { count: data.count ?? 0, results: data.results ?? [] } };
          } catch (err) { return { output: `Failed to get job events: ${err instanceof Error ? err.message : String(err)}` }; }
        },
      }),
      "awx-list-templates": tool({
        description: "List AWX job templates with pagination.",
        args: {
          pageSize: z.number().int().min(1).max(200).optional().describe("Items per page (1-200, default: 50)"),
          maxPages: z.number().int().min(0).optional().describe("Maximum pages to fetch (0 = no cap, default: 5)"),
        },
        async execute(args, context) {
          if (context.abort?.aborted) return { output: "Request was aborted." };
          const awxClient = await getAwxClient();
          if (!awxClient) return { output: "AWX client not available. Set AWX_BASE_URL and AWX_TOKEN." };
          try {
            const result = await listTemplates(awxClient, 30_000, { pageSize: args.pageSize, maxPages: args.maxPages }, context.abort);
            return { output: `Found ${result.count} template(s).`, metadata: result };
          } catch (err) { return { output: `Failed to fetch templates: ${err instanceof Error ? err.message : String(err)}` }; }
        },
      }),
      "awx-list-projects": tool({
        description: "List AWX projects with pagination.",
        args: {
          maxPages: z.number().int().min(1).max(100).optional().describe("Maximum pages to fetch (default: 5, max: 100)."),
          pageSize: z.number().int().min(1).max(200).optional().describe("Items per page (default: 50, max: 200)."),
          timeout: z.number().int().min(1000).optional().describe("Total tool timeout in milliseconds (default: 30000)."),
        },
        async execute(args, context) {
          if (context.abort?.aborted) return { output: "Request was aborted." };
          const awxClient = await getAwxClient();
          if (!awxClient) return { output: "AWX client not available. Set AWX_BASE_URL and AWX_TOKEN." };
          try {
            const result = await listProjects(awxClient, { maxPages: args.maxPages, pageSize: args.pageSize, timeout: args.timeout, abortSignal: context.abort });
            return { output: `Found ${result.count} project(s).`, metadata: result };
          } catch (err) { return { output: `Failed to list projects: ${err instanceof Error ? err.message : String(err)}` }; }
        },
      }),
      "awx-launch-job": tool({
        description: "Launch an AWX job template by ID with extra-vars transforms.",
        args: {
          template_id: z.number().int().positive().describe("The AWX job template ID to launch."),
          extra_vars: z.record(z.string(), z.unknown()).optional().describe("Extra variables to pass to the job template."),
        },
        async execute(args, context) {
          if (context.abort?.aborted) return { output: "Request was aborted." };
          const awxClient = await getAwxClient();
          if (!awxClient) return { output: "AWX client not available. Set AWX_BASE_URL and AWX_TOKEN." };
          try {
            const result = await launchJob(awxClient, args.template_id, args.extra_vars, { abortSignal: context.abort });
            return { output: result.jobId > 0 ? `Job ${result.jobId} launched (${result.jobStatus}).` : "Launch aborted due to transform errors.", metadata: result };
          } catch (err) { return { output: `Failed to launch job: ${err instanceof Error ? err.message : String(err)}` }; }
        },
      }),
      "awx-job-status": tool({
        description: "Fetch detailed status of an AWX job by job ID.",
        args: {
          job_id: z.number().int().positive().describe("The numeric ID of the AWX job to check."),
          include_stdout: z.boolean().optional().describe("If true, fetch and include the full job stdout text."),
        },
        async execute(args, context) {
          if (context.abort?.aborted) return { output: "Request was aborted." };
          const awxClient = await getAwxClient();
          if (!awxClient) return { output: "AWX client not available. Set AWX_BASE_URL and AWX_TOKEN." };
          try {
            const result = await fetchJobStatus(awxClient, args.job_id, args.include_stdout, context.abort);
            return { output: `Job ${args.job_id} status: ${result?.job?.status ?? "unknown"}`, metadata: result };
          } catch (err) { return { output: `awx-job-status error: ${err instanceof Error ? err.message : String(err)}` }; }
        },
      }),
      "awx-wait-job": tool({
        description: "Returns the current status of an AWX job by job ID. NON-BLOCKING: call awx-job-status in a loop to wait.",
        args: { job_id: z.number().int().positive().describe("The AWX job ID to check status for") },
        async execute(args, context) {
          if (context.abort?.aborted) return { output: "Request was aborted." };
          const awxClient = await getAwxClient();
          if (!awxClient) return { output: "AWX client not available. Set AWX_BASE_URL and AWX_TOKEN." };
          try {
            const result = await fetchJobStatus(awxClient, args.job_id, false, context.abort, "awx-wait-job");
            return { output: `Job ${args.job_id} status: ${result.job.status}`, metadata: result };
          } catch (err) { return { output: `awx-wait-job error: ${err instanceof Error ? err.message : String(err)}` }; }
        },
      }),
    },
  };
}
