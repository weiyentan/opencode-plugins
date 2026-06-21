/**
 * job-status.ts — AWX Job Status Mapping
 *
 * Transforms raw AWX API job responses into the canonical
 * JobDetailOutput v1.0 contract format.
 *
 * ## Key Transformations
 *
 * - **related**: Extracts resolved names from AWX `summary_fields`
 *   (inventory, project, job_template, instance_group, created_by,
 *   credentials, labels) rather than returning raw URLs.
 *
 * - **host_status_counts**: Maps from `host_summary` (AWX key
 *   "failures" → contract key "failed").
 *
 * - **derived**: Computes booleans (is_successful, is_failed,
 *   has_unreachable_hosts) from job status and host counts.
 *
 * - **warnings / errors**: Populated from job status context.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/jobs/142/");
 * const awxJob = await response.json();
 * const output = mapAwxJobToContract(awxJob);
 * ```
 */

import type { AwxClient } from "./client.js";
import type {
  JobCore,
  Related,
  HostStatusCounts,
  Derived,
  JobDetailOutput,
} from "./contracts/job-detail.js";

// ─── Types ─────────────────────────────────────────────────────

/**
 * Raw AWX API job response shape (the subset we care about).
 * We use a broad type since we're accessing dynamic properties.
 */
export interface RawAwxJob {
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
  summary_fields?: {
    inventory?: { id?: number; name?: string };
    project?: { id?: number; name?: string };
    job_template?: { id?: number; name?: string };
    instance_group?: { id?: number; name?: string };
    created_by?: { id?: number; username?: string };
    credentials?: Array<{ id?: number; name?: string }>;
    labels?: { results?: Array<{ id?: number; name?: string }> };
  };
  host_summary?: {
    ok?: number;
    failures?: number;
    changed?: number;
    unreachable?: number;
    skipped?: number;
  };
}

// ─── Mapping Functions ─────────────────────────────────────────

/**
 * Resolve the related resource names from AWX summary_fields.
 */
function mapRelated(awxJob: RawAwxJob): Related {
  const sf = awxJob.summary_fields ?? {};

  return {
    inventory_name: sf.inventory?.name ?? "",
    project_name: sf.project?.name ?? "",
    job_template_name: sf.job_template?.name ?? "",
    instance_group_name: sf.instance_group?.name ?? "",
    created_by: sf.created_by?.username ?? "",
    credential_names:
      sf.credentials?.map((c) => c.name ?? "").filter(Boolean) ?? [],
    label_names:
      sf.labels?.results?.map((l) => l.name ?? "").filter(Boolean) ?? [],
  };
}

/**
 * Map host_summary from the AWX API to host_status_counts.
 * Note: AWX uses the key "failures", but the contract uses "failed".
 */
function mapHostStatusCounts(awxJob: RawAwxJob): HostStatusCounts {
  const hs = awxJob.host_summary ?? {};

  return {
    ok: hs.ok ?? 0,
    failed: hs.failures ?? 0,
    skipped: hs.skipped ?? 0,
    changed: hs.changed ?? 0,
    unreachable: hs.unreachable ?? 0,
  };
}

/**
 * Compute derived booleans from job status and host counts.
 */
function mapDerived(awxJob: RawAwxJob): Derived {
  const failed = awxJob.failed;
  const unreachable = awxJob.host_summary?.unreachable ?? 0;

  return {
    is_successful: !failed,
    is_failed: failed,
    has_unreachable_hosts: unreachable > 0,
  };
}

/**
 * Extract user-facing error messages from a job.
 */
function mapErrors(awxJob: RawAwxJob): string[] {
  const hostFailed = awxJob.host_summary?.failures ?? 0;
  const unreachable = awxJob.host_summary?.unreachable ?? 0;
  const errors: string[] = [];

  if (awxJob.failed && hostFailed > 0) {
    errors.push(
      `Job failed: ${hostFailed} host(s) reported failure(s).`,
    );
  }

  if (unreachable > 0) {
    errors.push(
      `${unreachable} host(s) were unreachable during job execution.`,
    );
  }

  return errors;
}

/**
 * Extract user-facing warning messages.
 */
function mapWarnings(_awxJob: RawAwxJob): string[] {
  // Initial implementation: no warnings inferred from job detail alone.
  // Future enhancement: parse stdout for deprecation warnings.
  return [];
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Transform a raw AWX API job response into the JobDetailOutput v1.0 contract.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param awxJob  Raw JSON-decoded AWX API response from /api/v2/jobs/<id>/
 * @returns       A JobDetailOutput matching the v1.0 contract
 */
export function mapAwxJobToContract(
  awxJob: RawAwxJob,
  stdout?: string,
): JobDetailOutput {
  const job: JobCore = {
    id: awxJob.id,
    name: awxJob.name,
    status: awxJob.status,
    failed: awxJob.failed,
    job_type: awxJob.job_type,
    playbook: awxJob.playbook,
    created: awxJob.created,
    started: awxJob.started,
    finished: awxJob.finished,
    elapsed: awxJob.elapsed,
    execution_node: awxJob.execution_node,
    controller_node: awxJob.controller_node,
    scm_branch: awxJob.scm_branch,
    verbosity: awxJob.verbosity,
    forks: awxJob.forks,
    limit: awxJob.limit,
  };

  const output: JobDetailOutput = {
    schema_version: "1.0",
    job,
    related: mapRelated(awxJob),
    host_status_counts: mapHostStatusCounts(awxJob),
    derived: mapDerived(awxJob),
    warnings: mapWarnings(awxJob),
    errors: mapErrors(awxJob),
  };

  if (stdout !== undefined) {
    output.stdout = stdout;
  }

  return output;
}

/**
 * Fetch job status from AWX and return formatted JobDetailOutput.
 *
 * Makes HTTP requests via the AwxClient:
 * 1. GET /api/v2/jobs/<jobId>/
 * 2. Optionally GET /api/v2/jobs/<jobId>/stdout/?format=txt
 *
 * @param client          The AWX HTTP client
 * @param jobId           Numeric job ID
 * @param includeStdout   Whether to fetch and include stdout
 * @param abortSignal     Optional abort signal
 * @param toolName        Optional tool name for metrics attribution (default: "awx-job-status")
 * @returns               Formatted JobDetailOutput
 */
export async function fetchJobStatus(
  client: AwxClient,
  jobId: number,
  includeStdout?: boolean,
  abortSignal?: AbortSignal,
  toolName = "awx-job-status",
): Promise<JobDetailOutput> {
  // Fetch job detail
  const jobResponse = await client.request(
    toolName,
    `/api/v2/jobs/${jobId}/`,
    undefined,
    abortSignal,
  );

  if (!jobResponse.ok) {
    const errorBody = await jobResponse.text().catch(() => "");
    throw new Error(
      `AWX API error (${jobResponse.status}): ${errorBody || jobResponse.statusText}`,
    );
  }

  const awxJob = (await jobResponse.json()) as RawAwxJob;

  // Optionally fetch stdout
  let stdout: string | undefined;
  if (includeStdout) {
    const stdoutResponse = await client.request(
      toolName,
      `/api/v2/jobs/${jobId}/stdout/?format=txt`,
      undefined,
      abortSignal,
    );

    if (stdoutResponse.ok) {
      stdout = await stdoutResponse.text();
    }
  }

  return mapAwxJobToContract(awxJob, stdout);
}
