/**
 * map-schedule.ts — AWX Schedule Detail Mapper
 *
 * Pure function that transforms a raw AWX API schedule response
 * (from GET /api/v2/schedules/<id>/) into the structured
 * ScheduleDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Unified job template name**: Extracts from
 *   `summary_fields.unified_job_template.name`.
 * - **Organization name**: Extracts from
 *   `summary_fields.organization.name` (may be absent).
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/schedules/8/");
 * const raw = await response.json();
 * const output = mapSchedule(raw);
 * ```
 */
import type { ScheduleDetailOutput, ScheduleData } from "../contracts/schedule-detail.js";

/**
 * Raw AWX API schedule response shape (the subset we care about).
 */
interface RawAwxSchedule {
  id: number;
  name: string;
  description: string;
  rrule: string;
  next_run: string | null;
  created: string;
  modified: string;
  summary_fields?: {
    unified_job_template?: { id?: number; name?: string } | null;
    organization?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API schedule response into the
 * ScheduleDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/schedules/<id>/
 * @returns    A ScheduleDetailOutput matching the v1.0 contract
 */
export function mapSchedule(raw: unknown): ScheduleDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapSchedule: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const s = raw as RawAwxSchedule;
  const sf = s.summary_fields ?? {};

  const data: ScheduleData = {
    id: s.id ?? 0,
    name: s.name ?? "",
    description: s.description ?? "",
    rrule: s.rrule ?? "",
    unified_job_template_name: sf.unified_job_template?.name ?? "",
    organization_name: sf.organization?.name ?? "",
    next_run: s.next_run ?? null,
    created: s.created ?? "",
    modified: s.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "schedule",
    id: s.id ?? 0,
    data,
  };
}
