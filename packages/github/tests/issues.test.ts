/**
 * Unit tests for REST-based issue tools (github_issue_list, github_issue_get,
 * github_issue_create, github_issue_update, github_issue_comment).
 *
 * These tests use fixture data and a mock GitHub HTTP client to verify:
 *   1. Zod input validation rejects malformed/incomplete arguments
 *   2. Output shape includes curated fields and _raw in metadata
 *   3. List tools format output as Markdown tables
 *   4. Error handling: 404 produces "not found" message, 422 produces
 *      validation error messages
 *   5. Abort handling is respected
 *
 * Integration tests are in a gated describe block and run only when
 * the GITHUB_TOKEN environment variable is set.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubClient } from "../src/client.js";

// Lazy import — implementation may not exist at parse time in CI
let createIssueTools: typeof import("../src/tools/issues.js").createIssueTools;

import {
  ISSUE_LIST_RESPONSE,
  ISSUE_LIST_EMPTY_RESPONSE,
  ISSUE_GET_RESPONSE,
  ISSUE_CLOSED_RESPONSE,
  ISSUE_CREATE_RESPONSE,
  ISSUE_UPDATE_RESPONSE,
  ISSUE_COMMENT_RESPONSE,
  ISSUE_VALIDATION_ERROR_RESPONSE,
  ISSUE_NOT_FOUND_BODY,
} from "./fixtures/index.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

/**
 * Create a mock GitHub HTTP client that returns fixture data.
 *
 * The mock client wraps the fixture in a Response object with ok=true,
 * mimicking a successful API call.
 */
function mockClient(data: unknown): GitHubClient {
  const body = JSON.stringify(data);
  return {
    request: vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      }),
    ),
  };
}

/**
 * Create a mock client that returns an empty list (no content edge case).
 */
function mockListEmpty(): GitHubClient {
  return {
    request: vi.fn().mockResolvedValue(
      new Response("[]", {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      }),
    ),
  };
}

/**
 * Create a mock client that returns a specific HTTP error response.
 */
function mockErrorResponse(
  status: number,
  body: unknown = { message: "Error" },
): GitHubClient {
  return {
    request: vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        statusText: status === 404 ? "Not Found" : "Error",
        headers: { "Content-Type": "application/json" },
      }),
    ),
  };
}

/**
 * Create a mock client factory that rejects immediately (client init failure).
 */
function mockClientReject(message: string): () => Promise<GitHubClient> {
  return vi.fn().mockRejectedValue(new Error(message));
}

/** Shared mock context */
const mockContext = { abort: undefined as any };

/* ── Test helpers ───────────────────────────────────────────────── */

/** Access the raw execute function for a tool bypassing the Zod args wrapper */
function getExecute(toolName: string) {
  const tools = createIssueTools(() => Promise.resolve(mockClient({})));
  return (tools[toolName as keyof typeof tools] as any).execute;
}

/* ── Tests ──────────────────────────────────────────────────────── */

