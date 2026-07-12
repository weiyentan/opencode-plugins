/**
 * GitLab Auth Hook — Personal Access Token (PAT) Authentication
 *
 * Implements OpenCode's `type: "api"` auth hook pattern for GitLab Personal
 * Access Token credential storage and injection. The user provides a PAT
 * generated from their GitLab instance, and this hook stores it as the
 * plugin's auth key.
 *
 * ## Auth Flow
 *
 * 1. On first plugin load, OpenCode prompts for a PAT via the auth hook text prompt.
 * 2. The `authorize()` function returns the PAT as the secret key.
 * 3. On every plugin load, init-time validation calls `GET /api/v4/user`
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
 *   - No token configured: "GitLab auth not configured. Set your Personal Access
 *     Token in the plugin settings."
 *   - Network failure: "Cannot reach GitLab at <baseUrl>. Check your network
 *     connection and ensure GitLab is reachable."
 *   - Invalid token (401): "GitLab token is invalid or expired. Generate a new
 *     Personal Access Token at <baseUrl>/-/user_settings/personal_access_tokens."
 *   - Forbidden (403): "GitLab token lacks sufficient permissions. Ensure the
 *     token has at least `read_user` and `api` scopes."
 *
 * ## Reference
 *
 * - @opencode-ai/plugin auth hook docs
 * - GitLab Personal Access Token: https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html
 */

/** Result of an auth validation attempt */
export interface AuthValidationResult {
  /** Whether the token is valid and GitLab is reachable */
  valid: boolean;
  /** User-facing error message if validation failed (null if valid) */
  error: string | null;
  /** HTTP status code from the validation request (null if network error) */
  status: number | null;
}

/**
 * Validates the Personal Access Token by making a GET request to /api/v4/user.
 *
 * This is the init-time validation called on plugin load. It checks:
 * 1. The GitLab instance is reachable at the configured baseUrl
 * 2. The PAT is active and valid
 * 3. The token has at least basic access (returns the authenticated user)
 *
 * Returns a structured result so the caller can surface clear error
 * messages to the user.
 *
 * @param baseUrl  The configured GitLab base URL (e.g., "https://gitlab.com")
 * @param token    The Personal Access Token to validate
 * @param signal   Optional AbortSignal for timeout (recommend 10s)
 */
export async function validateToken(
  baseUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<AuthValidationResult> {
  // Normalize trailing slash
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${normalizedBase}api/v4/user`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
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
          `GitLab token is invalid or expired.`,
          `Generate a new Personal Access Token at`,
          `${normalizedBase}-/user_settings/personal_access_tokens.`,
        ].join(" "),
        status: 401,
      };
    }

    if (response.status === 403) {
      return {
        valid: false,
        error: [
          `GitLab token lacks sufficient permissions.`,
          `Ensure the token has at least \`read_user\` and \`api\` scopes.`,
        ].join(" "),
        status: 403,
      };
    }

    return {
      valid: false,
      error: `GitLab returned HTTP ${response.status}. Check your GitLab configuration.`,
      status: response.status,
    };
  } catch (err: unknown) {
    // Handle AbortError (timeout) specifically
    if (
      err instanceof DOMException &&
      (err.name === "AbortError" || err.name === "TimeoutError")
    ) {
      return {
        valid: false,
        error: [
          `Timeout connecting to GitLab at ${baseUrl}.`,
          `Check your network connection and ensure GitLab is reachable.`,
        ].join(" "),
        status: null,
      };
    }

    // Network or other errors
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: [
        `Cannot reach GitLab at ${baseUrl}.`,
        `Check your network connection and ensure GitLab is reachable.`,
        `Details: ${message}`,
      ].join(" "),
      status: null,
    };
  }
}

/**
 * Creates a GitLab auth hook configuration for the OpenCode plugin server.
 *
 * Uses the `type: "api"` auth method — the standard OpenCode pattern for
 * non-rotating, user-provided tokens (e.g., API keys, PATs).
 *
 * The `authorize()` function simply returns the user's PAT as the key.
 * Validation is handled separately at init time via `validateToken()`.
 *
 * The actual credential retrieval for tool execution is handled by the
 * 3-tier fallback chain in `getGitLabClient()` (customConfig → getSecret →
 * process.env.GITLAB_TOKEN), not by this auth hook.
 *
 * @returns Auth hook configuration compatible with OpenCode's Hooks.auth
 */
export function createGitLabAuthHook() {
  return {
    provider: "gitlab",
    methods: [
      {
        type: "api" as const,
        label: "GitLab Personal Access Token",
        prompts: [
          {
            type: "text" as const,
            key: "token",
            message:
              "Enter your GitLab Personal Access Token (PAT). Generate one at GitLab → Settings → Access Tokens. Requires `read_user` and `api` scopes.",
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
              message:
                "GitLab auth not configured. Set your Personal Access Token in the plugin settings.",
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
