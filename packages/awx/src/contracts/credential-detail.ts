/**
 * AWX Credential Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for credential
 * detail requests. Used by `mapCredential()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "credential"
 * - **id**: The numeric resource ID
 * - **data**: Core credential data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `credential_type_name` is resolved from `summary_fields.credential_type.name`
 * - `organization_name` is resolved from `summary_fields.organization.name`
 * - Sensitive `inputs` values are NEVER exposed in the mapper output
 */

// ─── Credential Data ──────────────────────────────────────────

export interface CredentialData {
  id: number;
  name: string;
  description: string;
  /** Raw credential_type ID from the AWX API */
  credential_type_id: number;
  /** Resolved from summary_fields.credential_type.name */
  credential_type_name: string;
  /** Credential kind (e.g. "ssh", "vault", "") */
  kind: string;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** Whether this credential is managed by AWX */
  managed: boolean;
  /** Raw summary_fields from the AWX API (non-sensitive subset) */
  summary_fields: Record<string, unknown>;
}

// ─── Top-level output envelope ────────────────────────────────

export interface CredentialDetailOutput {
  schema_version: "1.0";
  resource_type: "credential";
  id: number;
  data: CredentialData;
}
