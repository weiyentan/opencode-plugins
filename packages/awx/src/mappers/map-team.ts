/**
 * map-team.ts — AWX Team Detail Mapper
 *
 * Pure function that transforms a raw AWX API team response
 * (from GET /api/v2/teams/<id>/) into the structured
 * TeamDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Organization name**: Extracts organization_name from AWX
 *   `summary_fields` rather than raw organization ID.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/teams/15/");
 * const raw = await response.json();
 * const output = mapTeam(raw);
 * ```
 */
import type { TeamDetailOutput, TeamData } from "../contracts/team-detail.js";

/**
 * Raw AWX API team response shape (the subset we care about).
 */
interface RawAwxTeam {
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
 * Transform a raw AWX API team response into the
 * TeamDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/teams/<id>/
 * @returns    A TeamDetailOutput matching the v1.0 contract
 */
export function mapTeam(raw: unknown): TeamDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapTeam: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const t = raw as RawAwxTeam;
  const sf = t.summary_fields ?? {};

  const data: TeamData = {
    id: t.id ?? 0,
    name: t.name ?? "",
    description: t.description ?? "",
    organization_name: sf.organization?.name ?? "",
    created: t.created ?? "",
    modified: t.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "team",
    id: t.id ?? 0,
    data,
  };
}
