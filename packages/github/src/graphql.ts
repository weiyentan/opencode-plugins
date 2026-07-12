/**
 * graphql.ts — Thin GitHub GraphQL wrapper around @octokit/graphql.
 *
 * Provides a type-safe GraphQL client for the GitHub plugin that wraps
 * `@octokit/graphql` with:
 *   - Auth injection via the configured PAT
 *   - Variable serialization
 *   - GitHub-schema error parsing
 *   - Rate-limit tracking from response extensions
 *
 * ## Design
 *
 * The thin wrapper pattern keeps the GitHub plugin decoupled from
 * `@octokit/graphql`'s API shape. If we ever need to swap the underlying
 * implementation (e.g., use raw fetch for GraphQL), only this module changes.
 *
 * ## Reference
 *
 *  - @octokit/graphql: https://github.com/octokit/graphql.js
 *  - GitHub GraphQL API: https://docs.github.com/en/graphql
 */

import { graphql as octokitGraphql, GraphqlResponseError } from "@octokit/graphql";
import type { RequestParameters } from "@octokit/types";

/* ── Types ──────────────────────────────────────────────────────── */

/** Options for createGraphQLClient */
export interface GraphQLClientOptions {
  /** GitHub API base URL (default: "https://api.github.com") */
  baseUrl?: string;
  /** Additional headers to include in every request */
  headers?: Record<string, string>;
  /**
   * Optional request hook callback — invoked before every GraphQL request.
   * Useful for logging or timing instrumentation.
   */
  requestHook?: (request: {
    query: string;
    variables?: Record<string, unknown>;
  }) => void;
}

/**
 * Rate-limit information extracted from a GraphQL response.
 *
 * GitHub GraphQL returns rate-limit data in the `rateLimit` field
 * of the response extensions.
 */
export interface GraphQLRateLimit {
  /** Maximum points allowed in the current window */
  limit: number;
  /** Points remaining in the current window */
  remaining: number;
  /** Unix timestamp (seconds) when the window resets */
  resetAt: string; // ISO-8601
  /** Cost of the most recent query in points */
  cost: number;
  /** Node count (if available) */
  nodeCount?: number;
}

/**
 * Structured result from a GraphQL query execution.
 *
 * The `data` field contains the query result if successful.
 * The `errors` array contains any GraphQL or network errors.
 * The `rateLimit` field contains rate-limit info from response extensions (if available).
 */
export interface GraphQLResult<T = unknown> {
  /** The query response data (undefined if errors occurred) */
  data: T | undefined;
  /** Array of GraphQL schema errors (undefined if no errors) */
  errors: GraphQLResponseErrorItem[] | undefined;
  /** Rate-limit info from response extensions (undefined if not available) */
  rateLimit: GraphQLRateLimit | undefined;
}

/**
 * A single GraphQL response error as returned by the GitHub API.
 */
export interface GraphQLResponseErrorItem {
  /** The error message */
  message: string;
  /** The error type (e.g., "NOT_FOUND", "FORBIDDEN") */
  type?: string;
  /** The path to the field that caused the error */
  path?: (string | number)[];
  /** The locations in the query where the error occurred */
  locations?: { line: number; column: number }[];
}

/** The GitHub GraphQL client interface */
export interface GitHubGraphQLClient {
  /**
   * Execute a GraphQL query against the GitHub API.
   *
   * @param query      The GraphQL query string
   * @param variables  Optional variables to pass to the query
   * @returns A structured GraphQLResult containing data, errors, and rate-limit info
   */
  request<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<GraphQLResult<T>>;
}

/* ── Internal helpers ──────────────────────────────────────────── */

/**
 * Extract rate-limit information from GitHub's response extensions.
 *
 * GitHub GraphQL responses include a `rateLimit` object in the
 * `extensions` field when the requesting token identifies a user.
 *
 * @param extensions  The raw extensions object from an @octokit/graphql response
 * @returns Parsed rate limit info, or undefined if not present
 */
