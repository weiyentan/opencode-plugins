/**
 * map-host.ts — AWX Host Detail Mapper
 *
 * Pure function that transforms a raw AWX API host response
 * (from GET /api/v2/hosts/<id>/) into the structured
 * HostDetailOutput contract format.
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
 * const response = await fetch(client, "GET", "/api/v2/hosts/5/");
 * const raw = await response.json();
 * const output = mapHost(raw);
 * ```
 */
import type { HostDetailOutput, HostData } from "../contracts/host-detail.js";

/**
 * Raw AWX API host response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxHost {
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
 * Transform a raw AWX API host response into the
 * HostDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/hosts/<id>/
 * @returns    A HostDetailOutput matching the v1.0 contract
 */
export function mapHost(raw: unknown): HostDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapHost: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const h = raw as RawAwxHost;
  const sf = h.summary_fields ?? {};

  const data: HostData = {
    id: h.id,
    name: h.name ?? "",
    description: h.description ?? "",
    inventory_name: sf.inventory?.name ?? "",
    variables: h.variables ?? "",
    created: h.created ?? "",
    modified: h.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "host",
    id: h.id,
    data,
  };
}
