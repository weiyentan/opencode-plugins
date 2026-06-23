/**
 * map-inventory.ts — AWX Inventory Detail Mapper
 *
 * Pure function that transforms a raw AWX API inventory response
 * (from GET /api/v2/inventories/<id>/) into the structured
 * InventoryDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Organization name**: Extracts organization_name from AWX
 *   `summary_fields` rather than raw ID.
 * - **Kind**: Preserves the inventory kind ("smart", "", etc.)
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/inventories/12/");
 * const raw = await response.json();
 * const output = mapInventory(raw);
 * ```
 */
import type { InventoryDetailOutput, InventoryData } from "../contracts/inventory-detail.js";

/**
 * Raw AWX API inventory response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxInventory {
  id: number;
  name: string;
  description: string;
  kind: string;
  host_count: number;
  total_groups: number;
  has_inventory_sources: boolean;
  total_inventory_sources: number;
  variables: string;
  summary_fields?: {
    organization?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API inventory response into the
 * InventoryDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/inventories/<id>/
 * @returns    An InventoryDetailOutput matching the v1.0 contract
 */
export function mapInventory(raw: unknown): InventoryDetailOutput {
  const inv = raw as RawAwxInventory;
  const sf = inv.summary_fields ?? {};

  const data: InventoryData = {
    id: inv.id,
    name: inv.name ?? "",
    description: inv.description ?? "",
    kind: inv.kind ?? "",
    host_count: inv.host_count ?? 0,
    total_groups: inv.total_groups ?? 0,
    has_inventory_sources: inv.has_inventory_sources ?? false,
    total_inventory_sources: inv.total_inventory_sources ?? 0,
    organization_name: sf.organization?.name ?? "",
    variables: inv.variables ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "inventory",
    id: inv.id,
    data,
  };
}
