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
 * - **resource_type**: Always "execution_environment"
 * - **id**: The numeric resource ID
 * - **data**: Core execution environment data with resolved related names
 *
 * ## Field Naming Convention
 *
 * - Related resource names are resolved from `summary_fields` (not raw IDs)
 * - `pull` indicates the image pull policy (e.g., "always", "missing", "never")
 */

// ─── Execution Environment Data ──────────────────────────────

export interface ExecutionEnvironmentData {
  id: number;
  name: string;
  description: string;
  /** Container image reference (e.g., "quay.io/ansible/awx-ee:latest") */
  image: string;
  /** Resolved from summary_fields.credential.name, or empty string */
  credential_name: string;
  /** Image pull policy: "always", "missing", or "never" */
  pull: string;
  /** ISO 8601 timestamp — date the EE was created */
  created: string;
  /** ISO 8601 timestamp — date the EE was last modified */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface ExecutionEnvironmentDetailOutput {
  schema_version: "1.0";
  resource_type: "execution_environment";
  id: number;
  data: ExecutionEnvironmentData;
}
