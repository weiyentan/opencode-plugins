/**
 * AWX Group Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for group
 * detail requests. Used by `mapGroup()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "group"
 * - **id**: The numeric resource ID
 * - **data**: Core group data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `variables` is a raw JSON/YAML string, or empty if not set
 * - `hosts` lists the host names that are members of this group
 * - `parent_group_names` lists the parent group names
 */

// ─── Group Data ──────────────────────────────────────────────

export interface GroupData {
  id: number;
  name: string;
  description: string;
  /** Resolved from summary_fields.inventory.name */
  inventory_name: string;
  /** Raw variables string (JSON or YAML), empty string if not set */
  variables: string;
  /** Resolved host names that belong to this group */
  hosts: string[];
  /** Resolved parent group names */
  parent_group_names: string[];
  /** ISO 8601 timestamp — date the group was created */
  created: string;
  /** ISO 8601 timestamp — date the group was last modified */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface GroupDetailOutput {
  schema_version: "1.0";
  resource_type: "group";
  id: number;
  data: GroupData;
}
