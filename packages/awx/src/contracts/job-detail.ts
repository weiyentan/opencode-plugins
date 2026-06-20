/**
 * AWX Job Detail Output Contract — v1.0
 *
 * Defines the TypeScript interface and zod validation schema for the
 * structured response returned by AWX job detail tools.
 *
 * This contract mirrors the Python `awx_job_detail.py` v1.0 output schema.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **job**: Core job metadata (id, name, status, timestamps, etc.)
 * - **related**: Resolved names (not URLs) for related AWX resources
 * - **host_status_counts**: Count of hosts in each Ansible state
 * - **derived**: Boolean flags computed from raw data (not AWX API fields)
 * - **warnings / errors**: String arrays for user-facing messages
 * - **stdout** (optional): Full job stdout text
 * - **raw_events** (optional): Raw AWX job events array
 *
 * ## Snapshot Testing
 *
 * Fixture JSON files in `tests/fixtures/` serve as contract snapshots.
 * When the Python `awx_job_detail.py` v1.0 output contract changes,
 * regenerate the fixtures (see README.md for instructions) and re-run
 * tests to verify schema compatibility.
 */

import { z } from "zod";

// ─── Sub-schemas ───────────────────────────────────────────

export const JobCoreSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  failed: z.boolean(),
  job_type: z.string(),
  playbook: z.string(),
  created: z.string(),
  started: z.string().nullable(),
  finished: z.string().nullable(),
  elapsed: z.number().nullable(),
  execution_node: z.string(),
  controller_node: z.string(),
  scm_branch: z.string(),
  verbosity: z.number().int().min(0),
  forks: z.number().int().min(0).nullable(),
  limit: z.string(),
});

export const RelatedSchema = z.object({
  inventory_name: z.string(),
  project_name: z.string(),
  job_template_name: z.string(),
  instance_group_name: z.string(),
  created_by: z.string(),
  credential_names: z.array(z.string()),
  label_names: z.array(z.string()),
});

export const HostStatusCountsSchema = z.object({
  ok: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  changed: z.number().int().min(0),
  unreachable: z.number().int().min(0),
});

export const DerivedSchema = z.object({
  is_successful: z.boolean(),
  is_failed: z.boolean(),
  has_unreachable_hosts: z.boolean(),
});

// ─── Top-level schema ──────────────────────────────────────

export const JobDetailOutputSchema = z.object({
  schema_version: z.literal("1.0"),
  job: JobCoreSchema,
  related: RelatedSchema,
  host_status_counts: HostStatusCountsSchema,
  derived: DerivedSchema,
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  stdout: z.string().optional(),
  raw_events: z.array(z.unknown()).optional(),
});

// ─── Inferred TypeScript types ─────────────────────────────

/** Core job metadata fields */
export type JobCore = z.infer<typeof JobCoreSchema>;

/** Resolved names for related AWX resources */
export type Related = z.infer<typeof RelatedSchema>;

/** Count of hosts in each Ansible state */
export type HostStatusCounts = z.infer<typeof HostStatusCountsSchema>;

/** Computed boolean flags */
export type Derived = z.infer<typeof DerivedSchema>;

/** Top-level JobDetailOutput contract (v1.0) */
export type JobDetailOutput = z.infer<typeof JobDetailOutputSchema>;
