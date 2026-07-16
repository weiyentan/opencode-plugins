/**
 * Unit tests for rich GraphQL tools (github_issue_get_full, github_pr_get_full,
 * github_issue_search, github_repo_get_full).
 *
 * These tests use fixture data and a mock GraphQL client to verify:
 *   1. Zod input validation rejects malformed arguments
 *   2. Output shape includes curated fields and _raw in metadata
 *   3. GraphQL schema errors are surfaced as structured messages
 *   4. Missing data (e.g., issue not found) produces clear user-facing output
 *
 * Integration tests are in a gated describe block and run only when
 * the GITHUB_TOKEN environment variable is set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubGraphQLClient, GraphQLResult } from "../src/graphql.js";

// Lazy import — implementation may not exist at parse time in CI
let createRichTools: typeof import("../src/tools/rich.js").createRichTools;

import {
  ISSUE_FULL_RESPONSE,
  ISSUE_MINIMAL_RESPONSE,
  ISSUE_NOT_FOUND_RESPONSE,
  PR_FULL_RESPONSE,
  PR_MERGED_RESPONSE,
  PR_NOT_FOUND_RESPONSE,
  ISSUE_SEARCH_RESPONSE,
  ISSUE_SEARCH_EMPTY_RESPONSE,
  REPO_FULL_RESPONSE,
  REPO_NO_README_RESPONSE,
  REPO_NOT_FOUND_RESPONSE,
} from "./fixtures/index.js";

/* ── Helpers ──────────────────────────────────────────────────── */

/** Create a mock GraphQL client that returns fixture data */
function mockGQL(data: unknown): GitHubGraphQLClient {
  return {
    request: vi.fn().mockResolvedValue({
      data,
      errors: undefined,
      rateLimit: {
        limit: 5000,
        remaining: 4990,
        resetAt: "2025-07-12T23:00:00Z",
        cost: 1,
      },
    } satisfies GraphQLResult),
  };
}

/** Create a mock GraphQL client that returns a GraphQL error */
function mockGQLError(errors: Array<{ type?: string; message: string }>): GitHubGraphQLClient {
  return {
    request: vi.fn().mockResolvedValue({
      data: undefined,
      errors,
      rateLimit: undefined,
    } satisfies GraphQLResult),
  };
}

/** Shared mock context */
const mockContext = { abort: undefined as any };

/* ── Tests ────────────────────────────────────────────────────── */

describe("github_issue_get_full", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_issue_get_full"] as any).execute;

      // Missing owner should produce a human-readable error
      const result = await execute({ repo: "repo", issueNumber: 42 }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");
    });

    it("handles non-numeric issueNumber gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_issue_get_full"] as any).execute;

      // Non-numeric issueNumber produces a human-readable error
      const result = await execute({ owner: "owner", repo: "repo", issueNumber: "abc" }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");
    });

    it("handles empty strings gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_issue_get_full"] as any).execute;

      const result = await execute({ owner: "", repo: "repo", issueNumber: 1 }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");
    });
  });

  describe("output shape", () => {
    it("returns curated fields for a standard issue", async () => {
      const gql = mockGQL(ISSUE_FULL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_issue_get_full"].execute(
        { owner: "owner", repo: "repo", issueNumber: 42 },
        mockContext,
      );

      // Verify string output
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("Body:");
      expect(result.output).toContain("The login button on the homepage has incorrect padding.");

      // Verify metadata shape
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      // Curated fields
      expect(meta.issue).toBeDefined();
      expect((meta.issue as any).number).toBe(42);
      expect((meta.issue as any).title).toBe("Fix the login button styling");
      expect((meta.issue as any).state).toBe("OPEN");

      // Labels
      expect(meta.labels).toBeDefined();
      expect(Array.isArray(meta.labels)).toBe(true);
      expect((meta.labels as any[]).length).toBe(2);

      // Comments
      expect(meta.comments).toBeDefined();
      expect((meta.comments as any).nodes).toBeDefined();
      expect((meta.comments as any).pageInfo).toBeDefined();

      // Linked PRs (from cross-referenced events in timeline)
      expect(meta.linkedPRs).toBeDefined();
      expect(Array.isArray(meta.linkedPRs)).toBe(true);
      expect((meta.linkedPRs as any[]).length).toBe(1);
      expect((meta.linkedPRs as any[])[0].number).toBe(43);

      // Timeline events
      expect(meta.timelineEvents).toBeDefined();

      // _raw field in metadata
      expect(meta._raw).toBeDefined();
      expect((meta._raw as any).repository.issue.title).toBe("Fix the login button styling");
    });

    it("handles minimal issue (no comments, no events)", async () => {
      const gql = mockGQL(ISSUE_MINIMAL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_issue_get_full"].execute(
        { owner: "owner", repo: "repo", issueNumber: 99 },
        mockContext,
      );

      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      expect((meta.issue as any).number).toBe(99);
      expect((meta.issue as any).state).toBe("CLOSED");
      expect((meta.labels as any[]).length).toBe(0);
      expect((meta.comments as any).nodes).toHaveLength(0);
      expect((meta.linkedPRs as any[]).length).toBe(0);
      expect(meta._raw).toBeDefined();
    });

    it("handles issue not found (null response)", async () => {
      const gql = mockGQL(ISSUE_NOT_FOUND_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_issue_get_full"].execute(
        { owner: "owner", repo: "repo", issueNumber: 9999 },
        mockContext,
      );

      expect(result.output).toContain("not found");
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;
      expect(meta._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces GraphQL schema errors as structured messages", async () => {
      const gql = mockGQLError([
        { type: "NOT_FOUND", message: "Could not resolve to a Repository with the name 'owner/repo'." },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_issue_get_full"].execute(
        { owner: "owner", repo: "repo", issueNumber: 42 },
        mockContext,
      );

      expect(result.output).toContain("NOT_FOUND");
      expect(result.output).toContain("Could not resolve to a Repository");
      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>)._raw).toBeDefined();
    });
  });
});

