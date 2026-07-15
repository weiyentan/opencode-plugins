/**
 * query.ts — Generic GraphQL query passthrough tool for GitLab.
 *
 * gitlab_query: Executes an arbitrary GraphQL query against the GitLab API
 * with auth injection and returns the full raw response.
 *
 * ## Tool
 *
 * - **gitlab_query** &mdash; Takes `query` (string) and optional `variables`
 *   (record), returns the response data formatted in output and `_raw` with
 *   the full GraphQL response data in metadata. When the query returns schema
 *   errors, they are formatted as structured messages in the output string
 *   and `_raw` in metadata.
 *
 * ## Design
 *
 * This is the escape hatch — for queries that don't have a dedicated tool
 * (e.g., custom GraphQL queries), users can execute arbitrary GraphQL
 * through this tool. All other rich tools use GraphQL internally and
 * expose curated fields; this tool exposes the raw response.
 */

import { tool } from "@opencode-ai/plugin";
import type { GraphQLClient } from "../graphql.js";

const z = tool.schema;

/** Maximum length for stringified JSON in human-readable output (50 kB) */
const MAX_OUTPUT_LENGTH = 50_000;

/**
 * Format the GraphQL response data as a human-readable string.
 * For large responses the output is truncated with a note that the
 * full data is available in metadata._raw.
 */
function formatGraphQLOutput(data: Record<string, unknown> | null): string {
  if (data === null || data === undefined) {
    return "GraphQL response: (no data returned)";
  }

  const jsonStr = JSON.stringify(data, null, 2);

  if (jsonStr.length > MAX_OUTPUT_LENGTH) {
    return [
      "GraphQL response (truncated — full data available in metadata._raw):",
      jsonStr.slice(0, MAX_OUTPUT_LENGTH),
      `... (truncated, ${jsonStr.length - MAX_OUTPUT_LENGTH} more characters)`,
    ].join("\n");
  }

  return `GraphQL response:\n${jsonStr}`;
}

/**
 * Create the gitlab_query tool.
 *
 * @param getGQL  Async factory that returns the GitLab GraphQL client
 * @returns A registered tool object
 */
export function createQueryTool(
  getGQL: () => Promise<GraphQLClient>,
) {
  return tool({
    description: [
      "Execute an arbitrary GraphQL query against the GitLab API.",
      "Returns the response data as formatted JSON in output.",
      "Full raw response always available as _raw in metadata.",
      "Useful for debugging or accessing schema features not exposed",
      "by dedicated tools.",
    ].join(" "),
    args: {
      query: z
        .string()
        .min(1)
        .describe("The GraphQL query string to execute."),
      variables: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Optional variables for the query."),
    },
    async execute(
      args: { query: string; variables?: Record<string, unknown> },
      context: { abort?: AbortSignal },
    ) {
      // Respect the abort signal
      if (context.abort?.aborted) {
        return { output: "Request was aborted." };
      }

      let gql: GraphQLClient;
      try {
        gql = await getGQL();
      } catch (err) {
        return {
          output: err instanceof Error ? err.message : String(err),
        };
      }

      const result = await gql.request(
        args.query,
        args.variables,
        context.abort,
      );

      // Surface GraphQL schema errors as structured messages
      if (result.errors && result.errors.length > 0) {
        const messages = result.errors
          .map((e) => `- ${e.message}`)
          .join("\n");
        return {
          output: `GraphQL errors (${result.errors.length}):\n${messages}`,
          metadata: {
            _raw: result,
            errorCount: result.errors.length,
          },
        };
      }

      return {
        output: formatGraphQLOutput(result.data),
        metadata: {
          _raw: result.data,
        },
      };
    },
  });
}
