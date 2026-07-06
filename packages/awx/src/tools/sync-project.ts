/**
 * sync-project.ts — AWX sync-project tool factory
 *
 * Encapsulates the complete awx-sync-project tool registration (description,
 * args schema, and execute handler) including the 2-step SCM sync flow:
 * 1. GET /api/v2/projects/{id}/   — fetch project details
 * 2. POST /api/v2/projects/{id}/update/ — trigger SCM update
 *
 * The factory function createSyncProjectTool takes a getAwxClient callback
 * for lazy client resolution, matching the existing pattern in index.ts.
 */
import { tool } from "@opencode-ai/plugin";
import type { AwxClient } from "../client.js";

const z = tool.schema;

/**
 * Format a user-facing error message for HTTP error responses.
 *
 * Maps HTTP status codes to meaningful error messages the agent
 * can act on (e.g., "not found", "not authorized").
 */
function formatErrorResponse(projectId: number, status: number): string {
  switch (status) {
    case 404:
      return `Project ${projectId} not found. Verify the project ID and try again.`;
    case 401:
    case 403:
      return (
        `Not authorized to sync project ${projectId}. ` +
        "Check your Personal Access Token permissions."
      );
    default:
      return (
        `Failed to sync project ${projectId}. ` +
        `AWX API returned HTTP ${status}.`
      );
  }
}

/**
 * Create the awx-sync-project tool registration.
 *
 * Returns a complete tool registration object (description, args schema,
 * and execute handler) that can be used directly in the plugin's
 * `tool` hook map.
 *
 * The 2-step SCM sync flow:
 * 1. GET /api/v2/projects/{id}/     → fetch project details
 * 2. POST /api/v2/projects/{id}/update/ → trigger SCM update
 *
 * Returns the project_update_id, status, and project metadata.
 * The sync is async on AAP — the agent can poll the project update
 * status using the returned project_update_id.
 *
 * @param getAwxClient - Lazy resolver for the AWX HTTP client
 */
export function createSyncProjectTool(
  getAwxClient: () => Promise<AwxClient>,
) {
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
