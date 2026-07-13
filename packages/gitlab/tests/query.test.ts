/**
 * Unit tests for gitlab.query (generic GraphQL passthrough).
 *
 * Tests Zod validation, output shape including _raw,
 * and GraphQL error surfacing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GraphQLClient, GraphQLResult } from "../src/graphql.js";
import { VIEWER_QUERY_RESPONSE } from "./fixtures/index.js";

let createQueryTool: typeof import("../src/tools/query.js").createQueryTool;

/* ── Helpers ──────────────────────────────────────────────────── */

function mockGQL(data: unknown): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue({
      data,
      errors: null,
      status: 200,
      ok: true,
    } satisfies GraphQLResult),
  };
}

function mockGQLError(errors: Array<{ message: string }>): GraphQLClient {
  return {
    request: vi.fn().mockResolvedValue({
      data: null,
      errors,
      status: 200,
      ok: false,
    } satisfies GraphQLResult),
  };
}

const mockContext = { abort: undefined as any };

/* ── Tests ────────────────────────────────────────────────────── */

describe("gitlab.query", () => {
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
        { query: "query { currentUser { username } }", variables: {} },
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
        { query: "query { currentUser { username name } }" },
        mockContext,
      );

      expect(result.output).toBe("Query executed successfully.");
      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>)._raw).toEqual(VIEWER_QUERY_RESPONSE);
    });
  });

  describe("error handling", () => {
    it("surfaces GraphQL schema errors with messages", async () => {
      const gql = mockGQLError([
        {
          message: "Field 'currentUser' doesn't exist on type 'Query'",
        },
      ]);
      const tool = createQueryTool(() => Promise.resolve(gql));
      const result = await (tool as any).execute(
        { query: "query { currentUser { username } }" },
        mockContext,
      );

      expect(result.output).toContain("Field 'currentUser' doesn't exist");
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
        { query: "query { currentUser { username } }" },
        { abort: { aborted: true } as any },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });
});
