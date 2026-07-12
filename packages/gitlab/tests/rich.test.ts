/**
 * Unit tests for rich GraphQL tools (gitlab.issue.get-full, gitlab.mr.get-full,
 * gitlab.issue.search, gitlab.project.get-full).
 *
 * These tests use fixture data and a mock GraphQL client to verify:
 *   1. Zod input validation rejects malformed arguments
 *   2. Output shape includes curated fields and _raw in metadata
 *   3. GraphQL schema errors are surfaced as structured messages
 *   4. Missing data (e.g., issue not found) produces clear user-facing output
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GraphQLClient, GraphQLResult } from "../src/graphql.js";

// Lazy import — implementation may not exist at parse time in CI
let createRichTools: typeof import("../src/tools/rich.js").createRichTools;

import {
  ISSUE_FULL_RESPONSE,
  ISSUE_MINIMAL_RESPONSE,
  ISSUE_NOT_FOUND_RESPONSE,
  MR_FULL_RESPONSE,
  MR_MERGED_RESPONSE,
  MR_NOT_FOUND_RESPONSE,
  ISSUE_SEARCH_RESPONSE,
  ISSUE_SEARCH_EMPTY_RESPONSE,
  ISSUE_SEARCH_NO_ISSUES_RESPONSE,
  PROJECT_FULL_RESPONSE,
  PROJECT_NO_README_RESPONSE,
  PROJECT_NOT_FOUND_RESPONSE,
} from "./fixtures/index.js";

/* ── Helpers ──────────────────────────────────────────────────── */

/** Create a mock GraphQL client that returns fixture data */
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

/** Create a mock GraphQL client that returns a GraphQL error */
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

/** Shared mock context */
const mockContext = { abort: undefined as any };

/* ── Tests ────────────────────────────────────────────────────── */

describe("gitlab.issue.get-full", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["gitlab.issue.get-full"] as any).execute;

      // Missing projectPath should produce a human-readable error
      const result = await execute({ iid: "42" }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");
    });

    it("handles missing iid gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["gitlab.issue.get-full"] as any).execute;

      const result = await execute({ projectPath: "group/project" }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");
    });

    it("handles empty strings gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["gitlab.issue.get-full"] as any).execute;

      const result = await execute({ projectPath: "", iid: "1" }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");
    });
  });

  describe("output shape", () => {
    it("returns curated fields for a standard issue", async () => {
      const gql = mockGQL(ISSUE_FULL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.get-full"].execute(
        { projectPath: "group/project", iid: "42" },
        mockContext,
      );

      // Verify string output
      expect(typeof result.output).toBe("string");

      // Verify metadata shape
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      // Curated fields
      expect(meta.issue).toBeDefined();
      expect((meta.issue as any).iid).toBe("42");
      expect((meta.issue as any).title).toBe("Fix the login button styling");
      expect((meta.issue as any).state).toBe("opened");

      // Labels
      expect(meta.labels).toBeDefined();
      expect(Array.isArray(meta.labels)).toBe(true);
      expect((meta.labels as any[]).length).toBe(2);

      // Notes
      expect(meta.notes).toBeDefined();
      expect((meta.notes as any).nodes).toBeDefined();
      expect((meta.notes as any).pageInfo).toBeDefined();

      // Linked MRs
      expect(meta.linkedMRs).toBeDefined();
      expect(Array.isArray(meta.linkedMRs)).toBe(true);
      expect((meta.linkedMRs as any[]).length).toBe(1);
      expect((meta.linkedMRs as any[])[0].iid).toBe("7");

      // _raw field in metadata
      expect(meta._raw).toBeDefined();
      expect((meta._raw as any).project.issue.title).toBe("Fix the login button styling");
    });

    it("handles minimal issue (no notes, no linked MRs)", async () => {
      const gql = mockGQL(ISSUE_MINIMAL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.get-full"].execute(
        { projectPath: "group/project", iid: "99" },
        mockContext,
      );

      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      expect((meta.issue as any).iid).toBe("99");
      expect((meta.issue as any).state).toBe("closed");
      expect((meta.labels as any[]).length).toBe(0);
      expect((meta.notes as any).nodes).toHaveLength(0);
      expect((meta.linkedMRs as any[]).length).toBe(0);
      expect(meta._raw).toBeDefined();
    });

    it("handles issue not found (null response)", async () => {
      const gql = mockGQL(ISSUE_NOT_FOUND_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.get-full"].execute(
        { projectPath: "group/project", iid: "9999" },
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
        { message: "Could not resolve to a Project with the path 'group/project'." },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.get-full"].execute(
        { projectPath: "group/project", iid: "42" },
        mockContext,
      );

      expect(result.output).toContain("Could not resolve to a Project");
      expect(result.metadata).toBeDefined();
      expect((result.metadata as Record<string, unknown>)._raw).toBeDefined();
    });
  });
});

