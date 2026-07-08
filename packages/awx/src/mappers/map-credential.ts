/**
 * map-credential.ts — AWX Credential Detail Mapper
 *
 * Pure function that transforms a raw AWX API credential response
 * (from GET /api/v2/credentials/<id>/) into the structured
 * CredentialDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Related names**: Extracts credential_type_name from
 *   `summary_fields.credential_type.name` and organization_name from
 *   `summary_fields.organization.name`.
 * - **Sensitive data**: The `inputs` field is STRICTLY excluded from
 *   the mapper output to prevent leaking secrets.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/credentials/15/");
 * const raw = await response.json();
 * const output = mapCredential(raw);
 * ```
 */
import type { CredentialDetailOutput, CredentialData } from "../contracts/credential-detail.js";

/**
 * Raw AWX API credential response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxCredential {
  id: number;
  name: string;
  description: string;
  credential_type: number;
  kind: string;
  managed: boolean;
  organization?: number | null;
  summary_fields?: {
    credential_type?: { id?: number; name?: string } | null;
    organization?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API credential response into the
 * CredentialDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/credentials/<id>/
 * @returns    A CredentialDetailOutput matching the v1.0 contract
 */
export function mapCredential(raw: unknown): CredentialDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapCredential: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const c = raw as RawAwxCredential & Record<string, unknown>;
  const sf = c.summary_fields ?? {};

  const data: CredentialData = {
    id: c.id ?? 0,
    name: c.name ?? "",
    description: c.description ?? "",
    credential_type_id: c.credential_type ?? 0,
    credential_type_name: sf.credential_type?.name ?? "",
    kind: c.kind ?? "",
    organization_name: sf.organization?.name ?? "",
    managed: c.managed ?? false,
    summary_fields: sf as Record<string, unknown>,
  };

  return {
    schema_version: "1.0",
    resource_type: "credential",
    id: c.id ?? 0,
    data,
  };
}
