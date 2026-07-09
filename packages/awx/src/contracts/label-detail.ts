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
 * - `organization_id` is the raw organization ID from the AWX API
 * - `organization_name` is resolved from `summary_fields.organization.name`
 */

// ─── Label Data ────────────────────────────────────────────

export interface LabelData {
  id: number;
  name: string;
  description: string;
  /** Raw organization ID from the AWX API */
  organization_id: number | null;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** ISO 8601 timestamp */
  created: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface LabelDetailOutput {
  schema_version: "1.0";
  resource_type: "label";
  id: number;
  data: LabelData;
}
