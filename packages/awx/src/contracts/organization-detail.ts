/**
 * AWX Organization Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for organization
 * detail requests. Used by `mapOrganization()` to shape raw AWX API responses
 * into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "organization"
 * - **id**: The numeric resource ID
 * - **data**: Core organization data with related resource counts
 *
 * ## Field Naming Convention
 *
 * - Related resource counts are extracted from `summary_fields.related`
 * - `created` and `modified` are ISO 8601 timestamps
 */

// ─── Organization Related Resource Counts ──────────────────────

export interface OrganizationRelatedCounts {
  users: number;
  teams: number;
  job_templates: number;
  projects: number;
  inventories: number;
}

// ─── Organization Data ─────────────────────────────────────────

export interface OrganizationData {
  id: number;
  name: string;
  description: string;
  /** Related resource counts from summary_fields.related */
  related: OrganizationRelatedCounts;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ─────────────────────────────────

export interface OrganizationDetailOutput {
  schema_version: "1.0";
  resource_type: "organization";
  id: number;
  data: OrganizationData;
}
