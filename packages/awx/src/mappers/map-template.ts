/**
 * map-template.ts — AWX Template Detail Mapper
 *
 * Pure function that transforms a raw AWX API job template response
 * (from GET /api/v2/job_templates/<id>/) into the structured
 * TemplateDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Related names**: Extracts inventory_name, project_name, and
 *   organization_name from AWX `summary_fields` rather than raw IDs.
 * - **Labels**: Extracts label names from `summary_fields.labels.results`.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/job_templates/7/");
 * const raw = await response.json();
 * const output = mapTemplate(raw);
 * ```
 */
import type { TemplateDetailOutput, TemplateData } from "../contracts/template-detail.js";

/**
 * Raw AWX API job template response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxTemplate {
  id: number;
  name: string;
  description: string;
  job_type: string;
  playbook: string;
  verbosity: number;
  ask_variables_on_launch: boolean;
  ask_inventory_on_launch: boolean;
  ask_limit_on_launch: boolean;
  last_job_run: string | null;
  status: string;
  next_schedule: unknown;
  summary_fields?: {
    inventory?: { id?: number; name?: string } | null;
    project?: { id?: number; name?: string } | null;
    organization?: { id?: number; name?: string } | null;
    labels?: {
      results?: Array<{ id?: number; name?: string }>;
    } | null;
  };
}

/**
 * Transform a raw AWX API job template response into the
 * TemplateDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/job_templates/<id>/
 * @returns    A TemplateDetailOutput matching the v1.0 contract
 */
export function mapTemplate(raw: unknown): TemplateDetailOutput {
  const t = raw as RawAwxTemplate;
  const sf = t.summary_fields ?? {};

  const data: TemplateData = {
    id: t.id,
    name: t.name ?? "",
    description: t.description ?? "",
    job_type: t.job_type ?? "",
    inventory_name: sf.inventory?.name ?? "",
    project_name: sf.project?.name ?? "",
    organization_name: sf.organization?.name ?? "",
    playbook: t.playbook ?? "",
    verbosity: t.verbosity ?? 0,
    ask_variables_on_launch: t.ask_variables_on_launch ?? false,
    ask_inventory_on_launch: t.ask_inventory_on_launch ?? false,
    ask_limit_on_launch: t.ask_limit_on_launch ?? false,
    last_job_run: t.last_job_run ?? null,
    status: t.status ?? "",
    next_schedule: typeof t.next_schedule === "string"
      ? t.next_schedule
      : (t.next_schedule && typeof t.next_schedule === "object"
        ? (t.next_schedule as { name?: string }).name ?? null
        : null),
    labels: sf.labels?.results?.map((l) => l.name ?? "").filter(Boolean) ?? [],
  };

  return {
    schema_version: "1.0",
    resource_type: "template",
    id: t.id,
    data,
  };
}
