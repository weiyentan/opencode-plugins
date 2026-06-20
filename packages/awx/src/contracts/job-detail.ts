/**
 * AWX Job Detail Output Contract (v1.0)
 *
 * Canonical TypeScript representation of the awx_job_detail.py v1.0 output schema.
 * Every job-related tool MUST return output matching this interface.
 *
 * This contract has been verified against the actual awx_job_detail.py Python script
 * output — the fixture snapshots in tests/contracts/__snapshots__/ are the ground truth.
 *
 * ## Schema Version
 *
 * The `schema_version` field is always "1.0" for this contract. Any future schema
 * changes MUST bump this version and be coordinated with the Python script.
 *
 * ## Field Naming Convention
 *
 * - The top-level field is `host_status_counts` — NOT `host_summary`
 * - The computed-booleans field is `derived` — NOT `extra_vars_summary`
 * - The `job.limit` field IS the AWX job limit (host pattern), not a pagination value
 *
 * ## Regeneration
 *
 * To regenerate the contract snapshots after fixture changes:
 *   python3 scripts/generate-snapshots.py
 */

/** Core job metadata fields from the AWX API */
export interface JobCore {
  /** AWX job unique identifier */
  id: number;
  /** Human-readable job name from the job template */
  name: string;
  /** AWX job status: "new" | "pending" | "waiting" | "running" | "successful" | "failed" | "error" | "canceled" */
  status: string;
  /** Whether the job has failed (AWX sets this explicitly on failure/cancel/error) */
  failed: boolean;
  /** Type of job: "run" (job template) or "check" (dry-run) */
  job_type: string;
  /** Playbook filename executed by this job */
  playbook: string;
  /** ISO 8601 timestamp of job creation */
  created: string;
  /** ISO 8601 timestamp of job start, or null if not yet started */
  started: string | null;
  /** ISO 8601 timestamp of job completion, or null if still running */
  finished: string | null;
  /** Elapsed execution time in seconds, or null if job is still running */
  elapsed: number | null;
  /** Hostname of the execution node that ran the job */
  execution_node: string;
  /** Hostname of the AWX controller node */
  controller_node: string;
  /** SCM branch used for this job run */
  scm_branch: string;
  /** AWX verbosity level (0-4) */
  verbosity: number;
  /** Number of forks used, or null if default */
  forks: number | null;
  /** Host limit pattern applied to the job ("" if unlimited) */
  limit: string;
}

/** Resolved related-object names (not raw URLs) */
export interface JobRelated {
  /** Inventory display name from summary_fields */
  inventory_name: string;
  /** Project display name from summary_fields */
  project_name: string;
  /** Job template display name from summary_fields */
  job_template_name: string;
  /** Instance group display name from summary_fields */
  instance_group_name: string;
  /** Username of the user who launched the job */
  created_by: string;
  /** List of credential names used by this job */
  credential_names: string[];
  /** List of label names applied to this job */
  label_names: string[];
}

/** Per-host status counts from the AWX host summary */
export interface HostStatusCounts {
  /** Number of hosts with status "ok" */
  ok: number;
  /** Number of hosts with status "failed" */
  failed: number;
  /** Number of hosts with status "skipped" */
  skipped: number;
  /** Number of hosts with status "changed" */
  changed: number;
  /** Number of hosts with status "unreachable" */
  unreachable: number;
}

/** Derived/computed boolean flags (not raw API fields) */
export interface Derived {
  /** Job completed with status "successful" */
  is_successful: boolean;
  /** Job completed with status "failed", "canceled", or "error" */
  is_failed: boolean;
  /** At least one host was unreachable during execution */
  has_unreachable_hosts: boolean;
}

/**
 * Canonical job detail output matching awx_job_detail.py v1.0 schema.
 *
 * This is the return type for awx-job-status and awx-launch-job tools.
 * All field names and shapes are locked to the Python script's output.
 */
export interface JobDetailOutput {
  /** Schema version — always "1.0" for this contract */
  schema_version: "1.0";

  /** Core job metadata */
  job: JobCore;

  /** Resolved related-object names (not raw URLs) */
  related: JobRelated;

  /** Per-host status counts — NOT host_summary */
  host_status_counts: HostStatusCounts;

  /** Derived boolean flags — NOT extra_vars_summary */
  derived: Derived;

  /** Human-readable warnings (e.g., from job_explanation) */
  warnings: string[];

  /** Error messages or tracebacks */
  errors: string[];

  /** Optional job stdout content (only with --include-stdout flag) */
  stdout?: string;

  /** Optional raw job events array (only with --include-events flag) */
  raw_events?: unknown[];
}
