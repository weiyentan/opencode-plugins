/**
 * map-organization.ts — AWX Organization Detail Mapper
 *
 * Pure function that transforms a raw AWX API organization response
 * (from GET /api/v2/organizations/<id>/) into the structured
 * OrganizationDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Related counts**: Extracts resource counts (users, teams,
 *   job_templates, projects, inventories) from `summary_fields.related`.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/organizations/1/");
 * const raw = await response.json();
 * const output = mapOrganization(raw);
 * ```
 */
import type { OrganizationDetailOutput, OrganizationData } from "../contracts/organization-detail.js";

/**
 * Raw AWX API organization response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxOrganization {
  id: number;
  name: string;
  description: string;
  created: string;
  modified: string;
  summary_fields?: {
    related?: Record<string, { count?: number } | null>;
  };
}

/** Default related counts when fields are missing */
const DEFAULT_RELATED = {
  users: 0,
  teams: 0,
  job_templates: 0,
  projects: 0,
  inventories: 0,
};

/** Fields to extract from the related section */
const RELATED_FIELDS = ["users", "teams", "job_templates", "projects", "inventories"] as const;

/**
 * Extract a numeric count from a related resource entry.
 * The AWX API returns `{ count: N, results: [...] }` for each related type.
 */
function extractCount(
  related: Record<string, { count?: number } | null> | undefined,
  field: string,
): number {
  if (!related) return 0;
  const entry = related[field];
  if (!entry || typeof entry !== "object") return 0;
  return typeof entry.count === "number" ? entry.count : 0;
}

/**
 * Transform a raw AWX API organization response into the
 * OrganizationDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/organizations/<id>/
 * @returns    An OrganizationDetailOutput matching the v1.0 contract
 */
export function mapOrganization(raw: unknown): OrganizationDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapOrganization: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const o = raw as RawAwxOrganization;
  const related = o.summary_fields?.related;

  const data: OrganizationData = {
    id: o.id ?? 0,
    name: o.name ?? "",
    description: o.description ?? "",
    related: {
      users: extractCount(related, "users"),
      teams: extractCount(related, "teams"),
      job_templates: extractCount(related, "job_templates"),
      projects: extractCount(related, "projects"),
      inventories: extractCount(related, "inventories"),
    },
    created: o.created ?? "",
    modified: o.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "organization",
    id: o.id ?? 0,
    data,
  };
}
