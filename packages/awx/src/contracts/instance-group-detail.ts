/**
 * AWX Instance Group Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for instance group
 * detail requests. Used by `mapInstanceGroup()` to shape raw AWX API
 * responses into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "instance_group"
 * - **id**: The numeric resource ID
 * - **data**: Core instance group data
 *
 * ## Field Naming Convention
 *
 * - Capacity values reflect the current capacity state of the instance group
 */

// ─── Instance Group Data ─────────────────────────────────────

export interface InstanceGroupData {
  id: number;
  name: string;
  description: string;
  /** Total capacity of the instance group */
  capacity: number;
  /** Currently consumed capacity */
  consumed_capacity: number;
  /** Remaining available capacity */
  remaining_capacity: number;
  /** ISO 8601 timestamp — date the instance group was created */
  created: string;
  /** ISO 8601 timestamp — date the instance group was last modified */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface InstanceGroupDetailOutput {
  schema_version: "1.0";
  resource_type: "instance_group";
  id: number;
  data: InstanceGroupData;
}
