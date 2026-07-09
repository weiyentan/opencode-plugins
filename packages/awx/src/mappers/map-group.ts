/**
 * map-group.ts — AWX Group Detail Mapper
 *
 * Pure function that transforms a raw AWX API group response
 * (from GET /api/v2/groups/<id>/) into the structured
 * GroupDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Inventory name**: Extracts inventory_name from AWX
 *   `summary_fields` rather than raw ID.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/groups/5/");
 * const raw = await response.json();
 * const output = mapGroup(raw);
 * ```
 */
import type { GroupDetailOutput, GroupData } from "../contracts/group-detail.js";

/**
 * Raw AWX API group response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxGroup {
  id: number;
  name: string;
  description: string;
  variables: string;
  created: string;
  modified: string;
  summary_fields?: {
    inventory?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API group response into the
 * GroupDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/groups/<id>/
 * @returns    A GroupDetailOutput matching the v1.0 contract
 */
export function mapGroup(raw: unknown): GroupDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapGroup: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const g = raw as RawAwxGroup;
  const sf = g.summary_fields ?? {};

  const data: GroupData = {
    id: g.id ?? 0,
    name: g.name ?? "",
    description: g.description ?? "",
    inventory_name: sf.inventory?.name ?? "",
    variables: g.variables ?? "",
    created: g.created ?? "",
    modified: g.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "group",
    id: g.id ?? 0,
    data,
  };
}