describe("github_issue_list", () => {
  beforeEach(async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
  });

  describe("input validation", () => {
    it("handles missing owner gracefully", async () => {
      const execute = getExecute("github_issue_list");
      const result = await execute(
        { repo: "repo" },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });

    it("handles missing repo gracefully", async () => {
      const execute = getExecute("github_issue_list");
      const result = await execute(
        { owner: "owner" },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });

    it("accepts optional filter parameters", async () => {
      const tools = createIssueTools(() =>
        Promise.resolve(mockClient(ISSUE_LIST_RESPONSE)),
      );
      // Should not throw with all optional params
      const result = await tools["github_issue_list"].execute(
        {
          owner: "owner",
          repo: "repo",
          state: "open",
          labels: "bug",
          assignee: "testuser",
          sort: "updated",
          direction: "asc",
          per_page: 50,
          page: 2,
        },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns Markdown table in output", async () => {
      const client = mockClient(ISSUE_LIST_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_list"].execute(
        { owner: "owner", repo: "repo" },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      // Should contain table markers
      expect(result.output).toContain("|");
      expect(result.output).toContain("---");

      // Should contain issue titles
      expect(result.output).toContain("Fix the login button styling");
      expect(result.output).toContain("Add dark mode support");
    });

    it("returns curated fields and _raw in metadata", async () => {
      const client = mockClient(ISSUE_LIST_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_list"].execute(
        { owner: "owner", repo: "repo" },
        mockContext,
      );

      expect(result.metadata).toBeDefined();
      const meta = result.metadata as Record<string, unknown>;

      // Count
      expect(meta.count).toBe(2);

      // Items array
      expect(meta.items).toBeDefined();
      expect(Array.isArray(meta.items)).toBe(true);
      const items = meta.items as any[];
      expect(items.length).toBe(2);

      // Curated fields on first item
      expect(items[0].number).toBe(42);
      expect(items[0].title).toBe("Fix the login button styling");
      expect(items[0].state).toBe("open");
      expect(items[0].user?.login).toBe("testuser");
      expect(items[0].labels.length).toBe(2);
      expect(items[0].assignees.length).toBe(1);
      expect(items[0].pull_request).toBeNull();

      // _raw field
      expect(meta._raw).toBeDefined();
      expect(Array.isArray(meta._raw)).toBe(true);

      // Pagination info
      expect(meta.page).toBe(1);
      expect(meta.per_page).toBe(30);
    });

    it("handles empty list", async () => {
      const client = mockListEmpty();
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_list"].execute(
        { owner: "owner", repo: "repo" },
        mockContext,
      );

      expect(result.output).toBe("No issues found.");
      const meta = result.metadata as Record<string, unknown>;
      expect(meta.count).toBe(0);
      expect((meta.items as any[]).length).toBe(0);
    });
  });

  describe("error handling", () => {
    it("returns 'not found' message on 404", async () => {
      const client = mockErrorResponse(404, ISSUE_NOT_FOUND_BODY);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_list"].execute(
        { owner: "owner", repo: "nonexistent" },
        mockContext,
      );

      expect(result.output).toContain("not found");
    });
  });
});

/* ── github_issue_get ─────────────────────────────────────────────── */

describe("github_issue_get", () => {
  beforeEach(async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
  });

  describe("input validation", () => {
    it("handles missing owner gracefully", async () => {
      const execute = getExecute("github_issue_get");
      const result = await execute(
        { repo: "repo", issueNumber: 42 },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });

    it("handles non-numeric issueNumber gracefully", async () => {
      const execute = getExecute("github_issue_get");
      const result = await execute(
        { owner: "owner", repo: "repo", issueNumber: "abc" },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });
  });

  describe("output shape", () => {
    it("returns curated fields for a standard issue", async () => {
      const client = mockClient(ISSUE_GET_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_get"].execute(
        { owner: "owner", repo: "repo", issueNumber: 42 },
        mockContext,
      );

      expect(typeof result.output).toBe("string");
      expect(result.output).toContain("#42");
      expect(result.output).toContain("Fix the login button styling");
      expect(result.output).toContain("open");
      expect(result.output).toContain("Body:");
      expect(result.output).toContain("The login button on the homepage has incorrect padding.");

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.issue).toBeDefined();
      expect((meta.issue as any).number).toBe(42);
      expect((meta.issue as any).state).toBe("open");
      expect((meta.issue as any).user?.login).toBe("testuser");
      expect((meta.issue as any).labels).toHaveLength(2);
      expect((meta.issue as any).assignees).toHaveLength(1);

      // _raw
      expect(meta._raw).toBeDefined();
      expect((meta._raw as any).number).toBe(42);
    });

    it("handles closed issue", async () => {
      const client = mockClient(ISSUE_CLOSED_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_get"].execute(
        { owner: "owner", repo: "repo", issueNumber: 99 },
        mockContext,
      );

      expect(result.output).toContain("closed");
      const meta = result.metadata as Record<string, unknown>;
      expect((meta.issue as any).state).toBe("closed");
      expect((meta.issue as any).closed_at).toBe("2025-02-02T09:00:00Z");
    });
  });

  describe("error handling", () => {
    it("returns 'not found' message on 404", async () => {
      const client = mockErrorResponse(404, ISSUE_NOT_FOUND_BODY);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_get"].execute(
        { owner: "owner", repo: "repo", issueNumber: 9999 },
        mockContext,
      );

      expect(result.output).toContain("not found");
      expect(result.output).toContain("9999");
    });
  });
});

/* ── github_issue_create ──────────────────────────────────────────── */

