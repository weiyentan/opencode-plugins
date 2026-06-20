/**
 * AWX Auth Hook — Bearer Token (PAT) Authentication
 *
 * Implements OpenCode's `type: "api"` auth hook pattern for AAP bearer token
 * credential storage and injection. The user provides a Personal Access Token
 * (PAT) generated from their AAP instance, and this hook stores it as the
 * plugin's auth key.
 *
 * ## Auth Flow
 *
 * 1. On first plugin load, OpenCode prompts for a PAT via the auth hook text prompt.
 * 2. The `authorize()` function returns the PAT as the secret key.
 * 3. On every plugin load, init-time validation calls `GET /api/v2/me/`
 *    to verify the token is still active.
 * 4. If validation fails, the user receives a clear, actionable error message.
 *
 * ## Token Validation
 *
 * Validation happens at plugin init time (NOT on first tool call) to provide
 * immediate, clear feedback. A failed validation blocks plugin initialization
 * so the user never gets a mysterious 401 on a later tool invocation.
 *
 * ## Error Messages
 *
 * Failed auth produces user-actionable error messages:
 *   - No token configured: "AWX auth not configured. Set your Personal Access
 *     Token in the plugin settings."
 *   - Network failure: "Cannot reach AAP at <baseUrl>. Check your baseUrl in
 *     opencode.jsonc and ensure the AAP instance is accessible."
 *   - Invalid token (401): "AWX token is invalid or expired. Generate a new
 *     Personal Access Token at <baseUrl>/api/v2/tokens/ or Profile → Tokens."
 *   - Forbidden (403): "AWX token lacks sufficient permissions. Ensure the
 *     token has at least Read access."
 *
 * ## Reference
 *
 * - ADR 0001: Bearer Token Authentication for AWX Plugin
 * - ADR 0003: Plugin API Surface Discovery
 * - @opencode-ai/plugin auth hook docs
 */

/** Result of an auth validation attempt */
export interface AuthValidationResult {
  /** Whether the token is valid and AAP is reachable */
  valid: boolean;
  /** User-facing error message if validation failed (null if valid) */
  error: string | null;
  /** HTTP status code from the validation request (null if network error) */
  status: number | null;
}

/**
 * Validates the bearer token by making a GET request to /api/v2/me/.
 *
 * This is the init-time validation called on plugin load. It checks:
 * 1. The AAP instance is reachable at the configured baseUrl
 * 2. The bearer token is active and valid
 *
 * Returns a structured result so the caller can surface clear error
 * messages to the user.
 *
 * @param baseUrl  The configured AAP base URL (e.g., "https://aap.tanscloud-internal.com")
 * @param token    The bearer token (PAT) to validate
 * @param signal   Optional AbortSignal for timeout (recommend 10s)
 */
export async function validateToken(
  baseUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<AuthValidationResult> {
  // Normalize trailing slash
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = `${normalizedBase}api/v2/me/`;

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
          `AWX token is invalid or expired.`,
          `Generate a new Personal Access Token at ${normalizedBase}api/v2/tokens/`,
          `or Profile → Tokens in the AAP UI.`,
        ].join(" "),
        status: 401,
      };
    }

    if (response.status === 403) {
      return {
        valid: false,
        error: [
          `AWX token lacks sufficient permissions.`,
          `Ensure the token has at least Read access to the AWX API.`,
        ].join(" "),
        status: 403,
      };
    }

    return {
      valid: false,
      error: `AWX returned HTTP ${response.status}. Check your AAP configuration.`,
      status: response.status,
    };
  } catch (err: unknown) {
    // Handle AbortError (timeout) specifically
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        valid: false,
        error: [
          `Timeout connecting to AAP at ${baseUrl}.`,
          `Check your baseUrl in opencode.jsonc and ensure the AAP instance is reachable.`,
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
        `Cannot reach AAP at ${baseUrl}.`,
        `Check your baseUrl in opencode.jsonc and ensure the AAP instance is accessible.`,
        `Details: ${message}`,
      ].join(" "),
      status: null,
    };
  }
}

/**
 * Creates an AWX auth hook configuration for the OpenCode plugin server.
 *
 * Uses the `type: "api"` auth method — the standard OpenCode pattern for
 * non-rotating, user-provided tokens (e.g., API keys, PATs).
 *
 * The `authorize()` function simply returns the user's PAT as the key.
 * Validation is handled separately at init time via `validateToken()`.
 *
 * @returns Auth hook configuration compatible with OpenCode's Hooks.auth
 */
export function createAwxAuthHook() {
  return {
    provider: "awx",
    methods: [
      {
        type: "api" as const,
        label: "AWX Bearer Token",
        prompts: [
          {
            type: "text" as const,
            key: "token",
            message:
              "Enter your AWX Personal Access Token (PAT). Generate one at AAP → Profile → Tokens or /api/v2/tokens/.",
          },
        ],
        /**
         * Authorize the user's PAT.
         *
         * Returns the raw token as the secret key. OpenCode stores this
         * securely and injects it into tool requests as the auth key.
         */
        async authorize(inputs: Record<string, string>) {
          const token = inputs.token;
          if (!token || token.trim().length === 0) {
            return {
              type: "failure" as const,
              error:
                "AWX auth not configured. Set your Personal Access Token in the plugin settings.",
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
