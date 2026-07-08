/**
 * AWX Label Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for label
 * detail requests. Used by `mapLabel()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "label"
 * - **id**: The numeric resource ID
 * - **data**: Core label data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - Labels are organization-scoped
 */

// ─── Label Data ──────────────────────────────────────────────

export interface LabelData {
  id: number;
  name: string;
  description: string;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** ISO 8601 timestamp — date the label was created */
  created: string;
  /** ISO 8601 timestamp — date the label was last modified */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface LabelDetailOutput {
  schema_version: "1.0";
  resource_type: "label";
  id: number;
  data: LabelData;
}
