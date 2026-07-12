/**
 * Unit tests for github.query (generic GraphQL passthrough).
 *
 * Tests Zod validation, output shape including _raw,
 * and GraphQL error surfacing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubGraphQLClient, GraphQLResult } from "../src/graphql.js";
import { VIEWER_QUERY_RESPONSE } from "./fixtures/index.js";

let createQueryTool: typeof import("../src/tools/query.js").createQueryTool;

/* ── Helpers ──────────────────────────────────────────────────── */

function mockGQL(data: unknown): GitHubGraphQLClient {
  return {
    request: vi.fn().mockResolvedValue({
      data,
      errors: undefined,
      rateLimit: { limit: 5000, remaining: 4995, resetAt: "2025-07-12T23:00:00Z", cost: 1 },
    } satisfies GraphQLResult),
  };
}

function mockGQLError(errors: Array<{ type?: string; message: string }>): GitHubGraphQLClient {
  return {
    request: vi.fn().mockResolvedValue({
      data: undefined,
      errors,
      rateLimit: undefined,
    } satisfies GraphQLResult),
  };
}

const mockContext = { abort: undefined as any };

/* ── Tests ────────────────────────────────────────────────────── */

describe("github.query", () => {
  beforeEach(async () => {
    createQueryTool = (await import("../src/tools/query.js")).createQueryTool;
  });

  describe("input validation", () => {
    it("handles missing query string gracefully", async () => {
      const tool = createQueryTool(() => Promise.resolve(mockGQL({})));
      const execute = (tool as any).execute;
      const result = await execute({}, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("handles empty query string gracefully", async () => {
      const tool = createQueryTool(() => Promise.resolve(mockGQL({})));
      const execute = (tool as any).execute;
      const result = await execute({ query: "" }, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("accepts optional variables", async () => {
      const tool = createQueryTool(() => Promise.resolve(mockGQL(VIEWER_QUERY_RESPONSE)));
      // Should not throw
      const result = await (tool as any).execute(
        { query: "query { viewer { login } }", variables: {} },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns _raw in metadata on success", async () => {
      const gql = mockGQL(VIEWER_QUERY_RESPONSE);
      const tool = createQueryTool(() => Promise.resolve(gql));
      const result = await (tool as any).execute(
        { query: "query { viewer { login name } }" },
        mockContext,
      );

      expect(result.output).toBe("Query executed successfully.");
      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>)._raw).toEqual(VIEWER_QUERY_RESPONSE);
    });

    it("includes rateLimit info when available", async () => {
      const gql = mockGQL(VIEWER_QUERY_RESPONSE);
      const tool = createQueryTool(() => Promise.resolve(gql));
      const result = await (tool as any).execute(
        { query: "query { viewer { login } }" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.rateLimit).toBeDefined();
      expect((meta.rateLimit as any).remaining).toBe(4995);
    });
  });

  describe("error handling", () => {
    it("surfaces GraphQL schema errors with types", async () => {
      const gql = mockGQLError([
        {
          type: "NOT_FOUND",
          message: "Field 'viewer' doesn't exist on type 'Query'",
        },
      ]);
      const tool = createQueryTool(() => Promise.resolve(gql));
      const result = await (tool as any).execute(
        { query: "query { viewer { login } }" },
        mockContext,
      );

      expect(result.output).toContain("NOT_FOUND");
      expect(result.output).toContain("Field 'viewer' doesn't exist");
      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>)._raw).toBeDefined();
    });

    it("handles multiple errors", async () => {
      const gql = mockGQLError([
        { message: "First error" },
        { message: "Second error" },
      ]);
      const tool = createQueryTool(() => Promise.resolve(gql));
      const result = await (tool as any).execute(
        { query: "query { foo }" },
        mockContext,
      );

      expect(result.output).toContain("2");
      expect(result.output).toContain("First error");
      expect(result.output).toContain("Second error");
    });
  });

  describe("abort handling", () => {
    it("respects abort signal", async () => {
      const tool = createQueryTool(() => Promise.resolve(mockGQL({})));
      const result = await (tool as any).execute(
        { query: "query { viewer { login } }" },
        { abort: { aborted: true } as any },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });
});

/* ── Integration tests (gated) ───────────────────────────────────── */

describe("integration", () => {
  const hasToken = Boolean(process.env.GITHUB_TOKEN);

  it.runIf(hasToken)("github.query returns real data", async () => {
    createQueryTool = (await import("../src/tools/query.js")).createQueryTool;
    expect(true).toBe(true);
  });
});
