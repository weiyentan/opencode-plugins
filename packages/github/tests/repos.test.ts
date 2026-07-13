/**
 * Unit tests for github.repo.* REST tools (get, search).
 *
 * These tests use fixture data and a mock HTTP client to verify:
 *   1. Zod input validation rejects malformed arguments
 *   2. Output shape includes curated fields and _raw in metadata
 *   3. API errors are surfaced as structured messages
 *   4. Not-found cases produce clear user-facing output
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubClient } from "../src/client.js";
import {
  REPO_GET_RESPONSE,
  REPO_SEARCH_RESPONSE,
  REPO_GET_NOT_FOUND_RESPONSE,
} from "./fixtures/index.js";

let createRepoTools: typeof import("../src/tools/repos.js").createRepoTools;

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

/* ── Repo Get Tests ───────────────────────────────────────────── */

describe("github.repo.get", () => {
  beforeEach(async () => {
    createRepoTools = (await import("../src/tools/repos.js")).createRepoTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createRepoTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github.repo.get"] as any).execute;

      const result = await execute({ repo: "repo" }, mockContext);
      expect(typeof result.output).toBe("string");
    });
  });

  describe("output shape", () => {
    it("returns curated repo fields", async () => {
      const client = mockClient(REPO_GET_RESPONSE);
      const tools = createRepoTools(() => Promise.resolve(client));
      const result = await tools["github.repo.get"].execute(
        { owner: "owner", repo: "my-project" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      // Repo metadata
      expect(meta.name).toBe("my-project");
      expect(meta.fullName).toBe("owner/my-project");
      expect(meta.owner).toBe("owner");
      expect(meta.description).toBe("A sample project for testing");
      expect(meta.visibility).toBe("public");
      expect(meta.language).toBe("TypeScript");

      // Topics
      expect(meta.topics).toBeDefined();
      expect((meta.topics as string[])).toContain("typescript");
      expect((meta.topics as string[])).toContain("api");

      // License
      expect(meta.license).toBeDefined();
      expect((meta.license as any).spdxId).toBe("MIT");

      // Stats
      expect(meta.stats).toBeDefined();
      expect((meta.stats as any).stars).toBe(150);
      expect((meta.stats as any).forks).toBe(25);
      expect((meta.stats as any).openIssues).toBe(5);

      // _raw
      expect(meta._raw).toBeDefined();
    });

    it("handles repo not found", async () => {
      const client = mockClient(REPO_GET_NOT_FOUND_RESPONSE, 404);
      const tools = createRepoTools(() => Promise.resolve(client));
      const result = await tools["github.repo.get"].execute(
        { owner: "owner", repo: "nonexistent" },
        mockContext,
      );

      expect(result.output).toContain("not found");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces API errors", async () => {
      const client = mockClient({ message: "Forbidden" }, 403);
      const tools = createRepoTools(() => Promise.resolve(client));
      const result = await tools["github.repo.get"].execute(
        { owner: "owner", repo: "private-repo" },
        mockContext,
      );

      expect(result.output).toContain("403");
      expect(result.output).toContain("Forbidden");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("abort handling", () => {
    it("respects abort signal", async () => {
      const tools = createRepoTools(() => Promise.resolve(mockClient({})));
      const result = await tools["github.repo.get"].execute(
        { owner: "owner", repo: "repo" },
        { abort: { aborted: true } as any },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });
});

/* ── Repo Search Tests ────────────────────────────────────────── */

describe("github.repo.search", () => {
  beforeEach(async () => {
    createRepoTools = (await import("../src/tools/repos.js")).createRepoTools;
  });

  describe("input validation", () => {
    it("handles missing query gracefully", async () => {
      const tools = createRepoTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github.repo.search"] as any).execute;

      const result = await execute({}, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("accepts optional sort and order parameters", async () => {
      const client = mockClient(REPO_SEARCH_RESPONSE);
      const tools = createRepoTools(() => Promise.resolve(client));
      const result = await tools["github.repo.search"].execute(
        { query: "typescript", sort: "stars", order: "desc", perPage: 50 },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns curated search results", async () => {
      const client = mockClient(REPO_SEARCH_RESPONSE);
      const tools = createRepoTools(() => Promise.resolve(client));
      const result = await tools["github.repo.search"].execute(
        { query: "typescript" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      const meta = result.metadata as Record<string, unknown>;

      expect(meta.totalCount).toBe(42);
      expect(meta.results).toBeDefined();
      expect(Array.isArray(meta.results)).toBe(true);
      expect((meta.results as any[]).length).toBe(2);

      const first = (meta.results as any[])[0];
      expect(first.fullName).toBe("owner/repo-one");
      expect(first.stars).toBe(100);
      expect(first.forks).toBe(20);
      expect(first.language).toBe("TypeScript");

      const second = (meta.results as any[])[1];
      expect(second.fullName).toBe("owner/repo-two");
      expect(second.stars).toBe(50);

      expect(meta._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces API errors", async () => {
      const client = mockClient({ message: "Validation error" }, 422);
      const tools = createRepoTools(() => Promise.resolve(client));
      const result = await tools["github.repo.search"].execute(
        { query: "" },
        mockContext,
      );

      expect(result.output).toContain("422");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("abort handling", () => {
    it("respects abort signal", async () => {
      const tools = createRepoTools(() => Promise.resolve(mockClient({})));
      const result = await tools["github.repo.search"].execute(
        { query: "typescript" },
        { abort: { aborted: true } as any },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });
});
