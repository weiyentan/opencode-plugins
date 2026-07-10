/**
 * AWX Schedule Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for schedule
 * detail requests. Used by `mapSchedule()` to shape raw AWX API
 * responses into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "schedule"
 * - **id**: The numeric resource ID
 * - **data**: Core schedule data with resolved related names
 *
 * ## Field Notes
 *
 * - `rrule` is an RFC 5545 recurrence rule string. Pass through as-is;
 *   no client-side validation or parsing.
 * - `unified_job_template_name` is resolved from
 *   `summary_fields.unified_job_template.name`.
 * - `next_run` is an ISO 8601 timestamp; may be `null` if never run.
 */

// ─── Schedule Data ───────────────────────────────────────────

export interface ScheduleData {
  id: number;
  name: string;
  description: string;
  /** RFC 5545 recurrence rule string */
  rrule: string;
  /** Resolved from summary_fields.unified_job_template.name */
  unified_job_template_name: string;
  /** Resolved from summary_fields.organization.name (may be empty) */
  organization_name: string;
  /** Next scheduled run (ISO 8601), or null if never run */
  next_run: string | null;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface ScheduleDetailOutput {
  schema_version: "1.0";
  resource_type: "schedule";
  id: number;
  data: ScheduleData;
}