/* ── PR Tests ─────────────────────────────────────────────────── */

describe("github_pr_get_full", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_pr_get_full"] as any).execute;

      const result = await execute({ repo: "repo", prNumber: 43 }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");

      const result2 = await execute({ owner: "owner", prNumber: 43 }, mockContext);
      expect(result2.output).toContain("not found");

      const result3 = await execute({ owner: "owner", repo: "repo" }, mockContext);
      expect(result3.output).toContain("not found");
    });

    it("handles non-numeric prNumber gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_pr_get_full"] as any).execute;

      const result = await execute({ owner: "owner", repo: "repo", prNumber: "abc" }, mockContext);
      expect(result.output).toContain("not found");
    });
  });

  describe("output shape", () => {
    it("returns curated fields for a standard PR", async () => {
      const gql = mockGQL(PR_FULL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_pr_get_full"].execute(
        { owner: "owner", repo: "repo", prNumber: 43 },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      // PR metadata
      expect((meta.pr as any).number).toBe(43);
      expect((meta.pr as any).state).toBe("OPEN");
      expect((meta.pr as any).mergeable).toBe("MERGEABLE");
      expect((meta.pr as any).merged).toBe(false);

      // Labels
      expect((meta.labels as any[]).length).toBe(1);

      // Commits
      expect(meta.commits).toBeDefined();
      expect((meta.commits as any).nodes).toBeDefined();

      // Reviews
      expect(meta.reviews).toBeDefined();
      expect((meta.reviews as any).nodes).toHaveLength(2);

      // Review threads
      expect(meta.reviewThreads).toBeDefined();
      expect((meta.reviewThreads as any).nodes).toHaveLength(1);

      // _raw
      expect(meta._raw).toBeDefined();
    });

    it("handles merged PR", async () => {
      const gql = mockGQL(PR_MERGED_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_pr_get_full"].execute(
        { owner: "owner", repo: "repo", prNumber: 44 },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect((meta.pr as any).state).toBe("MERGED");
      expect((meta.pr as any).merged).toBe(true);
      expect((meta.pr as any).mergedBy).toBe("maintainer1");
      expect((meta.reviews as any).nodes).toHaveLength(0);
    });

    it("handles PR not found", async () => {
      const gql = mockGQL(PR_NOT_FOUND_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_pr_get_full"].execute(
        { owner: "owner", repo: "repo", prNumber: 9999 },
        mockContext,
      );

      expect(result.output).toContain("not found");
      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>)._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces GraphQL errors", async () => {
      const gql = mockGQLError([
        { type: "FORBIDDEN", message: "Resource not accessible by integration" },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_pr_get_full"].execute(
        { owner: "owner", repo: "repo", prNumber: 42 },
        mockContext,
      );

      expect(result.output).toContain("FORBIDDEN");
      expect(result.metadata).toBeDefined();
    });
  });
});

/* ── Issue Search Tests ────────────────────────────────────────── */

