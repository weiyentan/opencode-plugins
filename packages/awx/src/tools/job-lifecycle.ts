/**
 * job-lifecycle.ts — Job lifecycle tool factories.
 *
 * Combines awx-launch-job, awx-job-status, and awx-wait-job into a single
 * factory function for shared client resolution.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { launchJob } from "../launch.js";
import { fetchJobStatus } from "../job-status.js";

export function createJobLifecycleTools(getAwxClient: () => Promise<AwxClient>) {
  return {
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
  };
}
