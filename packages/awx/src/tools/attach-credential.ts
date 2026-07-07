/**
 * attach-credential.ts — Attach credential tool factory.
 *
 * awx-attach-credential: Attaches a credential to an AWX job template
 * via POST /api/v2/job_templates/{id}/credentials/.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { attachCredential } from "../attach-credential.js";

export function createAttachCredentialTool(getAwxClient: () => Promise<AwxClient>) {
  return tool({
    description: [
      "Attach one or more credentials to an AWX job template.",
      "Makes a POST request to",
      "/api/v2/job_templates/{job_template_id}/credentials/",
      'with body { "id": credential_id } for a single credential or',
      '{ "id": [id1, id2, ...] } for multiple credentials.',
      "Returns the AWX API response body.",
    ].join(" "),
    args: {
      job_template_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric ID of the AWX job template to attach the credential to."),
      credential_id: z
        .union([
          z.number().int().positive(),
          z.array(z.number().int().positive()).min(1),
        ])
        .describe(
          "The numeric ID of the credential to attach, or an array of credential IDs for multi-credential attachment.",
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
        const result = await attachCredential(
          awxClient,
          args.job_template_id,
          args.credential_id,
          context.abort,
        );

        const credentialDisplay = Array.isArray(args.credential_id)
          ? `[${args.credential_id.join(", ")}]`
          : String(args.credential_id);

        return {
          output: `Credential${Array.isArray(args.credential_id) ? "s" : ""} ${credentialDisplay} attached to template ${args.job_template_id}.`,
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
  });
}