/* ── MR Tests ─────────────────────────────────────────────────── */

describe("gitlab.mr.get-full", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["gitlab.mr.get-full"] as any).execute;

      const result = await execute({ iid: "7" }, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");

      const result2 = await execute({ projectPath: "group/project" }, mockContext);
      expect(result2.output).toContain("not found");
    });
  });

  describe("output shape", () => {
    it("returns curated fields for a standard MR", async () => {
      const gql = mockGQL(MR_FULL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.mr.get-full"].execute(
        { projectPath: "group/project", iid: "7" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      // MR metadata
      expect((meta.mr as any).iid).toBe("7");
      expect((meta.mr as any).state).toBe("opened");
      expect((meta.mr as any).mergeStatus).toBe("CAN_BE_MERGED");
      expect((meta.mr as any).sourceBranch).toBe("fix-login-padding");
      expect((meta.mr as any).targetBranch).toBe("main");

      // Diff stats
      expect((meta.mr as any).diffStats).toBeDefined();
      expect((meta.mr as any).diffStats.additions).toBe(15);
      expect((meta.mr as any).diffStats.deletions).toBe(3);

      // Labels
      expect((meta.labels as any[]).length).toBe(1);

      // Commits
      expect(meta.commits).toBeDefined();
      expect((meta.commits as any).nodes).toBeDefined();
      expect((meta.commits as any).nodes).toHaveLength(2);

      // Discussions
      expect(meta.discussions).toBeDefined();
      expect((meta.discussions as any).nodes).toHaveLength(1);

      // Pipelines
      expect(meta.pipelines).toBeDefined();
      expect((meta.pipelines as any[]).length).toBe(1);
      expect((meta.pipelines as any[])[0].status).toBe("passed");

      // Approvals
      expect(meta.approvals).toBeDefined();
      expect((meta.approvals as any[]).length).toBe(1);
      expect((meta.approvals as any[])[0].username).toBe("maintainer1");

      // _raw
      expect(meta._raw).toBeDefined();
    });

    it("handles merged MR", async () => {
      const gql = mockGQL(MR_MERGED_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.mr.get-full"].execute(
        { projectPath: "group/project", iid: "8" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect((meta.mr as any).state).toBe("merged");
      expect((meta.mr as any).mergedAt).toBe("2025-01-12T10:00:00Z");
    });

    it("handles MR not found", async () => {
      const gql = mockGQL(MR_NOT_FOUND_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.mr.get-full"].execute(
        { projectPath: "group/project", iid: "9999" },
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
        { message: "Resource not accessible" },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.mr.get-full"].execute(
        { projectPath: "group/project", iid: "42" },
        mockContext,
      );

      expect(result.output).toContain("Resource not accessible");
      expect(result.metadata).toBeDefined();
    });
  });
});

/* ── Issue Search Tests ────────────────────────────────────────── */

describe("gitlab.issue.search", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing query gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["gitlab.issue.search"] as any).execute;

      const result = await execute({}, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("handles empty query gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["gitlab.issue.search"] as any).execute;

      const result = await execute({ query: "" }, mockContext);
      expect(typeof result.output).toBe("string");
    });

    it("accepts optional `first` parameter", async () => {
      const gql = mockGQL(ISSUE_SEARCH_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));

      const result = await tools["gitlab.issue.search"].execute(
        { query: "bug", first: 10 },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns curated search results with project context", async () => {
      const gql = mockGQL(ISSUE_SEARCH_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.search"].execute(
        { query: "memory" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      const meta = result.metadata as Record<string, unknown>;

      expect(meta.projectCount).toBe(2);
      expect(meta.issueCount).toBe(3);
      expect(meta.results).toBeDefined();
      expect(Array.isArray(meta.results)).toBe(true);
      expect((meta.results as any[]).length).toBe(3);

      // Each result has project context
      const firstResult = (meta.results as any[])[0];
      expect(firstResult.iid).toBe("100");
      expect(firstResult.projectPath).toBe("group/project");
      expect(firstResult.state).toBe("opened");

      const secondResult = (meta.results as any[])[1];
      expect(secondResult.projectPath).toBe("group/project");

      const thirdResult = (meta.results as any[])[2];
      expect(thirdResult.projectPath).toBe("other-org/other-project");

      expect(meta._raw).toBeDefined();
    });

    it("handles empty search results", async () => {
      const gql = mockGQL(ISSUE_SEARCH_EMPTY_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.search"].execute(
        { query: "nonexistent" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.projectCount).toBe(0);
      expect(meta.issueCount).toBe(0);
      expect((meta.results as any[]).length).toBe(0);
      expect(result.output).toContain("No projects found");
    });

    it("handles projects with no issues", async () => {
      const gql = mockGQL(ISSUE_SEARCH_NO_ISSUES_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.search"].execute(
        { query: "empty" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.projectCount).toBe(1);
      expect(meta.issueCount).toBe(0);
      expect((meta.results as any[]).length).toBe(0);
      expect(result.output).toContain("No issues found");
    });
  });

  describe("error handling", () => {
    it("surfaces GraphQL errors", async () => {
      const gql = mockGQLError([
        { message: "Resource not accessible" },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.issue.search"].execute(
        { query: "bug" },
        mockContext,
      );

      expect(result.output).toContain("Resource not accessible");
      expect(result.metadata).toBeDefined();
    });
  });
});

/* ── Project Full Tests ────────────────────────────────────────── */

describe("gitlab.project.get-full", () => {
  beforeEach(async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const tools = createRichTools(() => Promise.resolve(mockGQL({})));
      const execute = (tools["gitlab.project.get-full"] as any).execute;

      const result = await execute({}, mockContext);
      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("not found");
    });
  });

  describe("output shape", () => {
    it("returns curated project fields with README, file tree, and languages", async () => {
      const gql = mockGQL(PROJECT_FULL_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.project.get-full"].execute(
        { projectPath: "group/my-project" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      const meta = result.metadata as Record<string, unknown>;

      // Project metadata
      expect(meta.name).toBe("my-project");
      expect(meta.fullPath).toBe("group/my-project");
      expect(meta.description).toBe("A sample project for testing");
      expect(meta.visibility).toBe("public");

      // Languages
      expect(meta.languages).toBeDefined();
      expect((meta.languages as any[]).length).toBe(3);

      // Stats
      expect(meta.stats).toBeDefined();
      expect((meta.stats as any).stars).toBe(150);
      expect((meta.stats as any).forks).toBe(25);
      expect((meta.stats as any).openIssues).toBe(5);

      // Default branch
      expect(meta.defaultBranch).toBe("main");

      // README (first 5000 chars)
      expect(meta.readme).toBeDefined();
      expect(meta.readme).toContain("# My Project");

      // File tree
      expect(meta.fileTree).toBeDefined();
      expect((meta.fileTree as any[]).length).toBe(4);

      // _raw
      expect(meta._raw).toBeDefined();
    });

    it("handles project without README", async () => {
      const gql = mockGQL(PROJECT_NO_README_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.project.get-full"].execute(
        { projectPath: "group/empty-repo" },
        mockContext,
      );

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.name).toBe("empty-repo");
      expect(meta.readme).toBeNull();
      expect((meta.fileTree as any[]).length).toBe(0);
    });

    it("handles project not found", async () => {
      const gql = mockGQL(PROJECT_NOT_FOUND_RESPONSE);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.project.get-full"].execute(
        { projectPath: "group/nonexistent" },
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
        { message: "Could not resolve to a Project" },
      ]);
      const tools = createRichTools(() => Promise.resolve(gql));
      const result = await tools["gitlab.project.get-full"].execute(
        { projectPath: "group/nonexistent" },
        mockContext,
      );

      expect(result.output).toContain("Could not resolve to a Project");
    });
  });
});

/* ── Abort handling ──────────────────────────────────────────────── */

describe("abort handling", () => {
  it("respects abort signal for issue.get-full", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["gitlab.issue.get-full"].execute(
      { projectPath: "group/project", iid: "1" },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for mr.get-full", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["gitlab.mr.get-full"].execute(
      { projectPath: "group/project", iid: "1" },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for issue.search", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["gitlab.issue.search"].execute(
      { query: "bug" },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for project.get-full", async () => {
    createRichTools = (await import("../src/tools/rich.js")).createRichTools;
    const tools = createRichTools(() => Promise.resolve(mockGQL({})));
    const result = await tools["gitlab.project.get-full"].execute(
      { projectPath: "group/project" },
      { abort: { aborted: true } as any },
    );
    expect(result.output).toBe("Request was aborted.");
  });
});
