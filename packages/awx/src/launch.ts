/**
 * launch.ts — Launch AWX jobs with a transforms pipeline.
 *
 * Orchestrates the extra-vars transforms pipeline (normalizeScmUrl →
 * inferGitBranch → validateRequiredVars) before calling the AWX
 * launch API. If any transform step fails, the launch is aborted.
 */
import {
  normalizeScmUrl,
  inferGitBranch,
  validateRequiredVars,
} from "./transforms.js";
import type { AwxClient } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the transforms pipeline */
export interface PipelineOptions {
  /**
   * Key in extra_vars containing the SCM URL to normalize (default: "scm_url")
   */
  scmUrlKey?: string;
  /**
   * Key in extra_vars containing the SCM branch ref to infer (default: "scm_branch")
   */
  scmBranchKey?: string;
  /**
   * List of required variable names. Variables whose value is null,
   * undefined, or an empty string are considered missing.
   * (default: ["inventory", "scm_url", "scm_branch"])
   */
  requiredVars?: string[];
  /**
   * Abort signal to cancel the request (forwarded to the HTTP client).
   */
  abortSignal?: AbortSignal;
}

/** Result of the transforms pipeline */
export interface PipelineResult {
  /** Transformed extra_vars (shallow copy, only mutated fields change) */
  extraVars: Record<string, unknown>;
  /** Non-fatal warnings (e.g., URLs were transformed) */
  warnings: string[];
  /** Fatal errors (e.g., missing required vars) — launch MUST abort if non-empty */
  errors: string[];
}

/** Result of a successful job launch */
export interface LaunchJobResult {
  /** The AWX job ID */
  jobId: number;
  /** The AWX job status (e.g., "pending", "running") */
  jobStatus: string;
  /** Non-fatal warnings from the transforms pipeline */
  warnings: string[];
  /** Fatal errors from the transforms pipeline */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SCM_URL_KEY = "scm_url";
const DEFAULT_SCM_BRANCH_KEY = "scm_branch";
const DEFAULT_REQUIRED_VARS = ["inventory", "scm_url", "scm_branch"];

// ---------------------------------------------------------------------------
// runTransformsPipeline
// ---------------------------------------------------------------------------

/**
 * Run the extra-vars transforms pipeline.
 *
 * Pipeline order:
 * 1. Normalize SCM URL (SSH → HTTPS)
 * 2. Infer git branch (refs/heads/ → short name)
 * 3. Validate required vars
 *
 * Each step produces warnings or errors.
 *
 * @param extraVars - Raw extra vars from the caller (may be undefined)
 * @param options  - Optional pipeline configuration
 * @returns PipelineResult with transformed vars, warnings, and errors
 */
export function runTransformsPipeline(
  extraVars: Record<string, unknown> | undefined,
  options?: PipelineOptions,
): PipelineResult {
  const scmUrlKey = options?.scmUrlKey ?? DEFAULT_SCM_URL_KEY;
  const scmBranchKey = options?.scmBranchKey ?? DEFAULT_SCM_BRANCH_KEY;
  const requiredVars = options?.requiredVars ?? DEFAULT_REQUIRED_VARS;

  const vars: Record<string, unknown> = extraVars ? { ...extraVars } : {};
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── Step 1: Normalize SCM URL ────────────────────────────────────
  const rawUrl = vars[scmUrlKey];
  if (rawUrl !== undefined && rawUrl !== null) {
    const normalized = normalizeScmUrl(String(rawUrl));
    if (normalized !== String(rawUrl)) {
      warnings.push(
        `SCM URL transformed: "${String(rawUrl)}" → "${normalized}"`,
      );
    }
    vars[scmUrlKey] = normalized;
  }

  // ── Step 2: Infer git branch ─────────────────────────────────────
  const rawBranch = vars[scmBranchKey];
  if (rawBranch !== undefined && rawBranch !== null) {
    const inferred = inferGitBranch(String(rawBranch));
    if (inferred !== String(rawBranch)) {
      warnings.push(
        `Git branch inferred: "${String(rawBranch)}" → "${inferred}"`,
      );
    }
    vars[scmBranchKey] = inferred;
  }

  // ── Step 3: Validate required vars ───────────────────────────────
  const missing = validateRequiredVars(vars, requiredVars);
  for (const name of missing) {
    errors.push(`Missing required variable: "${name}"`);
  }

  return { extraVars: vars, warnings, errors };
}

// ---------------------------------------------------------------------------
// launchJob
// ---------------------------------------------------------------------------

/**
 * Execute the launch job workflow.
 *
 * 1. Run the transforms pipeline on extra_vars
 * 2. If pipeline produces errors, return them without launching
 * 3. Call POST /api/v2/job_templates/<id>/launch/ with transformed vars
 * 4. Return job ID, status, warnings, and errors
 *
 * @param client     - The AWX HTTP client
 * @param templateId - The job template ID to launch
 * @param extraVars  - Raw extra vars (may be undefined)
 * @param options    - Optional pipeline configuration
 * @returns LaunchJobResult with job ID and metadata
 * @throws Error if the AWX API returns an unexpected error
 */
export async function launchJob(
  client: AwxClient,
  templateId: number,
  extraVars: Record<string, unknown> | undefined,
  options?: PipelineOptions & { abortSignal?: AbortSignal },
): Promise<LaunchJobResult> {
  // ── Step 1: Run transforms pipeline ─────────────────────────────
  const pipeline = runTransformsPipeline(extraVars, options);

  // ── Step 2: If pipeline errors, abort launch ────────────────────
  if (pipeline.errors.length > 0) {
    return {
      jobId: 0,
      jobStatus: "failed",
      warnings: pipeline.warnings,
      errors: pipeline.errors,
    };
  }

  // ── Step 3: Call AWX launch API ─────────────────────────────────
  const body: Record<string, unknown> = {};

  // Only include extra_vars in the request body if there are any
  const hasExtraVars = Object.keys(pipeline.extraVars).length > 0;
  if (hasExtraVars) {
    body.extra_vars = pipeline.extraVars;
  }

  const response = await client.request(
    "awx-launch-job",
    `/api/v2/job_templates/${templateId}/launch/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    options?.abortSignal,
  );

  // ── Step 4: Parse response body (text-first to handle non-JSON) ──
  const text = await response.text();
  let responseBody: Record<string, unknown> | undefined;
  try {
    responseBody = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  } catch {
    responseBody = undefined;
  }

  // ── Handle error responses ──────────────────────────────────────
  if (!response.ok) {
    const detail =
      typeof responseBody === "object" && responseBody && "detail" in responseBody
        ? String((responseBody as { detail: unknown }).detail)
        : text || response.statusText;
    throw new Error(`AWX launch failed: HTTP ${response.status}: ${detail}`);
  }

  // ── Step 5: Parse success response ──────────────────────────────
  const safeBody = responseBody ?? {};
  const jobId = Number(safeBody.id);
  const jobStatus = String(safeBody.status ?? "unknown");

  return {
    jobId,
    jobStatus,
    warnings: pipeline.warnings,
    errors: pipeline.errors,
  };
}
