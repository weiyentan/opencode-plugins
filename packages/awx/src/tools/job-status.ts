/**
 * job-status.ts — Job lifecycle tool factories
 *
 * Provides three factory functions for the job lifecycle triad:
 * - createLaunchJobTool  → ^awx-launch-job
 * - createJobStatusTool  → ^awx-job-status
 * - createWaitJobTool    → ^awx-wait-job
 *
 * Each factory follows the established pattern (see tools/hello.ts):
 * receives `getAwxClient` as a closure parameter to avoid circular
 * dependencies on the index.ts client resolver.
 */
import { tool } from "@opencode-ai/plugin";
const z = tool.schema;

import type { AwxClient } from "../client.js";
import { launchJob } from "../launch.js";
import { fetchJobStatus } from "../job-status.js";

// ─── Factory: awx-launch-job ────────────────────────────────────

/**
 * Create the `awx-launch-job` tool.
 *
 * Launches an AWX job template by ID, passing raw extra_vars directly to
 * POST /api/v2/job_templates/{id}/launch/.
 */
export function createLaunchJobTool(
  getAwxClient: () => Promise<AwxClient>,
) {
  return tool({
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
  });
}

// ─── Factory: awx-job-status ────────────────────────────────────

/**
 * Create the `awx-job-status` tool.
 *
 * Fetches detailed job status from /api/v2/jobs/<id>/ and returns
 * structured output matching the JobDetailOutput v1.0 contract.
 * Supports optional --include-stdout to include full job console output.
 */
export function createJobStatusTool(
  getAwxClient: () => Promise<AwxClient>,
) {
  return tool({
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
  });
}

// ─── Factory: awx-wait-job ──────────────────────────────────────

/**
 * Create the `awx-wait-job` tool.
 *
 * Returns the current status of an AWX job by job ID (non-blocking).
 * The agent should call this in a loop to poll for job completion,
 * checking for a terminal status (successful, failed, etc.).
 *
 * This is a NON-BLOCKING tool — it returns immediately with the current
 * job status without waiting for job completion.
 */
export function createWaitJobTool(
  getAwxClient: () => Promise<AwxClient>,
) {
  return tool({
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
  });
}
