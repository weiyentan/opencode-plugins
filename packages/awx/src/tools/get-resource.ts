/**
 * get-resource.ts — awx-get-resource Tool Factory
 *
 * Extracted from index.ts. Registers the "awx-get-resource" tool
 * via a createGetResourceTool factory function that receives a
 * lazy-resolved getAwxClient function.
 *
 * The tool calls getResource() from ../get-resource.js which dispatches
 * to the appropriate mapper based on resource type. The factory wrapper
 * validates args, calls getResource, and returns the result formatted
 * via formatResourceOutput for human-readable display.
 */
import { tool } from "@opencode-ai/plugin";
import type { AwxClient } from "../client.js";
import { getResource } from "../get-resource.js";
import type { ResourceDetailOutput } from "../get-resource.js";

const z = tool.schema;

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
 * Create the "awx-get-resource" tool registration.
 *
 * The tool provides generalized resource detail retrieval:
 * fetches a single resource (template, project, or inventory) by ID,
 * returns structured output with resolved names and derived fields.
 *
 * @param getAwxClient — a lazy-resolved function returning the AWX HTTP client
 * @returns Tool registration object for the OpenCode plugin system
 */
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
