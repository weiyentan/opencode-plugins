/**
 * AWX Inventory Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for inventory
 * detail requests. Used by `mapInventory()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "inventory"
 * - **id**: The numeric resource ID
 * - **data**: Core inventory data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `kind` is the inventory type (e.g. "smart" for smart inventories, "" for normal)
 * - `variables` is a raw JSON/YAML string, or empty if not set
 */

// ─── Inventory Data ───────────────────────────────────────────

export interface InventoryData {
  id: number;
  name: string;
  description: string;
  /** Inventory kind: "smart" for smart inventories, "" for normal */
  kind: string;
  /** Number of hosts in this inventory */
  host_count: number;
  /** Total groups in this inventory */
  total_groups: number;
  /** Whether this inventory has any inventory sources */
  has_inventory_sources: boolean;
  /** Total inventory sources (e.g., project SCM sources) */
  total_inventory_sources: number;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** Raw variables string (JSON or YAML), empty string if not set */
  variables: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface InventoryDetailOutput {
  schema_version: "1.0";
  resource_type: "inventory";
  id: number;
  data: InventoryData;
}
