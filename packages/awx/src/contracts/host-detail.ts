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
 * - `variables` is a raw JSON/YAML string, or empty if not set
 */

// ─── Host Data ───────────────────────────────────────────────

export interface HostData {
  id: number;
  name: string;
  description: string;
  /** Whether the host is enabled (online) */
  enabled: boolean;
  /** Resolved from summary_fields.inventory.name */
  inventory_name: string;
  /** Raw variables string (JSON or YAML), empty string if not set */
  variables: string;
  /** ISO 8601 timestamp — date the host was created */
  created: string;
  /** ISO 8601 timestamp — date the host was last modified */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface HostDetailOutput {
  schema_version: "1.0";
  resource_type: "host";
  id: number;
  data: HostData;
}
