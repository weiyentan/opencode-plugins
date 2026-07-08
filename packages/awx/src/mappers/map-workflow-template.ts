/**
 * map-workflow-template.ts — AWX Workflow Template Detail Mapper
 *
 * Pure function that transforms a raw AWX API workflow job template
 * response (from GET /api/v2/workflow_job_templates/<id>/) into the
 * structured WorkflowTemplateDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Related names**: Extracts organization_name and inventory_name
 *   from AWX `summary_fields` rather than raw IDs.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Key differences from map-template.ts
 *
 * - No project, playbook, or job_type fields
 * - Includes workflow-specific fields: survey_enabled, allow_simultaneous,
 *   ask_credential_on_launch, webhook_credential, webhook_service, webhook_url
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/workflow_job_templates/7/");
 * const raw = await response.json();
 * const output = mapWorkflowTemplate(raw);
 * ```
 */
import type { WorkflowTemplateDetailOutput, WorkflowTemplateData } from "../contracts/workflow-template-detail.js";

/**
 * Raw AWX API workflow job template response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxWorkflowTemplate {
  id: number;
  name: string;
  description: string;
  organization?: number;
  inventory?: number | null;
  limit?: string | null;
  verbosity?: number;
  extra_vars?: string;
  job_tags?: string;
  skip_tags?: string;
  timeout?: number;
  ask_variables_on_launch?: boolean;
  ask_inventory_on_launch?: boolean;
  ask_limit_on_launch?: boolean;
  ask_tags_on_launch?: boolean;
  ask_skip_tags_on_launch?: boolean;
  ask_credential_on_launch?: boolean;
  survey_enabled?: boolean;
  allow_simultaneous?: boolean;
  last_job_run: string | null;
  status: string;
  webhook_credential?: number | null;
  webhook_service?: string;
  webhook_url?: string;
  created: string;
  modified: string;
  summary_fields?: {
    organization?: { id?: number; name?: string } | null;
    inventory?: { id?: number; name?: string } | null;
    labels?: {
      results?: Array<{ id?: number; name?: string }>;
    } | null;
    credentials?:
      | Array<{ id?: number; name?: string; credential_type_id?: number; kind?: string }>
      | { results?: Array<{ id?: number; name?: string; credential_type_id?: number; kind?: string }> }
      | null;
  };
}

/**
 * Transform a raw AWX API workflow job template response into the
 * WorkflowTemplateDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/workflow_job_templates/<id>/
 * @returns    A WorkflowTemplateDetailOutput matching the v1.0 contract
 */
export function mapWorkflowTemplate(raw: unknown): WorkflowTemplateDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(
      `mapWorkflowTemplate: raw response is missing or has no id — ${JSON.stringify(raw)}`,
    );
  }
  const t = raw as RawAwxWorkflowTemplate;
  const sf = t.summary_fields ?? {};

  const data: WorkflowTemplateData = {
    id: t.id ?? 0,
    name: t.name ?? "",
    description: t.description ?? "",
    organization_name: sf.organization?.name ?? "",
    inventory_name: sf.inventory?.name ?? null,
    limit: t.limit ?? null,
    verbosity: t.verbosity ?? 0,
    extra_vars: t.extra_vars ?? "",
    job_tags: t.job_tags ?? "",
    skip_tags: t.skip_tags ?? "",
    timeout: t.timeout ?? 0,
    ask_variables_on_launch: t.ask_variables_on_launch ?? false,
    ask_inventory_on_launch: t.ask_inventory_on_launch ?? false,
    ask_limit_on_launch: t.ask_limit_on_launch ?? false,
    ask_tags_on_launch: t.ask_tags_on_launch ?? false,
    ask_skip_tags_on_launch: t.ask_skip_tags_on_launch ?? false,
    ask_credential_on_launch: t.ask_credential_on_launch ?? false,
    survey_enabled: t.survey_enabled ?? false,
    allow_simultaneous: t.allow_simultaneous ?? false,
    last_job_run: t.last_job_run ?? null,
    status: t.status ?? "",
    webhook_credential: t.webhook_credential ?? null,
    webhook_service: t.webhook_service ?? "",
    webhook_url: t.webhook_url ?? "",
    created: t.created ?? "",
    modified: t.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "workflow_template",
    id: t.id ?? 0,
    data,
  };
}
