/**
 * AWX Execution Environment Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for execution
 * environment detail requests. Used by `mapExecutionEnvironment()` to
 * shape raw AWX API responses into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "execution-environment"
 * - **id**: The numeric resource ID
 * - **data**: Core execution environment data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `organization_name` is resolved from `summary_fields.organization.name`
 * - `image` is the container image URL (e.g., quay.io/ansible/awx-ee:latest)
 */

// ─── Execution Environment Data ──────────────────────────────

export interface ExecutionEnvironmentData {
  id: number;
  name: string;
  description: string;
  /** Container image URL */
  image: string;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ──────────────────────────────

export interface ExecutionEnvironmentDetailOutput {
  schema_version: "1.0";
  resource_type: "execution-environment";
  id: number;
  data: ExecutionEnvironmentData;
}
