/**
 * get-resource.ts — Resource detail tool factory.
 *
 * awx-get-resource: Generalized individual resource detail getter
 * with type→endpoint dispatch.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { getResource } from "../get-resource.js";
import { formatResourceOutput } from "../utils.js";

export function createGetResourceTool(getAwxClient: () => Promise<AwxClient>) {
  return tool({
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
  });
}
