/**
 * query.ts — Generic GraphQL query passthrough tool.
 *
 * github_query: Executes an arbitrary GraphQL query against the GitHub API
 * with auth injection and returns the full raw response.
 *
 * ## Tool
 *
 * - **github_query** &mdash; Takes `query` (string) and optional `variables`
 *   (record), returns `_raw` with the full GraphQL response data. When the
 *   query returns schema errors, they are formatted as structured messages
 *   (with type annotations) in the output string and `_raw` in metadata.
 *
 * ## Design
 *
 * This is the escape hatch — for queries that don't have a dedicated tool
 * (e.g., custom GraphQL queries), users can execute arbitrary GraphQL
 * through this tool. All other rich tools use GraphQL internally and
 * expose curated fields; this tool exposes the raw response.
 */

import { tool } from "@opencode-ai/plugin";
import type { GitHubGraphQLClient } from "../graphql.js";

const z = tool.schema;

/**
 * Create the github_query tool.
 *
 * @param getGQL  Async factory that returns the GitHub GraphQL client
 * @returns A registered tool object
 */
export function createQueryTool(
  getGQL: () => Promise<GitHubGraphQLClient>,
) {
  return tool({
    description: [
      "Execute an arbitrary GraphQL query against the GitHub API.",
      "Returns the full raw response as _raw in metadata.",
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

      let gql: GitHubGraphQLClient;
      try {
        gql = await getGQL();
      } catch (err) {
        return {
          output: err instanceof Error ? err.message : String(err),
        };
      }

      const result = await gql.request(args.query, args.variables);

      // Surface GraphQL schema errors as structured messages
      if (result.errors && result.errors.length > 0) {
        const messages = result.errors
          .map(
            (e) =>
              `- ${e.type ? `[${e.type}] ` : ""}${e.message}`,
          )
          .join("\n");
        return {
          output: `GraphQL errors (${result.errors.length}):\n${messages}`,
          metadata: {
            _raw: result,
            errorCount: result.errors.length,
          },
        };
      }

      // Format response data as truncated JSON for agent-visible output
      const dataJson = JSON.stringify(result.data, null, 2);
      const MAX_OUTPUT_LEN = 2000;
      const truncated =
        dataJson.length > MAX_OUTPUT_LEN
          ? dataJson.slice(0, MAX_OUTPUT_LEN) + "\n... (truncated)"
          : dataJson;

      return {
        output: `Query executed successfully.\n\nData:\n${truncated}`,
        metadata: {
          _raw: result.data,
          rateLimit: result.rateLimit,
        },
      };
    },
  });
}
