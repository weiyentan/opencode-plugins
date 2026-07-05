/**
 * map-project.ts — AWX Project Detail Mapper
 *
 * Pure function that transforms a raw AWX API project response
 * (from GET /api/v2/projects/<id>/) into the structured
 * ProjectDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Related names**: Extracts organization_name and created_by from
 *   AWX `summary_fields` rather than raw IDs.
 * - **Derived flags**: Computes is_successful and is_failed from the
 *   raw `status` field.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/projects/5/");
 * const raw = await response.json();
 * const output = mapProject(raw);
 * ```
 */
import type { ProjectDetailOutput, ProjectData } from "../contracts/project-detail.js";

/**
 * Raw AWX API project response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxProject {
  id: number;
  name: string;
  description: string;
  scm_type: string;
  scm_url: string;
  scm_branch: string;
  scm_revision?: string;
  credential?: number | null;
  default_environment?: number | null;
  status: string;
  last_updated: string | null;
  created: string;
  modified: string;
  summary_fields?: {
    organization?: { id?: number; name?: string } | null;
    created_by?: { id?: number; username?: string } | null;
    credential?: { id?: number; name?: string } | null;
    default_environment?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API project response into the
 * ProjectDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/projects/<id>/
 * @returns    A ProjectDetailOutput matching the v1.0 contract
 */
export function mapProject(raw: unknown): ProjectDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapProject: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const p = raw as RawAwxProject;
  const sf = p.summary_fields ?? {};

  const status = p.status ?? "";

  const data: ProjectData = {
    id: p.id ?? 0,
    name: p.name ?? "",
    description: p.description ?? "",
    scm_type: p.scm_type ?? "",
    scm_url: p.scm_url ?? "",
    scm_branch: p.scm_branch ?? "",
    scm_revision: p.scm_revision ?? "",
    credential_id: p.credential ?? null,
    credential_name: sf.credential?.name ?? "",
    default_environment_id: p.default_environment ?? null,
    default_environment_name: sf.default_environment?.name ?? "",
    status,
    last_updated: p.last_updated ?? null,
    created: p.created ?? "",
    modified: p.modified ?? "",
    organization_name: sf.organization?.name ?? "",
    created_by: sf.created_by?.username ?? "",
    is_successful: status === "successful",
    is_failed: status === "failed",
    warnings: [],
    errors: [],
  };

  return {
    schema_version: "1.0",
    resource_type: "project",
    id: p.id ?? 0,
    data,
  };
}
