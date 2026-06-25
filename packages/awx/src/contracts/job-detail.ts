/**
 * AWX Job Detail Output Contract — v1.0
 *
 * Canonical TypeScript representation of the `awx_job_detail.py` v1.0 output schema.
 * Every job-related tool MUST return output matching this contract.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **job**: Core job metadata (id, name, status, timestamps, etc.)
 * - **related**: Resolved names (not URLs) for related AWX resources
 * - **host_status_counts**: Count of hosts in each Ansible state — NOT `host_summary`
 * - **derived**: Boolean flags computed from raw data — NOT `extra_vars_summary`
 * - **warnings / errors**: String arrays for user-facing messages
 * - **stdout** (optional): Full job stdout text
 * - **raw_events** (optional): Raw AWX job events array
 *
 * ## Field Naming Convention
 *
 * - Use `host_status_counts` — NOT `host_summary`
 * - Use `derived` — NOT `extra_vars_summary`
 * - `related` fields are resolved names, not raw URLs
 * - `job.limit` is the AWX job limit (host pattern), not a pagination value
 */

// ─── Sub-types ─────────────────────────────────────────────

export interface JobCore {
  id: number;
  name: string;
  status: string;
  failed: boolean;
  job_type: string;
  playbook: string;
  created: string;
  started: string | null;
  finished: string | null;
  elapsed: number | null;
  execution_node: string;
  controller_node: string;
  scm_branch: string;
  verbosity: number;
  forks: number | null;
  limit: string;
  extra_vars?: Record<string, unknown>;
}

export interface Related {
  inventory_name: string;
  project_name: string;
  job_template_name: string;
  instance_group_name: string;
  created_by: string;
  credential_names: string[];
  label_names: string[];
}

export interface HostStatusCounts {
  ok: number;
  failed: number;
  skipped: number;
  changed: number;
  unreachable: number;
}

export interface Derived {
  is_successful: boolean;
  is_failed: boolean;
  has_unreachable_hosts: boolean;
}

// ─── Top-level contract type ───────────────────────────────

export interface JobDetailOutput {
  schema_version: "1.0";
  job: JobCore;
  related: Related;
  host_status_counts: HostStatusCounts;
  derived: Derived;
  warnings: string[];
  errors: string[];
  stdout?: string;
  raw_events?: unknown[];
}
