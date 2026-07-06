import type { ResourceMutationOutput } from "./contracts/resource-mutation.js";

/**
 * Format a user-facing error message for HTTP error responses.
 *
 * Maps HTTP status codes to meaningful error messages the agent
 * can act on (e.g., "not found", "not authorized").
 */
export function formatErrorResponse(projectId: number, status: number): string {
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
 * Wrap a CrudResult into the standard ResourceMutationOutput envelope.
 *
 * The CrudResult.data contains the full mapper output (e.g., TemplateDetailOutput
 * which has schema_version, resource_type, id, data). For the mutation output,
 * we extract just the inner data payload (e.g., TemplateData) so consumers
 * can access fields like name, job_type, etc. directly via `data.name`.
 */
export function wrapMutationResult(result: {
  action: "created" | "updated" | "deleted";
  resource_type: string;
  id: number;
  data: unknown | null;
}): ResourceMutationOutput {
  // The mapper output nests the payload inside a `data` field.
  // Extract it so consumers can access `result.data.name` directly.
  const innerData =
    result.data &&
    typeof result.data === "object" &&
    "data" in (result.data as Record<string, unknown>)
      ? (result.data as Record<string, unknown>).data
      : result.data;

  return {
    schema_version: "1.0",
    action: result.action,
    resource_type: result.resource_type as ResourceMutationOutput["resource_type"],
    id: result.id,
    data: innerData,
    warnings: [],
    errors: [],
  };
}
