/**
 * AWX Team Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for team
 * detail requests. Used by `mapTeam()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "team"
 * - **id**: The numeric resource ID
 * - **data**: Core team data with resolved organization name
 *
 * ## Field Notes
 *
 * - `organization_name` is resolved from `summary_fields.organization.name`.
 */

// ─── Team Data ───────────────────────────────────────────────

export interface TeamData {
  id: number;
  name: string;
  description: string;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface TeamDetailOutput {
  schema_version: "1.0";
  resource_type: "team";
  id: number;
  data: TeamData;
}
