/**
 * launch-workflow.ts — Tool factory for awx-launch-workflow.
 *
 * Provides the tool definition for launching a workflow job template,
 * following the same pattern as awx-launch-job in job-lifecycle.ts.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { launchWorkflow } from "../launch-workflow.js";

export function createLaunchWorkflowTool(getAwxClient: () => Promise<AwxClient>) {
  return {
    /**
     * Launch an AWX workflow job template by ID.
     *
     * Passes raw extra_vars directly to POST
     * /api/v2/workflow_job_templates/{id}/launch/ and returns
     * the raw AWX API response.
     */
    "awx-launch-workflow": tool({
      description: [
        "Launch an AWX workflow job template by ID with extra-vars.",
        "Passes extra_vars directly to POST",
        "/api/v2/workflow_job_templates/{id}/launch/ and returns",
        "the raw AWX API response body.",
      ].join(" "),
      args: {
        template_id: z
          .number()
          .int()
          .positive()
          .describe("The AWX workflow job template ID to launch."),
        extra_vars: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Extra variables to pass to the workflow job template as a key-value object.",
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
          const result = await launchWorkflow(
            awxClient,
            args.template_id,
            args.extra_vars,
            context.abort,
          );

          // Format output like the issue spec:
          // "Workflow job template {id} launched. Workflow job #{job_id}. Status: {status}"
          const jobId = (result as Record<string, unknown>).id;
          const status = (result as Record<string, unknown>).status ?? "unknown";

          return {
            output: `Workflow job template ${args.template_id} launched. Workflow job #${String(jobId)}. Status: ${String(status)}`,
            metadata: result as Record<string, unknown>,
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to launch workflow: ${message}`,
          };
        }
      },
    }),
  };
}
