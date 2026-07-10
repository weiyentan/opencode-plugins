/**
 * AWX Instance Group Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for instance
 * group detail requests. Used by `mapInstanceGroup()` to shape raw
 * AWX API responses into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "instance-group"
 * - **id**: The numeric resource ID
 * - **data**: Core instance group data
 *
 * ## Field Naming Convention
 *
 * - `created` and `modified` are ISO 8601 timestamps
 */

// ─── Instance Group Data ────────────────────────────────────

export interface InstanceGroupData {
  id: number;
  name: string;
  description: string;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface InstanceGroupDetailOutput {
  schema_version: "1.0";
  resource_type: "instance-group";
  id: number;
  data: InstanceGroupData;
}
