/**
 * attach-credential.ts — Tool factory for attaching credentials to AWX job templates.
 *
 * Wraps attachCredential() from the parent module into a registered tool,
 * following the factory pattern used across the AWX plugin.
 */
import { tool } from "@opencode-ai/plugin";
import type { AwxClient } from "../client.js";
import { attachCredential } from "../attach-credential.js";

const z = tool.schema;

/**
 * Factory that creates the `awx-attach-credential` tool.
 *
 * @param getAwxClient - Async resolver that returns an authenticated AwxClient
 * @returns A tool registration object compatible with the plugin's tool map
 */
export function createAttachCredentialTool(
  getAwxClient: () => Promise<AwxClient>,
) {
  return tool({
    description: [
      "Attach a credential to an AWX job template.",
      "Makes a POST request to",
      "/api/v2/job_templates/{job_template_id}/credentials/",
      'with body { "id": credential_id }.',
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
        if (err instanceof Error && err.name === "AbortError") {
          return { output: "Request was aborted." };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          output: `awx-attach-credential error: ${message}`,
        };
      }
    },
  });
}
