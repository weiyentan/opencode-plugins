/**
 * AWX User Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for user
 * detail requests. Used by `mapUser()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "user"
 * - **id**: The numeric resource ID
 * - **data**: Core user data with resolved related names
 *
 * ## Field Notes
 *
 * - `password` is a **create-only** field — AWX never returns it.
 *   It is excluded from this contract and the mapper.
 * - `organization_name` is resolved from `summary_fields.organization.name`.
 */

// ─── User Data ───────────────────────────────────────────────

export interface UserData {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_superuser: boolean;
  is_system_auditor: boolean;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface UserDetailOutput {
  schema_version: "1.0";
  resource_type: "user";
  id: number;
  data: UserData;
}
