/**
 * Sync Project Output Contract
 *
 * Canonical schema for the `awx-sync-project` tool's return value.
 *
 * ## Schema Fields
 *
 * - **project_update_id**: The AWX project update record ID
 * - **status**: Status of the triggered sync (e.g., "running", "successful", "failed")
 * - **project_name**: Resolved name of the AWX project
 * - **project_id**: The AWX project ID (echoed from input)
 * - **url**: API URL of the project
 * - **scm_type**: SCM type (e.g., "git", "svn")
 * - **last_updated**: Timestamp of last project update
 */

/** Structured output returned by the awx-sync-project tool */
export interface ProjectSyncOutput {
  project_update_id: number;
  status: string;
  project_name: string;
  project_id: number;
  url: string;
  scm_type: string;
  last_updated: string;
}
