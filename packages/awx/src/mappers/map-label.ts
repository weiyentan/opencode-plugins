/**
 * map-label.ts — AWX Label Detail Mapper
 *
 * Pure function that transforms a raw AWX API label response
 * (from GET /api/v2/labels/<id>/) into the structured
 * LabelDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Organization name**: Extracts organization_name from AWX
 *   `summary_fields` rather than raw ID.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/labels/5/");
 * const raw = await response.json();
 * const output = mapLabel(raw);
 * ```
 */
import type { LabelDetailOutput, LabelData } from "../contracts/label-detail.js";

/**
 * Raw AWX API label response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxLabel {
  id: number;
  name: string;
  description: string;
  created: string;
  modified: string;
  summary_fields?: {
    organization?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API label response into the
 * LabelDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/labels/<id>/
 * @returns    A LabelDetailOutput matching the v1.0 contract
 */
export function mapLabel(raw: unknown): LabelDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapLabel: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const l = raw as RawAwxLabel;
  const sf = l.summary_fields ?? {};

  const data: LabelData = {
    id: l.id ?? 0,
    name: l.name ?? "",
    description: l.description ?? "",
    organization_name: sf.organization?.name ?? "",
    created: l.created ?? "",
    modified: l.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "label",
    id: l.id ?? 0,
    data,
  };
}
