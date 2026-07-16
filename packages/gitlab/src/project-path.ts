/**
 * project-path.ts — Shared utility for encoding GitLab project IDs as URL path segments.
 *
 * GitLab's REST API accepts project IDs either as a numeric ID or as a URL-encoded
 * path (e.g., "group%2Fsubgroup%2Fproject"). This module provides a single function
 * that handles both cases consistently, with a guard against double-encoding.
 *
 * ## Usage
 *
 * ```typescript
 * import { projectPathSegment } from "../project-path.js";
 *
 * // Numeric ID
 * projectPathSegment(12345);        // "12345"
 *
 * // Simple path
 * projectPathSegment("my-project"); // "my-project"
 *
 * // Nested path
 * projectPathSegment("group/subproject"); // "group%2Fsubproject"
 *
 * // Already-encoded path (no double-encoding)
 * projectPathSegment("group%2Fsubproject"); // "group%2Fsubproject"
 * ```
 *
 * @module
 */

/**
 * Encodes a GitLab project ID for use as a path segment in REST API URLs.
 *
 * Numeric IDs pass through as-is. String paths (e.g., "group/subgroup/project")
 * are URL-encoded so the slashes become %2F. Already-encoded paths with %2F
 * are not double-encoded.
 */
export function projectPathSegment(projectId: string | number): string {
  if (typeof projectId === "number") {
    return String(projectId);
  }
  if (projectId.includes("%2F")) {
    return projectId;
  }
  return encodeURIComponent(projectId);
}
