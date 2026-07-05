/**
 * AWX Project Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for project detail
 * requests. Used by `mapProject()` to shape raw AWX API responses into
 * the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "project"
 * - **id**: The numeric resource ID
 * - **data**: Core project data with resolved related names and derived flags
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `scm_type` is the SCM provider (e.g., "git", "svn", "")
 * - `last_updated` may be null for never-updated projects
 * - `created_by` is resolved from summary_fields.created_by.username
 */

// ─── Project Data ────────────────────────────────────────────

export interface ProjectRelated {
  organization_name: string;
  created_by: string;
}

export interface ProjectDerived {
  is_successful: boolean;
  is_failed: boolean;
}

export interface ProjectData {
  id: number;
  name: string;
  description: string;
  scm_type: string;
  scm_url: string;
  scm_branch: string;
  scm_revision: string;
  credential_id: number | null;
  credential_name: string;
  default_environment_id: number | null;
  default_environment_name: string;
  status: string;
  last_updated: string | null;
  created: string;
  modified: string;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** Resolved from summary_fields.created_by.username */
  created_by: string;
  /** Whether the project is in a successful state */
  is_successful: boolean;
  /** Whether the project is in a failed state */
  is_failed: boolean;
  warnings: string[];
  errors: string[];
}

// ─── Top-level output envelope ───────────────────────────────

export interface ProjectDetailOutput {
  schema_version: "1.0";
  resource_type: "project";
  id: number;
  data: ProjectData;
}
