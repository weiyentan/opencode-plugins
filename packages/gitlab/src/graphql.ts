/**
 * graphql.ts — GraphQL API wrapper for the GitLab plugin.
 *
 * Provides a lightweight GraphQL client targeting the GitLab GraphQL API
 * at `/api/graphql` using native `fetch`. No external SDK dependency
 * (no @octokit, no apollo-client, no graphql-request).
 *
 * ## Features
 *
 * - Auth injection: Bearer token added to every request
 * - Variable serialization: Variables are serialized in the JSON body
 * - Error parsing: GraphQL-level errors (in the `errors` array) are
 *   surfaced as a structured `GraphQLResult` alongside HTTP errors
 * - Operation support: `query` and `mutation` operations
 *
 * ## Reference
 *
 * - GitLab GraphQL API: https://docs.gitlab.com/ee/api/graphql/
 * - GraphQL endpoint: POST /api/graphql
 *
 * @module
 */

/** Options for constructing the GraphQL client */
export interface GraphQLClientOptions {
  /** Request timeout in milliseconds (default: 30_000) */
  timeoutMs?: number;
}

/** A single GraphQL error from the response `errors` array */
export interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

/** The result of a GraphQL operation */
export interface GraphQLResult<TData = Record<string, unknown>> {
  /** The data returned by the operation (null if errors prevented execution) */
  data: TData | null;
  /** GraphQL-level errors from the `errors` array (not HTTP errors) */
  errors: GraphQLError[] | null;
  /** HTTP status code from the response */
  status: number;
  /** Whether the HTTP request succeeded (status 2xx, no GraphQL errors) */
  ok: boolean;
}

/** Variables for GraphQL operations (key-value pairs of scalar types) */
export type GraphQLVariables = Record<string, unknown>;

/**
 * GitLab GraphQL client.
 *
 * Wraps native `fetch` to send GraphQL queries and mutations to the
 * GitLab API, handling auth injection, error parsing, and variable
 * serialization.
 */
export interface GraphQLClient {
  /**
   * Execute a GraphQL query or mutation.
   *
   * @param query       The GraphQL query or mutation string
   * @param variables   Optional variables for the operation
   * @param abortSignal Optional AbortSignal for cancellation
   * @returns A structured result with data and/or errors
   */
  request<TData = Record<string, unknown>>(
    query: string,
    variables?: GraphQLVariables,
    abortSignal?: AbortSignal,
  ): Promise<GraphQLResult<TData>>;
}

/* ── Factory ───────────────────────────────────────────────────── */

/**
 * Create a GitLab GraphQL client.
 *
 * @param baseUrl  The GitLab base URL (e.g., "https://gitlab.com")
 * @param token    Personal Access Token for Authorization header
 * @param opts     Optional client configuration
 */
export function createGraphQLClient(
  baseUrl: string,
  token: string,
  opts?: GraphQLClientOptions,
): GraphQLClient {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const endpoint = `${normalizedBase}api/graphql`;
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  return {
    async request<TData = Record<string, unknown>>(
      query: string,
      variables?: GraphQLVariables,
      abortSignal?: AbortSignal,
    ): Promise<GraphQLResult<TData>> {
      // Set up timeout
      const controller = new AbortController();
      const timeout = setTimeout(
        () =>
          controller.abort(
            new DOMException("GraphQL request timed out.", "TimeoutError"),
          ),
        timeoutMs,
      );

      // Combine with caller's abort signal
      const signal = abortSignal
        ? ((): AbortSignal => {
            if (typeof (AbortSignal as any).any === "function") {
              return (AbortSignal as any).any([abortSignal, controller.signal]);
            }
            // Fallback for Node 18: chain abort events
            const onAbort = () => controller.abort();
            abortSignal.addEventListener("abort", onAbort, { once: true });
            if (abortSignal.aborted) controller.abort();
            return controller.signal;
          })()
        : controller.signal;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            query,
            variables: variables ?? {},
          }),
          signal,
        });

        // HTTP error — return structured result
        if (!response.ok) {
          return {
            data: null,
            errors: [
              {
                message: `GraphQL request failed with HTTP ${response.status}: ${response.statusText}`,
              },
            ],
            status: response.status,
            ok: false,
          };
        }

        // Parse the JSON body
        const body = (await response.json()) as {
          data?: TData | null;
          errors?: GraphQLError[] | null;
        };

        // GraphQL-level errors (response was HTTP 200 but had errors)
        const hasGraphQLErrors = Array.isArray(body.errors) && body.errors.length > 0;

        return {
          data: body.data ?? null,
          errors: body.errors ?? null,
          status: response.status,
          ok: !hasGraphQLErrors,
        };
      } catch (err: unknown) {
        // AbortError / TimeoutError — surface as a structured error
        if (
          err instanceof DOMException &&
          (err.name === "AbortError" || err.name === "TimeoutError")
        ) {
          return {
            data: null,
            errors: [
              {
                message: `GraphQL request aborted: ${err.message}`,
              },
            ],
            status: 0,
            ok: false,
          };
        }

        // Network or other errors
        const message = err instanceof Error ? err.message : String(err);
        return {
          data: null,
          errors: [
            {
              message: `GraphQL request failed: ${message}`,
            },
          ],
          status: 0,
          ok: false,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
