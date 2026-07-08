/**
 * AWX Workflow Template Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for workflow job
 * template detail requests. Used by `mapWorkflowTemplate()` to shape
 * raw AWX API responses into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "workflow_template"
 * - **id**: The numeric resource ID
 * - **data**: Core workflow template data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `ask_*` fields are boolean launch-time prompts
 * - `last_job_run` may be null
 * - `webhook_credential`, `webhook_service`, `webhook_url` are webhook configuration fields
 *
 * ## Key differences from regular job templates
 *
 * - No `project`, `playbook`, or `job_type` fields
 * - Has workflow-specific fields: `survey_enabled`, `allow_simultaneous`,
 *   `ask_credential_on_launch`, `webhook_credential`, `webhook_service`, `webhook_url`
 */

// ─── Workflow Template Data ───────────────────────────────────

export interface WorkflowTemplateData {
  id: number;
  name: string;
  description: string;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** Resolved from summary_fields.inventory.name */
  inventory_name: string | null;
  /** Host limit pattern (e.g., "webservers") */
  limit: string | null;
  verbosity: number;
  /** Raw extra_vars string from the AWX API */
  extra_vars: string;
  /** Comma-separated list of job tags to run */
  job_tags: string;
  /** Comma-separated list of job tags to skip */
  skip_tags: string;
  /** Job timeout in seconds */
  timeout: number;
  /** Whether the template prompts for variables on launch */
  ask_variables_on_launch: boolean;
  /** Whether the template prompts for inventory on launch */
  ask_inventory_on_launch: boolean;
  /** Whether the template prompts for a host limit on launch */
  ask_limit_on_launch: boolean;
  /** Whether the template prompts for job tags on launch */
  ask_tags_on_launch: boolean;
  /** Whether the template prompts for skip tags on launch */
  ask_skip_tags_on_launch: boolean;
  /** Whether the template prompts for credential on launch */
  ask_credential_on_launch: boolean;
  /** Whether the survey is enabled */
  survey_enabled: boolean;
  /** Whether simultaneous runs are allowed */
  allow_simultaneous: boolean;
  /** ISO 8601 timestamp of the most recent job launch, or null */
  last_job_run: string | null;
  /** Current workflow template status (e.g. "successful", "never updated") */
  status: string;
  /** Webhook credential ID, or null */
  webhook_credential: number | null;
  /** Webhook service (e.g. "github", "gitlab"), or empty string */
  webhook_service: string;
  /** Webhook URL, or empty string */
  webhook_url: string;
  /** ISO 8601 creation timestamp */
  created: string;
  /** ISO 8601 last modification timestamp */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface WorkflowTemplateDetailOutput {
  schema_version: "1.0";
  resource_type: "workflow_template";
  id: number;
  data: WorkflowTemplateData;
}
