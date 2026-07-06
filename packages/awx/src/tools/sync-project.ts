/**
 * sync-project.ts — Sync project tool factory.
 *
 * awx-sync-project: Triggers an SCM sync on an AWX project by project ID.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { formatErrorResponse } from "../utils.js";

export function createSyncProjectTool(getAwxClient: () => Promise<AwxClient>) {
  return tool({
    description: [
      "Trigger an SCM sync on an AWX project by project ID.",
      "Fetches project details, triggers the update, and returns",
      "the project update ID, status, and project metadata.",
      "Sync is async — poll the project update status separately.",
    ].join(" "),
    args: {
      project_id: z
        .number()
        .int()
        .positive()
        .describe("The numeric ID of the AWX project to sync."),
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

      const toolName = "awx-sync-project";
      const { project_id } = args;

      try {
        // Step 1: Fetch project details
        const projectRes = await awxClient.request(
          toolName,
          `/api/v2/projects/${project_id}/`,
          { method: "GET" },
          context.abort,
        );

        if (!projectRes.ok) {
          return { output: formatErrorResponse(project_id, projectRes.status) };
        }

        const project = (await projectRes.json()) as Record<string, unknown>;

        // Step 2: Trigger SCM update
        const updateRes = await awxClient.request(
          toolName,
          `/api/v2/projects/${project_id}/update/`,
          { method: "POST" },
          context.abort,
        );

        if (!updateRes.ok) {
          return { output: formatErrorResponse(project_id, updateRes.status) };
        }

        const projectUpdate = (await updateRes.json()) as Record<string, unknown>;

        // Step 3: Return structured output
        const projectName = (project.name as string) ?? "";
        const status = projectUpdate.status as string;

        return {
          output: [
            `SCM sync triggered for project "${projectName}" (ID ${project_id}).`,
            `Project update ID: ${projectUpdate.id as number}, status: ${status}.`,
          ].join(" "),
          metadata: {
            project_update_id: projectUpdate.id as number,
            status,
            project_name: projectName,
            project_id,
            url: (project.url as string) ?? "",
            scm_type: (project.scm_type as string) ?? "",
            last_updated: (project.last_updated as string) ?? "",
          },
        };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { output: "Request was aborted." };
        }
        return {
          output:
            `[awx-sync-project] Unexpected error syncing project ${project_id}: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  });
}