function extractRateLimitFromExtensions(
  extensions: Record<string, unknown> | undefined,
): GraphQLRateLimit | undefined {
  if (!extensions) return undefined;

  // GitHub GraphQL returns rate limit in two possible paths:
  // 1. extensions.rateLimit (top-level)
  // 2. extensions.rate_limit (snake_case variant)
  const rateLimit = (extensions.rateLimit ?? extensions.rate_limit) as
    | Record<string, unknown>
    | undefined;

  if (!rateLimit) return undefined;

  return {
    limit: typeof rateLimit.limit === "number" ? rateLimit.limit : 0,
    remaining: typeof rateLimit.remaining === "number" ? rateLimit.remaining : 0,
    resetAt: typeof rateLimit.resetAt === "string" ? rateLimit.resetAt : "",
    cost: typeof rateLimit.cost === "number" ? rateLimit.cost : 0,
    nodeCount: typeof rateLimit.nodeCount === "number" ? rateLimit.nodeCount : undefined,
  };
}

/**
 * Normalize GraphQL response errors into GraphQLResponseErrorItem[].
 *
 * Handles the shape from @octokit/graphql's `GraphqlResponseError`
 * response format.
 */
function normalizeErrors(
  errors: readonly { message: unknown; type?: unknown; path?: unknown; locations?: unknown }[],
): GraphQLResponseErrorItem[] {
  return errors.map((err) => ({
    message: typeof err.message === "string" ? err.message : String(err.message),
    type: typeof err.type === "string" ? err.type : undefined,
    path: Array.isArray(err.path)
      ? err.path.map((p) => (typeof p === "number" || typeof p === "string" ? p : String(p)))
      : undefined,
    locations: Array.isArray(err.locations)
      ? (err.locations as { line: number; column: number }[]).map((loc) => ({
          line: loc.line,
          column: loc.column,
        }))
      : undefined,
  }));
}

/* ── Factory ────────────────────────────────────────────────────── */

/**
 * Create a GitHub GraphQL client backed by @octokit/graphql.
 *
 * Wraps @octokit/graphql with structured error handling and rate-limit
 * tracking. The underlying octokit instance handles auth injection and
 * HTTP transport.
 *
 * @param token  GitHub Personal Access Token (PAT) for Authorization
 * @param opts   Optional client configuration
 * @returns A structured GitHubGraphQLClient
 */
export function createGraphQLClient(
  token: string,
  opts?: GraphQLClientOptions,
): GitHubGraphQLClient {
  const baseUrl = opts?.baseUrl ?? "https://api.github.com";

  // Create the underlying @octokit/graphql instance
  const gql = octokitGraphql.defaults({
    baseUrl,
    headers: {
      authorization: `token ${token}`,
      ...opts?.headers,
    },
  });

  return {
    async request<T = unknown>(
      query: string,
      variables?: Record<string, unknown>,
    ): Promise<GraphQLResult<T>> {
      // Invoke request hook if configured
      if (opts?.requestHook) {
        opts.requestHook({ query, variables });
      }

      try {
        // Execute the GraphQL query
        const response = await gql<T & { extensions?: Record<string, unknown> }>(
          query,
          variables as RequestParameters,
        );

        // Extract rate-limit info from extensions
        const rateLimit = extractRateLimitFromExtensions(
          (response as Record<string, unknown>).extensions as
            | Record<string, unknown>
            | undefined,
        );

        return {
          data: response,
          errors: undefined,
          rateLimit,
        };
      } catch (err: unknown) {
        // @octokit/graphql throws GraphqlResponseError on GraphQL-level errors
        if (err instanceof GraphqlResponseError) {
          const graphqlError = err as GraphqlResponseError<T>;
          const extensions = graphqlError.response?.data as
            | Record<string, unknown>
            | undefined;
          const rateLimit = extractRateLimitFromExtensions(extensions);

          return {
            data: graphqlError.data as T | undefined,
            errors: graphqlError.errors
              ? normalizeErrors(graphqlError.errors)
              : [{ message: err.message }],
            rateLimit,
          };
        }

        // Generic error fallback
        const message =
          err instanceof Error ? err.message : String(err);
        return {
          data: undefined,
          errors: [{ message }],
          rateLimit: undefined,
        };
      }
    },
  };
}
