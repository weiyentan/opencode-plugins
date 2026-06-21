/**
 * Sync Project Output Contract
 *
 * Canonical schema for the `awx-sync-project` tool's return value.
 * Defines both:
 * - Zod schema for runtime validation
 * - Inferred TypeScript types for static type checking
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
import { z } from "zod";

// ─── Top-level schema ──────────────────────────────────────

export const ProjectSyncOutputSchema = z.object({
  project_update_id: z.number().int().positive(),
  status: z.string(),
  project_name: z.string(),
  project_id: z.number().int().positive(),
  url: z.string(),
  scm_type: z.string(),
  last_updated: z.string(),
});

// ─── Inferred TypeScript types ─────────────────────────────

/** Structured output returned by the awx-sync-project tool */
export type ProjectSyncOutput = z.infer<typeof ProjectSyncOutputSchema>;
