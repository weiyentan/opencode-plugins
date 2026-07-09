/**
 * utils.ts — Shared helper functions for the AWX plugin.
 *
 * Extracted from index.ts to keep the server() function focused
 * on orchestration: imports, factory wiring, and the hook shape.
 */
import type { ResourceDetailOutput } from "./get-resource.js";
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

/**
 * Build a Markdown pipe-delimited table from an array of items.
 * Pipe characters (`|`) in cell values are escaped to `\|`.
 * The separator row uses `---` alignment (not left/right).
 */
export function buildPipeTable<T>(
  items: T[],
  columns: Array<{ header: string; value: (item: T) => string }>,
): string {
  if (items.length === 0) {
    const headerRow = "| " + columns.map((c) => c.header).join(" | ") + " |";
    const sepRow = "| " + columns.map(() => "---").join(" | ") + " |";
    return [headerRow, sepRow].join("\n");
  }
  const headerRow = "| " + columns.map((c) => c.header).join(" | ") + " |";
  const sepRow = "| " + columns.map(() => "---").join(" | ") + " |";
  const dataRows = items.map(
    (item) =>
      "| " +
      columns.map((c) => String(c.value(item)).replace(/\|/g, "\\|")).join(" | ") +
      " |",
  );
  return [headerRow, sepRow, ...dataRows].join("\n");
}

/**
 * Format a structured resource detail into a human-readable multi-line string.
 * Dispatches on resource type to show the most relevant fields for each kind.
 */
export function formatResourceOutput(result: ResourceDetailOutput): string {
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
      const creds = Array.isArray(d.credentials)
        ? (d.credentials as Array<{ name: string }>)
        : [];
      const credSummary =
        creds.length > 0
          ? `${creds.length} credential(s): ${creds.map((c) => c.name).join(", ")}`
          : "(none)";
      return [
        `Template ${d.id}: ${d.name}`,
        `  Description:         ${d.description ?? ""}`,
        `  Job Type:            ${d.job_type}`,
        `  Playbook:            ${d.playbook}`,
        `  Status:              ${d.status}`,
        `  Inventory:           ${d.inventory_name}`,
        `  Project:             ${d.project_name}`,
        `  Credentials:         ${credSummary}`,
        `  Extra Vars:          ${(d.extra_vars as string) ? ((d.extra_vars as string).length > 60 ? (d.extra_vars as string).slice(0, 60) + "…" : d.extra_vars) : "(none)"}`,
        `  Timeout:             ${d.timeout != null ? d.timeout : "(default)"}`,
        `  Job Tags:            ${d.job_tags || "(none)"}`,
        `  Skip Tags:           ${d.skip_tags || "(none)"}`,
        `  Ask Tags On Launch:  ${d.ask_tags_on_launch != null ? String(d.ask_tags_on_launch) : "false"}`,
        `  Ask Skip On Launch:  ${d.ask_skip_tags_on_launch != null ? String(d.ask_skip_tags_on_launch) : "false"}`,
        `  Last Run:            ${d.last_job_run ?? "(never)"}`,
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
    case "credential": {
      const d = result.data;
      return [
        `Credential ${d.id}: ${d.name}`,
        `  Description:          ${d.description ?? ""}`,
        `  Credential Type:      ${d.credential_type_name} (ID: ${d.credential_type_id})`,
        `  Kind:                 ${d.kind || "(none)"}`,
        `  Organization:         ${d.organization_name || "(none)"}`,
        `  Managed:              ${String(d.managed)}`,
      ].join("\n");
    }
    case "organization": {
      const d = result.data;
      const rel = d.related;
      return [
        `Organization ${d.id}: ${d.name}`,
        `  Description:          ${d.description ?? ""}`,
        `  Users:                ${rel.users ?? 0}`,
        `  Teams:                ${rel.teams ?? 0}`,
        `  Job Templates:        ${rel.job_templates ?? 0}`,
        `  Projects:             ${rel.projects ?? 0}`,
        `  Inventories:          ${rel.inventories ?? 0}`,
        `  Created:              ${d.created ?? ""}`,
        `  Modified:             ${d.modified ?? ""}`,
      ].join("\n");
    }
    case "host": {
      const d = result.data;
      return [
        `Host ${d.id}: ${d.name}`,
        `  Description:     ${d.description ?? ""}`,
        `  Inventory:       ${d.inventory_name ?? ""}`,
        `  Variables:       ${(d.variables as string) ? ((d.variables as string).length > 60 ? (d.variables as string).slice(0, 60) + "…" : d.variables) : "(none)"}`,
        `  Created:         ${d.created ?? ""}`,
        `  Modified:        ${d.modified ?? ""}`,
      ].join("\n");
    }
    case "group": {
      const d = result.data;
      return [
        `Group ${d.id}: ${d.name}`,
        `  Description:     ${d.description ?? ""}`,
        `  Inventory:       ${d.inventory_name ?? ""}`,
        `  Variables:       ${(d.variables as string) ? ((d.variables as string).length > 60 ? (d.variables as string).slice(0, 60) + "…" : d.variables) : "(none)"}`,
        `  Created:         ${d.created ?? ""}`,
        `  Modified:        ${d.modified ?? ""}`,
      ].join("\n");
    }
    case "label": {
      const d = result.data;
      return [
        `Label ${d.id}: ${d.name}`,
        `  Description:     ${d.description ?? ""}`,
        `  Organization:    ${d.organization_name ?? ""}`,
        `  Created:         ${d.created ?? ""}`,
        `  Modified:        ${d.modified ?? ""}`,
      ].join("\n");
    }
    case "instance-group": {
      const d = result.data;
      return [
        `Instance Group ${d.id}: ${d.name}`,
        `  Description:     ${d.description ?? ""}`,
        `  Created:         ${d.created ?? ""}`,
        `  Modified:        ${d.modified ?? ""}`,
      ].join("\n");
    }
    case "execution-environment": {
      const d = result.data;
      return [
        `Execution Environment ${d.id}: ${d.name}`,
        `  Description:     ${d.description ?? ""}`,
        `  Image:           ${d.image ?? ""}`,
        `  Organization:    ${d.organization_name ?? ""}`,
        `  Created:         ${d.created ?? ""}`,
        `  Modified:        ${d.modified ?? ""}`,
      ].join("\n");
    }
  }
}
