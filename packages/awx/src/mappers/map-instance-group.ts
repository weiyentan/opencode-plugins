/**
 * map-instance-group.ts — AWX Instance Group Detail Mapper
 *
 * Pure function that transforms a raw AWX API instance group response
 * (from GET /api/v2/instance_groups/<id>/) into the structured
 * InstanceGroupDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/instance_groups/1/");
 * const raw = await response.json();
 * const output = mapInstanceGroup(raw);
 * ```
 */
import type { InstanceGroupDetailOutput, InstanceGroupData } from "../contracts/instance-group-detail.js";

/**
 * Raw AWX API instance group response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxInstanceGroup {
  id: number;
  name: string;
  description: string;
  created: string;
  modified: string;
}

/**
 * Transform a raw AWX API instance group response into the
 * InstanceGroupDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/instance_groups/<id>/
 * @returns    An InstanceGroupDetailOutput matching the v1.0 contract
 */
export function mapInstanceGroup(raw: unknown): InstanceGroupDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapInstanceGroup: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const ig = raw as RawAwxInstanceGroup;

  const data: InstanceGroupData = {
    id: ig.id,
    name: ig.name ?? "",
    description: ig.description ?? "",
    created: ig.created ?? "",
    modified: ig.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "instance-group",
    id: ig.id,
    data,
  };
}
