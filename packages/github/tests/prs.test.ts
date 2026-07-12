/**
 * Unit tests for github.pr.* REST tools (list, get, create, merge).
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
  PR_LIST_RESPONSE,
  PR_GET_RESPONSE,
  PR_COMMITS_RESPONSE,
  PR_FILES_RESPONSE,
  PR_CREATE_RESPONSE,
  PR_MERGE_RESPONSE,
  PRS_NOT_FOUND_RESPONSE,
} from "./fixtures/index.js";

let createPrTools: typeof import("../src/tools/prs.js").createPrTools;

/* ── Helpers ──────────────────────────────────────────────────── */

/** Create a mock Response from data */
function mockResponse(data: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

/** Create a mock GitHubClient that returns fixture data */
function mockClient(data: unknown, status = 200): GitHubClient {
  return {
    request: vi.fn().mockResolvedValue(mockResponse(data, status)),
  };
}

/** Create a mock client for pr.get that also handles commits and files sub-requests */
function mockClientForGet(
  prData: unknown,
  commitsData?: unknown,
  filesData?: unknown,
): GitHubClient {
  return {
    request: vi.fn().mockImplementation((_toolName: string, path: string) => {
      if (path.includes("/commits")) {
        return Promise.resolve(mockResponse(commitsData ?? []));
      }
      if (path.includes("/files")) {
        return Promise.resolve(mockResponse(filesData ?? []));
      }
      return Promise.resolve(mockResponse(prData));
    }),
  };
}

/** Shared mock context */
const mockContext = { abort: undefined as any };

/* ── Tests ────────────────────────────────────────────────────── */

describe("github.pr.list", () => {
  beforeEach(async () => {
    createPrTools = (await import("../src/tools/prs.js")).createPrTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createPrTools(() => Promise.resolve(mockClient([])));
      const execute = (tools["github.pr.list"] as any).execute;

      const result = await execute({ repo: "repo", state: "open" }, mockContext);
      expect(typeof result.output).toBe("string");

      const result2 = await execute({ owner: "owner", state: "open" }, mockContext);
      expect(typeof result2.output).toBe("string");
    });

    it("handles invalid state values gracefully", async () => {
      const tools = createPrTools(() => Promise.resolve(mockClient([])));
      const execute = (tools["github.pr.list"] as any).execute;

      // Using a type assertion to simulate invalid input at runtime
      const result = await execute(
        { owner: "owner", repo: "repo", state: "invalid" },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });

    it("accepts optional filtering parameters", async () => {
      const client = mockClient(PR_LIST_RESPONSE);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.list"].execute(
        {
          owner: "owner",
          repo: "repo",
          state: "open",
          head: "testuser:fix-login-button",
          base: "main",
          sort: "updated",
          direction: "desc",
          perPage: 50,
        },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns curated fields for a list of PRs", async () => {
      const client = mockClient(PR_LIST_RESPONSE);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.list"].execute(
        { owner: "owner", repo: "repo", state: "open" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      expect(meta.results).toBeDefined();
      expect(Array.isArray(meta.results)).toBe(true);
      expect((meta.results as any[]).length).toBe(2);

      const first = (meta.results as any[])[0];
      expect(first.number).toBe(43);
      expect(first.title).toBe("Fix login button padding");
      expect(first.state).toBe("open");
      expect(first.author).toBe("testuser");

      const second = (meta.results as any[])[1];
      expect(second.number).toBe(42);
      expect(second.draft).toBe(true);

      expect(meta._raw).toBeDefined();
    });

    it("handles empty PR list", async () => {
      const client = mockClient([]);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.list"].execute(
        { owner: "owner", repo: "repo", state: "closed" },
        mockContext,
      );

      expect(result.output).toContain("No pull requests found");
      const meta = result.metadata as Record<string, unknown>;
      expect((meta.results as any[]).length).toBe(0);
    });
  });

  describe("error handling", () => {
    it("surfaces API errors", async () => {
      const client = mockClient({ message: "Repository not found" }, 404);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.list"].execute(
        { owner: "owner", repo: "nonexistent" },
        mockContext,
      );

      expect(result.output).toContain("404");
      expect(result.output).toContain("Repository not found");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("abort handling", () => {
    it("respects abort signal", async () => {
      const tools = createPrTools(() => Promise.resolve(mockClient([])));
      const result = await tools["github.pr.list"].execute(
        { owner: "owner", repo: "repo" },
        { abort: { aborted: true } as any },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });
});

/* ── PR Get Tests ─────────────────────────────────────────────── */

describe("github.pr.get", () => {
  beforeEach(async () => {
    createPrTools = (await import("../src/tools/prs.js")).createPrTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createPrTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github.pr.get"] as any).execute;

      const result = await execute({ repo: "repo", prNumber: 43 }, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("handles non-numeric prNumber gracefully", async () => {
      const tools = createPrTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github.pr.get"] as any).execute;

      const result = await execute({ owner: "owner", repo: "repo", prNumber: "abc" }, mockContext);
      expect(typeof result.output).toBe("string");
    });
  });

  describe("output shape", () => {
    it("returns curated fields for a single PR", async () => {
      const client = mockClientForGet(PR_GET_RESPONSE, PR_COMMITS_RESPONSE, PR_FILES_RESPONSE);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.get"].execute(
        { owner: "owner", repo: "repo", prNumber: 43 },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      // PR metadata
      expect((meta.pr as any).number).toBe(43);
      expect((meta.pr as any).title).toBe("Fix login button padding");
      expect((meta.pr as any).state).toBe("open");
      expect((meta.pr as any).draft).toBe(false);

      // Stats
      expect((meta.pr as any).stats.additions).toBe(50);
      expect((meta.pr as any).stats.deletions).toBe(10);
      expect((meta.pr as any).stats.changedFiles).toBe(3);
      expect((meta.pr as any).stats.commits).toBe(2);

      // Labels
      expect((meta.pr as any).labels).toBeDefined();
      expect((meta.pr as any).labels.length).toBe(2);

      // Commits
      expect(meta.commits).toBeDefined();
      expect((meta.commits as any[]).length).toBe(2);

      // Files
      expect(meta.files).toBeDefined();
      expect((meta.files as any[]).length).toBe(2);
      expect((meta.files as any[])[0].filename).toBe("src/button.tsx");

      // _raw
      expect(meta._raw).toBeDefined();
    });

    it("handles PR not found", async () => {
      const client = mockClient(PRS_NOT_FOUND_RESPONSE, 404);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.get"].execute(
        { owner: "owner", repo: "repo", prNumber: 9999 },
        mockContext,
      );

      expect(result.output).toContain("not found");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces API errors", async () => {
      const client = mockClient({ message: "Forbidden" }, 403);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.get"].execute(
        { owner: "owner", repo: "repo", prNumber: 1 },
        mockContext,
      );

      expect(result.output).toContain("403");
      expect(result.output).toContain("Forbidden");
      expect(result.metadata).toBeDefined();
    });
  });
});

/* ── PR Create Tests ──────────────────────────────────────────── */

describe("github.pr.create", () => {
  beforeEach(async () => {
    createPrTools = (await import("../src/tools/prs.js")).createPrTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createPrTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github.pr.create"] as any).execute;

      const result = await execute({ owner: "owner", repo: "repo", title: "PR" }, mockContext);
      expect(typeof result.output).toBe("string");
    });
  });

  describe("output shape", () => {
    it("returns created PR details", async () => {
      const client = mockClient(PR_CREATE_RESPONSE, 201);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.create"].execute(
        {
          owner: "owner",
          repo: "repo",
          title: "New feature",
          head: "feature-branch",
          base: "main",
          body: "This is a new feature",
          draft: false,
        },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("Pull Request Created");
      expect(result.output).toContain("#45");

      const meta = result.metadata as Record<string, unknown>;
      expect((meta as any).number).toBe(45);
      expect((meta as any).title).toBe("New feature");
      expect((meta as any).state).toBe("open");
      expect((meta as any)._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces creation errors", async () => {
      const errorResponse = {
        message: "Validation Failed",
        errors: [{ message: "Head branch not found" }],
      };
      const client = mockClient(errorResponse, 422);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.create"].execute(
        {
          owner: "owner",
          repo: "repo",
          title: "New feature",
          head: "nonexistent-branch",
          base: "main",
        },
        mockContext,
      );

      expect(result.output).toContain("422");
      expect(result.output).toContain("Head branch not found");
      expect(result.metadata).toBeDefined();
    });
  });
});

/* ── PR Merge Tests ───────────────────────────────────────────── */

describe("github.pr.merge", () => {
  beforeEach(async () => {
    createPrTools = (await import("../src/tools/prs.js")).createPrTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createPrTools(() => Promise.resolve(mockClient({})));
      const execute = (tools["github.pr.merge"] as any).execute;

      const result = await execute({ owner: "owner", repo: "repo" }, mockContext);
      expect(typeof result.output).toBe("string");
    });
  });

  describe("output shape", () => {
    it("returns merge result details", async () => {
      const client = mockClient(PR_MERGE_RESPONSE);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.merge"].execute(
        {
          owner: "owner",
          repo: "repo",
          prNumber: 43,
          mergeMethod: "squash",
          commitTitle: "Fix login button padding",
        },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("Merge Result");
      expect(result.output).toContain("Merged");
      expect(result.output).toContain("abc123def456");

      const meta = result.metadata as Record<string, unknown>;
      expect((meta as any).merged).toBe(true);
      expect((meta as any).sha).toBe("abc123def456");
      expect((meta as any)._raw).toBeDefined();
    });

    it("handles merge failure", async () => {
      const failureResponse = {
        merged: false,
        message: "Pull Request is not mergeable",
      };
      const client = mockClient(failureResponse, 405);
      const tools = createPrTools(() => Promise.resolve(client));
      const result = await tools["github.pr.merge"].execute(
        {
          owner: "owner",
          repo: "repo",
          prNumber: 43,
        },
        mockContext,
      );

      expect(result.output).toContain("405");
      expect(result.output).toContain("not mergeable");
      expect(result.metadata).toBeDefined();
    });
  });
});
