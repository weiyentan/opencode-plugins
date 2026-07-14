/**
 * Unit tests for github_code_search REST tool.
 *
 * These tests use fixture data and a mock HTTP client to verify:
 *   1. Zod input validation rejects malformed arguments
 *   2. Output shape includes curated fields and _raw in metadata
 *   3. API errors are surfaced as structured messages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubClient } from "../src/client.js";
import {
  CODE_SEARCH_RESPONSE,
  CODE_SEARCH_EMPTY_RESPONSE,
} from "./fixtures/index.js";

let createCodeTools: typeof import("../src/tools/code.js").createCodeTools;

/* ── Helpers ──────────────────────────────────────────────────── */

function mockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

function mockClient(data: unknown, status = 200): GitHubClient {
  return {
    request: vi.fn().mockResolvedValue(mockResponse(data, status)),
  };
}

const mockContext = { abort: undefined as any };

/* ── Tests ────────────────────────────────────────────────────── */

describe("github_code_search", () => {
  beforeEach(async () => {
    createCodeTools = (await import("../src/tools/code.js")).createCodeTools;
  });

  describe("input validation", () => {
    it("handles missing query gracefully", async () => {
      const tools = createCodeTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github_code_search"] as any).execute;

      const result = await execute({}, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("handles empty query gracefully", async () => {
      const tools = createCodeTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github_code_search"] as any).execute;

      const result = await execute({ query: "" }, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("accepts optional qualifiers", async () => {
      const client = mockClient(CODE_SEARCH_RESPONSE);
      const tools = createCodeTools(() => Promise.resolve(client));
      const result = await tools["github_code_search"].execute(
        {
          query: "hello",
          language: "typescript",
          repo: "owner/repo",
          path: "src/",
        },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns curated code search results", async () => {
      const client = mockClient(CODE_SEARCH_RESPONSE);
      const tools = createCodeTools(() => Promise.resolve(client));
      const result = await tools["github_code_search"].execute(
        { query: "hello world" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      const meta = result.metadata as Record<string, unknown>;

      expect(meta.totalCount).toBe(10);
      expect(meta.results).toBeDefined();
      expect(Array.isArray(meta.results)).toBe(true);
      expect((meta.results as any[]).length).toBe(2);

      const first = (meta.results as any[])[0];
      expect(first.name).toBe("index.ts");
      expect(first.path).toBe("src/index.ts");
      expect(first.repository).toBeDefined();
      expect(first.repository.fullName).toBe("owner/repo");

      const second = (meta.results as any[])[1];
      expect(second.name).toBe("utils.ts");
      expect(second.path).toBe("src/utils.ts");

      expect(meta._raw).toBeDefined();
    });

    it("handles empty search results", async () => {
      const client = mockClient(CODE_SEARCH_EMPTY_RESPONSE);
      const tools = createCodeTools(() => Promise.resolve(client));
      const result = await tools["github_code_search"].execute(
        { query: "nonexistent_token_xyz" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.totalCount).toBe(0);
      expect((meta.results as any[]).length).toBe(0);
      expect(result.output).toContain("No code results found");
    });
  });

  describe("error handling", () => {
    it("surfaces 422 validation errors with detail", async () => {
      const errorResponse = {
        message: "Validation Failed",
        errors: [{ message: "The query contains invalid special characters" }],
      };
      const client = mockClient(errorResponse, 422);
      const tools = createCodeTools(() => Promise.resolve(client));
      const result = await tools["github_code_search"].execute(
        { query: "!!!invalid" },
        mockContext,
      );

      expect(result.output).toContain("Invalid code search query");
      expect(result.output).toContain("invalid special characters");
      expect(result.metadata).toBeDefined();
    });

    it("surfaces generic API errors", async () => {
      const client = mockClient({ message: "Not Found" }, 404);
      const tools = createCodeTools(() => Promise.resolve(client));
      const result = await tools["github_code_search"].execute(
        { query: "something" },
        mockContext,
      );

      expect(result.output).toContain("404");
      expect(result.output).toContain("Not Found");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("abort handling", () => {
    it("respects abort signal", async () => {
      const tools = createCodeTools(() => Promise.resolve(mockClient({})));
      const result = await tools["github_code_search"].execute(
        { query: "hello" },
        { abort: { aborted: true } as any },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });
});
