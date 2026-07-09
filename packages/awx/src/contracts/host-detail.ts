/**
 * AWX Host Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for host
 * detail requests. Used by `mapHost()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "host"
 * - **id**: The numeric resource ID
 * - **data**: Core host data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `inventory_id` is the raw inventory ID from the AWX API
 * - `inventory_name` is resolved from `summary_fields.inventory.name`
 * - `created` and `modified` are ISO 8601 timestamps
 */

// ─── Host Data ────────────────────────────────────────────

export interface HostData {
  id: number;
  name: string;
  description: string;
  /** Raw inventory ID from the AWX API */
  inventory_id: number | null;
  /** Resolved from summary_fields.inventory.name */
  inventory_name: string;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface HostDetailOutput {
  schema_version: "1.0";
  resource_type: "host";
  id: number;
  data: HostData;
}