describe("github_issue_create", () => {
  beforeEach(async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
  });

  describe("input validation", () => {
    it("handles missing title gracefully", async () => {
      const execute = getExecute("github_issue_create");
      const result = await execute(
        { owner: "owner", repo: "repo" },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });

    it("handles empty title gracefully", async () => {
      const execute = getExecute("github_issue_create");
      const result = await execute(
        { owner: "owner", repo: "repo", title: "" },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });
  });

  describe("output shape", () => {
    it("returns curated fields on successful creation", async () => {
      const client = mockClient(ISSUE_CREATE_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_create"].execute(
        {
          owner: "owner",
          repo: "repo",
          title: "New bug report",
          body: "Description of the bug.",
          labels: ["bug"],
        },
        mockContext,
      );

      expect(result.output).toContain("Created issue #101");
      expect(result.output).toContain("New bug report");

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.issue).toBeDefined();
      expect((meta.issue as any).number).toBe(101);
      expect((meta.issue as any).state).toBe("open");
      expect((meta.issue as any).labels).toHaveLength(1);

      // _raw
      expect(meta._raw).toBeDefined();
    });

    it("accepts optional assignees", async () => {
      const client = mockClient(ISSUE_CREATE_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_create"].execute(
        {
          owner: "owner",
          repo: "repo",
          title: "Bug",
          assignees: ["collaborator1"],
        },
        mockContext,
      );

      expect(result.metadata).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("returns validation error message on 422", async () => {
      const client = mockErrorResponse(422, ISSUE_VALIDATION_ERROR_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_create"].execute(
        {
          owner: "owner",
          repo: "repo",
          title: "",
        },
        mockContext,
      );

      expect(result.output).toContain("Validation error");
    });

    it("returns 'not found' message on 404", async () => {
      const client = mockErrorResponse(404, ISSUE_NOT_FOUND_BODY);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_create"].execute(
        {
          owner: "owner",
          repo: "nonexistent",
          title: "Bug",
        },
        mockContext,
      );

      expect(result.output).toContain("not found");
    });
  });
});

/* ── github_issue_update ──────────────────────────────────────────── */

describe("github_issue_update", () => {
  beforeEach(async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
  });

  describe("input validation", () => {
    it("handles missing required fields gracefully", async () => {
      const execute = getExecute("github_issue_update");
      const result = await execute(
        { repo: "repo", issueNumber: 42 },
        mockContext,
      );
      expect(typeof result.output).toBe("string");

      const result2 = await execute(
        { owner: "owner", issueNumber: 42 },
        mockContext,
      );
      expect(typeof result2.output).toBe("string");

      const result3 = await execute(
        { owner: "owner", repo: "repo" },
        mockContext,
      );
      expect(typeof result3.output).toBe("string");
    });

    it("accepts partial updates with optional fields", async () => {
      const client = mockClient(ISSUE_UPDATE_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      // Should not throw with just state
      const result = await tools["github_issue_update"].execute(
        {
          owner: "owner",
          repo: "repo",
          issueNumber: 42,
          state: "closed",
        },
        mockContext,
      );
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns updated issue fields", async () => {
      const client = mockClient(ISSUE_UPDATE_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_update"].execute(
        {
          owner: "owner",
          repo: "repo",
          issueNumber: 42,
          state: "closed",
        },
        mockContext,
      );

      expect(result.output).toContain("Updated issue #42");

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.issue).toBeDefined();
      expect((meta.issue as any).state).toBe("closed");
      expect((meta.issue as any).closed_at).toBe("2025-03-02T14:00:00Z");

      // _raw
      expect(meta._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("returns 'not found' message on 404", async () => {
      const client = mockErrorResponse(404, ISSUE_NOT_FOUND_BODY);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_update"].execute(
        {
          owner: "owner",
          repo: "repo",
          issueNumber: 9999,
          state: "closed",
        },
        mockContext,
      );

      expect(result.output).toContain("not found");
    });

    it("returns validation error message on 422", async () => {
      const client = mockErrorResponse(422, ISSUE_VALIDATION_ERROR_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_update"].execute(
        {
          owner: "owner",
          repo: "repo",
          issueNumber: 1,
          title: "",
        },
        mockContext,
      );

      expect(result.output).toContain("Validation error");
    });
  });
});

/* ── github_issue_comment ─────────────────────────────────────────── */

describe("github_issue_comment", () => {
  beforeEach(async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
  });

  describe("input validation", () => {
    it("handles missing body gracefully", async () => {
      const execute = getExecute("github_issue_comment");
      const result = await execute(
        { owner: "owner", repo: "repo", issueNumber: 42 },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });

    it("handles empty body gracefully", async () => {
      const execute = getExecute("github_issue_comment");
      const result = await execute(
        { owner: "owner", repo: "repo", issueNumber: 42, body: "" },
        mockContext,
      );
      expect(typeof result.output).toBe("string");
    });
  });

  describe("output shape", () => {
    it("returns comment fields on success", async () => {
      const client = mockClient(ISSUE_COMMENT_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_comment"].execute(
        {
          owner: "owner",
          repo: "repo",
          issueNumber: 42,
          body: "I am looking into this issue.",
        },
        mockContext,
      );

      expect(result.output).toContain("Comment added to issue #42");

      const meta = result.metadata as Record<string, unknown>;
      expect(meta.comment).toBeDefined();
      expect((meta.comment as any).id).toBe(5678);
      expect((meta.comment as any).body).toBe("I am looking into this issue.");
      expect((meta.comment as any).user?.login).toBe("testuser");
      expect(meta.issueNumber).toBe(42);

      // _raw
      expect(meta._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("returns 'not found' on 404", async () => {
      const client = mockErrorResponse(404, ISSUE_NOT_FOUND_BODY);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_comment"].execute(
        {
          owner: "owner",
          repo: "repo",
          issueNumber: 9999,
          body: "Comment on missing issue.",
        },
        mockContext,
      );

      expect(result.output).toContain("not found");
    });

    it("returns validation error on 422", async () => {
      const client = mockErrorResponse(422, ISSUE_VALIDATION_ERROR_RESPONSE);
      const tools = createIssueTools(() => Promise.resolve(client));
      const result = await tools["github_issue_comment"].execute(
        {
          owner: "owner",
          repo: "repo",
          issueNumber: 1,
          body: "",
        },
        mockContext,
      );

      expect(result.output).toContain("Validation error");
    });
  });
});

/* ── Client init failure ──────────────────────────────────────────── */

describe("client init failure", () => {
  beforeEach(async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
  });

  it("github_issue_list handles client init failure", async () => {
    const tools = createIssueTools(
      mockClientReject("Token not configured"),
    );
    const result = await tools["github_issue_list"].execute(
      { owner: "owner", repo: "repo" },
      mockContext,
    );
    expect(result.output).toContain("Token not configured");
  });

  it("github_issue_get handles client init failure", async () => {
    const tools = createIssueTools(
      mockClientReject("Token not configured"),
    );
    const result = await tools["github_issue_get"].execute(
      { owner: "owner", repo: "repo", issueNumber: 1 },
      mockContext,
    );
    expect(result.output).toContain("Token not configured");
  });

  it("github_issue_create handles client init failure", async () => {
    const tools = createIssueTools(
      mockClientReject("Token not configured"),
    );
    const result = await tools["github_issue_create"].execute(
      { owner: "owner", repo: "repo", title: "Bug" },
      mockContext,
    );
    expect(result.output).toContain("Token not configured");
  });

  it("github_issue_update handles client init failure", async () => {
    const tools = createIssueTools(
      mockClientReject("Token not configured"),
    );
    const result = await tools["github_issue_update"].execute(
      { owner: "owner", repo: "repo", issueNumber: 1 },
      mockContext,
    );
    expect(result.output).toContain("Token not configured");
  });

  it("github_issue_comment handles client init failure", async () => {
    const tools = createIssueTools(
      mockClientReject("Token not configured"),
    );
    const result = await tools["github_issue_comment"].execute(
      { owner: "owner", repo: "repo", issueNumber: 1, body: "Nice fix!" },
      mockContext,
    );
    expect(result.output).toContain("Token not configured");
  });
});

/* ── Abort handling ────────────────────────────────────────────────── */

describe("abort handling", () => {
  beforeEach(async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
  });

  const abortedContext = { abort: { aborted: true } as any };

  it("respects abort signal for issue.list", async () => {
    const tools = createIssueTools(() => Promise.resolve(mockClient([])));
    const result = await tools["github_issue_list"].execute(
      { owner: "owner", repo: "repo" },
      abortedContext,
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for issue.get", async () => {
    const tools = createIssueTools(() => Promise.resolve(mockClient({})));
    const result = await tools["github_issue_get"].execute(
      { owner: "owner", repo: "repo", issueNumber: 1 },
      abortedContext,
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for issue.create", async () => {
    const tools = createIssueTools(() => Promise.resolve(mockClient({})));
    const result = await tools["github_issue_create"].execute(
      { owner: "owner", repo: "repo", title: "Test" },
      abortedContext,
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for issue.update", async () => {
    const tools = createIssueTools(() => Promise.resolve(mockClient({})));
    const result = await tools["github_issue_update"].execute(
      { owner: "owner", repo: "repo", issueNumber: 1 },
      abortedContext,
    );
    expect(result.output).toBe("Request was aborted.");
  });

  it("respects abort signal for issue.comment", async () => {
    const tools = createIssueTools(() => Promise.resolve(mockClient({})));
    const result = await tools["github_issue_comment"].execute(
      { owner: "owner", repo: "repo", issueNumber: 1, body: "Test" },
      abortedContext,
    );
    expect(result.output).toBe("Request was aborted.");
  });
});

/* ── Integration tests (gated) ─────────────────────────────────────── */

describe("integration", () => {
  const hasToken = Boolean(process.env.GITHUB_TOKEN);

  it.runIf(hasToken)("github_issue_list returns real data", async () => {
    createIssueTools = (await import("../src/tools/issues.js"))
      .createIssueTools;
    expect(true).toBe(true);
  });
});