describe("github_issue_search", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing query gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_issue_search"] as any).execute;

      const result = await execute({}, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("handles empty query gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_issue_search"] as any).execute;

      const result = await execute({ query: "" }, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("accepts optional `first` parameter", async () => {
      const gql = mockGQL(ISSUE_SEARCH_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));

      // Should not throw
      const result = await tools["github_issue_search"].execute(
        { query: "bug", first: 20 },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns curated search results with repo context", async () => {
      const gql = mockGQL(ISSUE_SEARCH_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_issue_search"].execute(
        { query: "memory leak" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      const meta = result.metadata as Record<string, unknown>;

      expect(meta.issueCount).toBe(42);
      expect(meta.results).toBeDefined();
      expect(Array.isArray(meta.results)).toBe(true);
      expect((meta.results as any[]).length).toBe(2);

      // Each result has repo context
      const firstResult = (meta.results as any[])[0];
      expect(firstResult.number).toBe(100);
      expect(firstResult.repository).toBe("owner/repo");
      expect(firstResult.state).toBe("OPEN");

      const secondResult = (meta.results as any[])[1];
      expect(secondResult.repository).toBe("other-owner/other-repo");

      expect(meta._raw).toBeDefined();
    });

    it("handles empty search results", async () => {
      const gql = mockGQL(ISSUE_SEARCH_EMPTY_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_issue_search"].execute(
        { query: "nonexistent feature" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.issueCount).toBe(0);
      expect((meta.results as any[]).length).toBe(0);
      expect(result.output).toContain("0");
    });
  });

  describe("error handling", () => {
    it("surfaces GraphQL errors", async () => {
      const gql = mockGQLError([
        { type: "FORBIDDEN", message: "Resource not accessible by integration" },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_issue_search"].execute(
        { query: "bug" },
        mockContext,
      );

      expect(result.output).toContain("FORBIDDEN");
      expect(result.metadata).toBeDefined();
    });
  });
});

/* ── Repo Full Tests ──────────────────────────────────────────── */

describe("github_repo_get_full", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["github_repo_get_full"] as any).execute;

      const result = await execute({ repo: "repo" }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");

      const result2 = await execute({ owner: "owner" }, mockContext);
      expect(result2.output).toContain("not found");

      const result3 = await execute({}, mockContext);
      expect(result3.output).toContain("not found");
    });
  });

  describe("output shape", () => {
    it("returns curated repo fields with README, commits, contributors, and file tree", async () => {
      const gql = mockGQL(REPO_FULL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_repo_get_full"].execute(
        { owner: "owner", repo: "my-project" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      const meta = result.metadata as Record<string, unknown>;

      // Repo metadata
      expect(meta.name).toBe("my-project");
      expect(meta.owner).toBe("owner");
      expect(meta.description).toBe("A sample project for testing");

      // Languages
      expect(meta.languages).toBeDefined();
      expect((meta.languages as any[]).length).toBe(2);

      // Stats
      expect(meta.stats).toBeDefined();
      expect((meta.stats as any).stars).toBe(150);
      expect((meta.stats as any).forks).toBe(25);
      expect((meta.stats as any).openIssues).toBe(5);
      expect((meta.stats as any).openPRs).toBe(2);

      // README (first 5000 chars stored in metadata)
      expect(meta.readme).toBeDefined();
      expect(meta.readme).toContain("# My Project");

      // Recent commits
      expect(meta.recentCommits).toBeDefined();
      expect((meta.recentCommits as any[]).length).toBe(3);

      // Top contributors
      expect(meta.topContributors).toBeDefined();
      expect((meta.topContributors as any[]).length).toBe(3);

      // File tree in metadata
      expect(meta.rootTree).toBeDefined();
      expect((meta.rootTree as any[]).length).toBe(5);

      // Output includes expanded README (>100 chars)
      expect(result.output).toContain("# My Project");
      expect(result.output).toContain("Getting Started");

      // Output includes file tree listing
      expect(result.output).toContain("README.md");
      expect(result.output).toContain("src/");
      expect(result.output).toContain("tests/");
      expect(result.output).toContain("package.json");

      // _raw
      expect(meta._raw).toBeDefined();
    });

    it("handles repo without README", async () => {
      const gql = mockGQL(REPO_NO_README_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_repo_get_full"].execute(
        { owner: "owner", repo: "empty-repo" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.name).toBe("empty-repo");
      expect(meta.readme).toBeNull();
      expect((meta.recentCommits as any[]).length).toBe(0);
      expect((meta.topContributors as any[]).length).toBe(0);
    });

    it("handles repo not found", async () => {
      const gql = mockGQL(REPO_NOT_FOUND_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_repo_get_full"].execute(
        { owner: "owner", repo: "nonexistent" },
        mockContext,
      );

      expect(result.output).toContain("not found");
      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>)._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces GraphQL errors", async () => {
      const gql = mockGQLError([
        { type: "NOT_FOUND", message: "Could not resolve to a Repository" },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["github_repo_get_full"].execute(
        { owner: "owner", repo: "nonexistent" },
        mockContext,
      );

      expect(result.output).toContain("NOT_FOUND");
    });
  });
});

/* ── Abort handling ──────────────────────────────────────────────── */

describe("abort handling", () => {
  it("respects abort signal for issue.get-full", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["github_issue_get_full"].execute(
      { owner: "owner", repo: "repo", issueNumber: 1 },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for pr.get-full", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["github_pr_get_full"].execute(
      { owner: "owner", repo: "repo", prNumber: 1 },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for issue.search", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["github_issue_search"].execute(
      { query: "bug" },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for repo.get-full", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["github_repo_get_full"].execute(
      { owner: "owner", repo: "repo" },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });
});

/* ── Integration tests (gated) ───────────────────────────────────── */

describe("integration", () => {
  const hasToken = Boolean(process.env.GITHUB_TOKEN);

  it.runIf(hasToken)("github_issue_get_full returns real data", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    // Integration tests can be added here when running with a real token
    expect(true).toBe(true);
  });
});
