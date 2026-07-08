/**
 * detach-credential.ts — Detach credential tool factory.
 *
 * awx-detach-credential: Detaches a credential from an AWX job template
 * via POST /api/v2/job_templates/{id}/credentials/ with disassociate: true.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { detachCredential } from "../detach-credential.js";

export function createDetachCredentialTool(getAwxClient: () => Promise<AwxClient>) {
  return tool({
    description: [
      "Detach one or more credentials from an AWX job template.",
      "Makes a POST request to",
      "/api/v2/job_templates/{job_template_id}/credentials/",
      'with body { "id": credential_id, "disassociate": true } for a single credential.',
      "For multiple credentials, makes one POST per credential ID",
      "(individual per-credential POSTs, not a single array payload).",
      "Returns the AWX API response body.",
    ].join(" "),
    args: {
      job_template_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric ID of the AWX job template to detach the credential from."),
      credential_id: z
        .union([
          z.number().int().positive(),
          z.array(z.number().int().positive()).min(1),
        ])
        .describe(
          "The numeric ID of the credential to detach, or an array of credential IDs for multi-credential detachment.",
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
        const result = await detachCredential(
          awxClient,
          args.job_template_id,
          args.credential_id,
          context.abort,
        );

        const credentialDisplay = Array.isArray(args.credential_id)
          ? `[${args.credential_id.join(", ")}]`
          : String(args.credential_id);

        return {
          output: `Credential${Array.isArray(args.credential_id) ? "s" : ""} ${credentialDisplay} detached from template ${args.job_template_id}.`,
          metadata: result as Record<string, unknown>,
        };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { output: "Request was aborted." };
        }
        const message = err instanceof Error ? err.message : String(err);
        return {
          output: `awx-detach-credential error: ${message}`,
        };
      }
    },
  });
}
