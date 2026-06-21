/**
 * transforms.ts — Pure functions for transforming job extra variables
 * before they are sent to AWX.
 *
 * All functions are pure: no I/O, no side effects, no network calls.
 */

// ---------------------------------------------------------------------------
// normalizeScmUrl
// ---------------------------------------------------------------------------

/**
 * Converts an SSH Git URL to its HTTPS equivalent.
 *
 * Pattern matched: `git@<host>:<path>[.git]` → `https://<host>/<path>`
 *
 * - Already-HTTPS URLs are returned unchanged.
 * - Non-SSH URLs (HTTP, file://, plain strings) are returned unchanged.
 * - Trailing `.git` suffix is stripped.
 * - Null or undefined input returns an empty string.
 *
 * @param url - The SCM URL to normalize (may be null/undefined)
 * @returns The HTTPS-normalized URL, or the original if not an SSH URL
 */
export function normalizeScmUrl(url: string | null | undefined): string {
  if (url == null || url === "") {
    return "";
  }

  // If already HTTPS, passthrough
  if (url.startsWith("https://") || url.startsWith("http://")) {
    return url;
  }

  // Match SSH format: git@<host>:<path>
  const sshMatch = url.match(/^git@([^:]+):(.+)$/);
  if (!sshMatch) {
    // Not an SSH URL — return unchanged
    return url;
  }

  const [, host, path] = sshMatch;

  if (!host || !path) {
    return url;
  }

  // Strip trailing .git if present
  const cleanPath = path.endsWith(".git") ? path.slice(0, -4) : path;

  return `https://${host}/${cleanPath}`;
}

// ---------------------------------------------------------------------------
// inferGitBranch
// ---------------------------------------------------------------------------

/**
 * Extracts a branch/tag name from a Git ref string.
 *
 * Supported ref prefixes:
 * - `refs/heads/<name>` → `<name>`
 * - `refs/tags/<name>`  → `<name>`
 *
 * Raw branch names (no `refs/` prefix) are returned unchanged.
 * Unrecognized ref prefixes (e.g., `refs/remotes/...`) are returned as-is.
 * Null or undefined input returns an empty string.
 *
 * @param ref - The Git ref string (e.g., "refs/heads/main", "refs/tags/v1.0", "main")
 * @returns The extracted branch/tag name
 */
export function inferGitBranch(ref: string | null | undefined): string {
  if (ref == null || ref === "") {
    return "";
  }

  // refs/heads/<branch>
  if (ref.startsWith("refs/heads/")) {
    return ref.slice("refs/heads/".length);
  }

  // refs/tags/<tag>
  if (ref.startsWith("refs/tags/")) {
    return ref.slice("refs/tags/".length);
  }

  // Raw name or unrecognized prefix — return as-is
  return ref;
}

// ---------------------------------------------------------------------------
// validateRequiredVars
// ---------------------------------------------------------------------------

/**
 * Validates that all required keys are present in the provided extra vars.
 *
 * Returns a list of missing var names (in the order they appear in `required`).
 * If `vars` is null or undefined, all required vars are reported as missing.
 *
 * Note: A key whose value is `null` or `undefined` is still considered *present*
 * (the key exists on the object). Only truly absent keys are reported as missing.
 *
 * @param vars - The extra vars object to validate (may be null/undefined)
 * @param required - The list of required variable names
 * @returns Array of missing variable names (empty if all are present)
 */
export function validateRequiredVars(
  vars: Record<string, unknown>,
  required: string[],
): string[] {
  const missing: string[] = [];

  for (const name of required) {
    if (vars == null || !(name in vars)) {
      missing.push(name);
    }
  }

  return missing;
}
