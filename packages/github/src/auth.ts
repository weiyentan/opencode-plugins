/**
 * GitHub Auth Hook — Personal Access Token (PAT) Authentication
 *
 * Implements OpenCode's `type: "api"` auth hook pattern for GitHub PAT
 * credential storage and injection. The user provides a Personal Access Token
 * (PAT) generated from their GitHub account, and this hook stores it as the
 * plugin's auth key.
 *
 * Follows the AWX plugin's auth pattern at packages/awx/src/auth.ts.
 *
 * ## Auth Flow
 *
 * 1. On first plugin load, OpenCode prompts for a PAT via the auth hook text prompt.
 * 2. The `authorize()` function returns the PAT as the secret key.
 * 3. On every plugin load, init-time validation calls `GET /user`
 *    to verify the token is still active.
 * 4. If validation fails, the user receives a clear, actionable error message.
 *
 * ## Token Validation
 *
 * Validation happens at plugin init time (NOT on first tool call) to provide
 * immediate, clear feedback. Failed init-time validation logs an actionable
 * error, but plugin initialization continues so the user can re-authenticate
 * or fix configuration.
 *
 * ## Error Messages
 *
 * Failed auth produces user-actionable error messages:
 *   - No token configured: "GitHub auth not configured. Set your Personal Access
 *     Token in the plugin settings."
 *   - Network failure: "Cannot reach GitHub API at <baseUrl>. Check your network
 *     connection and ensure api.github.com is reachable."
 *   - Invalid token (401): "GitHub token is invalid or expired. Generate a new
 *     Personal Access Token at https://github.com/settings/tokens."
 *   - Forbidden (403): "GitHub token lacks sufficient permissions. Ensure the
 *     token has the required scopes for the requested operation."
 */

/** Result of an auth validation attempt */
export interface AuthValidationResult {
  /** Whether the token is valid and GitHub API is reachable */
  valid: boolean;
  /** User-facing error message if validation failed (null if valid) */
  error: string | null;
  /** HTTP status code from the validation request (null if network error) */
  status: number | null;
}

/**
 * Validates the PAT token by making a GET request to /user.
 *
 * This is the init-time validation called on plugin load. It checks:
 * 1. The GitHub API is reachable at the configured baseUrl
 * 2. The PAT token is active and valid
 *
 * Returns a structured result so the caller can surface clear error
 * messages to the user.
 *
 * @param baseUrl  The GitHub API base URL (e.g., "https://api.github.com")
 * @param token    The bearer token (PAT) to validate
 * @param signal   Optional AbortSignal for timeout (recommend 10s)
 */
export async function validateGitHubToken(
  baseUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<AuthValidationResult> {
  // Normalize trailing slash
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${normalizedBase}user`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "opencode-plugin-github",
      },
      signal,
    });

    if (response.ok) {
      return { valid: true, error: null, status: response.status };
    }

    if (response.status === 401) {
      return {
        valid: false,
        error: [
          "GitHub token is invalid or expired.",
          "Generate a new Personal Access Token at https://github.com/settings/tokens",
          "and re-enter it in the plugin settings.",
        ].join(" "),
        status: 401,
      };
    }

    if (response.status === 403) {
      return {
        valid: false,
        error: [
          "GitHub token lacks sufficient permissions.",
          "Ensure the token has the required scopes for the requested operation.",
        ].join(" "),
        status: 403,
      };
    }

    return {
      valid: false,
      error: `GitHub API returned HTTP ${response.status}. Check your token and GitHub API status.`,
      status: response.status,
    };
  } catch (err: unknown) {
    // Handle AbortError (timeout) specifically
    if (err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return {
        valid: false,
        error: [
          `Timeout connecting to GitHub API at ${baseUrl}.`,
          "Check your network connection and ensure api.github.com is reachable.",
        ].join(" "),
        status: null,
      };
    }

    // Network or other errors
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: [
        `Cannot reach GitHub API at ${baseUrl}.`,
        "Check your network connection and ensure api.github.com is reachable.",
        `Details: ${message}`,
      ].join(" "),
      status: null,
    };
  }
}

/**
 * Creates a GitHub auth hook configuration for the OpenCode plugin server.
 *
 * Uses the `type: "api"` auth method — the standard OpenCode pattern for
 * non-rotating, user-provided tokens (e.g., API keys, PATs).
 *
 * The `authorize()` function simply returns the user's PAT as the key.
 * Validation is handled separately at init time via `validateGitHubToken()`.
 *
 * The actual credential retrieval for tool execution is handled by the
 * 3-tier fallback chain in `getGitHubClient()` (customConfig → getSecret →
 * process.env.GITHUB_TOKEN), not by this auth hook.
 *
 * @returns Auth hook configuration compatible with OpenCode's Hooks.auth
 */
export function createGitHubAuthHook() {
  return {
    provider: "github",
    methods: [
      {
        type: "api" as const,
        label: "GitHub Personal Access Token",
        prompts: [
          {
            type: "text" as const,
            key: "token",
            message:
              "Enter your GitHub Personal Access Token (PAT). Generate one at https://github.com/settings/tokens.",
          },
        ],
        /**
         * Authorize the user's PAT.
         *
         * Returns the raw token as the secret key. OpenCode stores this
         * securely and injects it into tool requests as the auth key.
         *
         * Empty or whitespace-only tokens fail authorization.
         */
        async authorize(inputs: Record<string, string>) {
          const token = inputs.token;
          if (!token || token.trim().length === 0) {
            return {
              type: "failed" as const,
              message: "GitHub auth not configured. Set your Personal Access Token in the plugin settings.",
            };
          }

          return {
            type: "success" as const,
            key: token.trim(),
          };
        },
      },
    ],
  };
}
