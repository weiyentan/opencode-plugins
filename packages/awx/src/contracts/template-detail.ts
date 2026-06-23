/**
 * AWX Template Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for job template
 * detail requests. Used by `mapTemplate()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "template"
 * - **id**: The numeric resource ID
 * - **data**: Core template data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `ask_*` fields are boolean launch-time prompts
 * - `last_job_run` and `next_schedule` may be null
 */

// ─── Template Data ───────────────────────────────────────────

export interface TemplateData {
  id: number;
  name: string;
  description: string;
  job_type: string;
  /** Resolved from summary_fields.inventory.name */
  inventory_name: string;
  /** Resolved from summary_fields.project.name */
  project_name: string;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  playbook: string;
  verbosity: number;
  /** Whether the template prompts for variables on launch */
  ask_variables_on_launch: boolean;
  /** Whether the template prompts for inventory on launch */
  ask_inventory_on_launch: boolean;
  /** Whether the template prompts for a host limit on launch */
  ask_limit_on_launch: boolean;
  /** ISO 8601 timestamp of the most recent job launch, or null */
  last_job_run: string | null;
  /** Current template status (e.g. "successful", "never updated") */
  status: string;
  /** Name of the next scheduled run, or null */
  next_schedule: string | null;
  /** Resolved label names from summary_fields.labels.results */
  labels: string[];
}

// ─── Top-level output envelope ───────────────────────────────

export interface TemplateDetailOutput {
  schema_version: "1.0";
  resource_type: "template";
  id: number;
  data: TemplateData;
}
