/**
 * map-user.ts — AWX User Detail Mapper
 *
 * Pure function that transforms a raw AWX API user response
 * (from GET /api/v2/users/<id>/) into the structured
 * UserDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Organization name**: Extracts organization_name from AWX
 *   `summary_fields` rather than raw organization ID.
 * - **Password exclusion**: The password field is never returned
 *   by AWX; it's omitted from the mapped output entirely.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/users/42/");
 * const raw = await response.json();
 * const output = mapUser(raw);
 * ```
 */
import type { UserDetailOutput, UserData } from "../contracts/user-detail.js";

/**
 * Raw AWX API user response shape (the subset we care about).
 */
interface RawAwxUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_superuser: boolean;
  is_system_auditor: boolean;
  created: string;
  modified: string;
  summary_fields?: {
    organization?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API user response into the
 * UserDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/users/<id>/
 * @returns    A UserDetailOutput matching the v1.0 contract
 */
export function mapUser(raw: unknown): UserDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapUser: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const u = raw as RawAwxUser;
  const sf = u.summary_fields ?? {};

  const data: UserData = {
    id: u.id ?? 0,
    username: u.username ?? "",
    first_name: u.first_name ?? "",
    last_name: u.last_name ?? "",
    email: u.email ?? "",
    is_superuser: u.is_superuser ?? false,
    is_system_auditor: u.is_system_auditor ?? false,
    organization_name: sf.organization?.name ?? "",
    created: u.created ?? "",
    modified: u.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "user",
    id: u.id ?? 0,
    data,
  };
}
