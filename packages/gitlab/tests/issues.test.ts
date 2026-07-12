/**
 * Issue Tools Tests — GitLab Plugin
 *
 * Validates the five REST-based issue tools:
 * - gitlab.issue.list
 * - gitlab.issue.get
 * - gitlab.issue.create
 * - gitlab.issue.update
 * - gitlab.issue.comment
 *
 * Tests cover Zod input validation, output shape including _raw,
 * error handling (404, 422), abort signal, and Markdown output formatting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitLabClient } from "../src/client.js";
import { createIssueTools } from "../src/tools/issues.js";

/* ── Fixtures ──────────────────────────────────────────────────── */

const ISSUE_FIXTURE = {
  id: 42,
  iid: 5,
  project_id: 1,
  title: "Fix login button styling",
  description: "The login button on the homepage has incorrect padding.",
  state: "opened",
  web_url: "https://gitlab.com/owner/repo/-/issues/5",
  created_at: "2025-01-15T10:00:00.000Z",
  updated_at: "2025-01-20T14:30:00.000Z",
  closed_at: null,
  author: { id: 1, name: "Test User", username: "testuser" },
  assignees: [
    { id: 2, name: "Assignee One", username: "assignee1" },
  ],
  labels: ["bug", "frontend"],
  milestone: { id: 10, title: "Sprint 1" },
  user_notes_count: 3,
  upvotes: 5,
  downvotes: 1,
  due_date: "2025-02-01",
  confidential: false,
  discussion_locked: false,
  issue_type: "issue",
  task_completion_status: { count: 0, completed_count: 0 },
};

const ISSUE_CLOSED_FIXTURE = {
  ...ISSUE_FIXTURE,
  iid: 6,
  title: "Fix typo in README",
  state: "closed",
  closed_at: "2025-01-25T09:00:00.000Z",
};

const ISSUES_LIST_FIXTURE = [
  ISSUE_FIXTURE,
  ISSUE_CLOSED_FIXTURE,
];

const NOTE_FIXTURE = {
  id: 100,
  body: "I can reproduce this on Chrome.",
  author: { id: 1, name: "Test User", username: "testuser" },
  created_at: "2025-01-16T08:00:00.000Z",
  system: false,
};

/* ── Mock helpers ──────────────────────────────────────────────── */

/** Helper: create a mock Response-like object for the client request */
function mockResponse(
  body: unknown,
  status: number = 200,
  ok: boolean = true,
  headers?: Record<string, string>,
): Response {
  const responseHeaders = new Headers({
    "Content-Type": "application/json",
    "X-Total": "42",
    "X-Total-Pages": "3",
    "X-Page": "1",
    "X-Per-Page": "20",
    "X-Next-Page": "2",
    "X-Prev-Page": "",
    ...headers,
  });
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: responseHeaders,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    // Add required Response fields
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    clone: () => this as unknown as Response,
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.reject(new Error("Not implemented")),
  } as unknown as Response;
}

/** Helper: create a mock GitLab client */
function mockClient(
  response: Response,
): GitLabClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  };
}

/** Helper: create a mock client that rejects */
function mockClientError(error: Error): GitLabClient {
  return {
    request: vi.fn().mockRejectedValue(error),
  };
}

/** Minimal mock context */
const mockContext = { abort: undefined as any };

/* ── Tests ─────────────────────────────────────────────────────── */

describe("gitlab.issue.list", () => {
  let tools: ReturnType<typeof createIssueTools>;

  beforeEach(() => {
    const resp = mockResponse(ISSUES_LIST_FIXTURE, 200, true);
    tools = createIssueTools(() => Promise.resolve(mockClient(resp)));
  });

  describe("input validation", () => {
    it("accepts valid projectId as number", async () => {
      const result = await (tools["gitlab.issue.list"] as any).execute(
        { projectId: 1 },
        mockContext,
      );
      expect(result.output).toContain("Issues for project 1");
      expect(result.metadata).toBeDefined();
    });

    it("accepts valid projectId as string", async () => {
      const result = await (tools["gitlab.issue.list"] as any).execute(
        { projectId: "namespace/project" },
        mockContext,
      );
      expect(result.output).toContain("Issues for project namespace/project");
    });

    it("accepts optional filter parameters", async () => {
      const result = await (tools["gitlab.issue.list"] as any).execute(
        {
          projectId: 1,
          state: "opened",
          labels: "bug,frontend",
          search: "login",
          page: 2,
          perPage: 50,
        },
        mockContext,
      );
      expect(result.output).toBeDefined();
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await (tools["gitlab.issue.list"] as any).execute(
        { projectId: 1 },
        { abort: controller.signal },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });

  describe("output shape", () => {
    it("returns curated issues with _raw in metadata", async () => {
      const result = await (tools["gitlab.issue.list"] as any).execute(
        { projectId: 1 },
        mockContext,
      );
      expect(result.metadata.issues).toBeDefined();
      expect(result.metadata.issues).toHaveLength(2);
      expect(result.metadata._raw).toEqual(ISSUES_LIST_FIXTURE);
      expect(result.metadata.pagination).toBeDefined();
      expect(result.metadata.pagination.total).toBe(42);
      expect(result.metadata.pagination.hasNext).toBe(true);
    });

    it("formats output as Markdown summary", async () => {
      const result = await (tools["gitlab.issue.list"] as any).execute(
        { projectId: 1 },
        mockContext,
      );
      expect(result.output).toContain("Issue #5:");
      expect(result.output).toContain("Issue #6:");
      expect(result.output).toContain("State:");
      expect(result.output).toContain("Labels:");
    });
  });

  describe("error handling", () => {
    it("handles 404 error", async () => {
      const resp = mockResponse({ error: "Not Found" }, 404, false);
      const tools404 = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (tools404["gitlab.issue.list"] as any).execute(
        { projectId: 99999 },
        mockContext,
      );
      expect(result.output).toContain("not found");
    });

    it("handles client rejection", async () => {
      const toolsErr = createIssueTools(() =>
        Promise.reject(new Error("Not configured")),
      );
      const result = await (toolsErr["gitlab.issue.list"] as any).execute(
        { projectId: 1 },
        mockContext,
      );
      expect(result.output).toContain("Not configured");
    });
  });
});

describe("gitlab.issue.get", () => {
  let tools: ReturnType<typeof createIssueTools>;

  beforeEach(() => {
    const resp = mockResponse(ISSUE_FIXTURE, 200, true);
    tools = createIssueTools(() => Promise.resolve(mockClient(resp)));
  });

  describe("input validation", () => {
    it("accepts valid projectId and issueIid", async () => {
      const result = await (tools["gitlab.issue.get"] as any).execute(
        { projectId: 1, issueIid: 5 },
        mockContext,
      );
      expect(result.output).toContain("Issue #5:");
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await (tools["gitlab.issue.get"] as any).execute(
        { projectId: 1, issueIid: 5 },
        { abort: controller.signal },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });

  describe("output shape", () => {
    it("returns curated fields with _raw in metadata", async () => {
      const result = await (tools["gitlab.issue.get"] as any).execute(
        { projectId: 1, issueIid: 5 },
        mockContext,
      );
      expect(result.metadata.iid).toBe(5);
      expect(result.metadata.title).toBe("Fix login button styling");
      expect(result.metadata.state).toBe("opened");
      expect(result.metadata.author).toBe("Test User");
      expect(result.metadata.assignees).toHaveLength(1);
      expect(result.metadata.labels).toEqual(["bug", "frontend"]);
      expect(result.metadata.milestone.title).toBe("Sprint 1");
      expect(result.metadata._raw).toEqual(ISSUE_FIXTURE);
    });

    it("includes description in output", async () => {
      const result = await (tools["gitlab.issue.get"] as any).execute(
        { projectId: 1, issueIid: 5 },
        mockContext,
      );
      expect(result.output).toContain("The login button");
      expect(result.output).toContain("Description:");
    });
  });

  describe("error handling", () => {
    it("handles 404 error gracefully", async () => {
      const resp = mockResponse({ message: "Not found" }, 404, false);
      const tools404 = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (tools404["gitlab.issue.get"] as any).execute(
        { projectId: 1, issueIid: 999 },
        mockContext,
      );
      expect(result.output).toContain("not found");
    });

    it("handles 422 validation errors", async () => {
      const resp = mockResponse(
        { error: "Invalid issue IID" },
        422,
        false,
      );
      const tools422 = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (tools422["gitlab.issue.get"] as any).execute(
        { projectId: 1, issueIid: -1 },
        mockContext,
      );
      expect(result.output).toContain("Validation error");
    });
  });
});

describe("gitlab.issue.create", () => {
  let tools: ReturnType<typeof createIssueTools>;

  beforeEach(() => {
    const resp = mockResponse(ISSUE_FIXTURE, 201, true);
    tools = createIssueTools(() => Promise.resolve(mockClient(resp)));
  });

  describe("input validation", () => {
    it("creates an issue with required title only", async () => {
      const result = await (tools["gitlab.issue.create"] as any).execute(
        { projectId: 1, title: "Fix login button styling" },
        mockContext,
      );
      expect(result.output).toContain("created successfully");
      expect(result.metadata.iid).toBe(5);
    });

    it("accepts optional fields: description, labels, assigneeIds", async () => {
      const result = await (tools["gitlab.issue.create"] as any).execute(
        {
          projectId: 1,
          title: "Fix login button styling",
          description: "The button looks wrong.",
          labels: "bug,frontend",
          assigneeIds: [2],
          milestoneId: 10,
          confidential: true,
          dueDate: "2025-02-01",
        },
        mockContext,
      );
      expect(result.metadata._raw).toBeDefined();
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await (tools["gitlab.issue.create"] as any).execute(
        { projectId: 1, title: "Test" },
        { abort: controller.signal },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });

  describe("output shape", () => {
    it("returns curated fields with _raw in metadata", async () => {
      const result = await (tools["gitlab.issue.create"] as any).execute(
        { projectId: 1, title: "Fix login button styling" },
        mockContext,
      );
      expect(result.metadata._raw).toEqual(ISSUE_FIXTURE);
      expect(result.metadata.title).toBe("Fix login button styling");
      expect(result.metadata.url).toBe("https://gitlab.com/owner/repo/-/issues/5");
    });

    it("formats output as Markdown summary", async () => {
      const result = await (tools["gitlab.issue.create"] as any).execute(
        { projectId: 1, title: "Fix login button styling" },
        mockContext,
      );
      expect(result.output).toContain("Issue #5 created");
      expect(result.output).toContain("Title:");
      expect(result.output).toContain("URL:");
    });
  });

  describe("error handling", () => {
    it("handles 422 on missing title", async () => {
      const resp = mockResponse(
        { errors: ["Title can't be blank"] },
        422,
        false,
      );
      const tools422 = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (tools422["gitlab.issue.create"] as any).execute(
        { projectId: 1, title: "" },
        mockContext,
      );
      expect(result.output).toContain("Validation error");
    });
  });
});

describe("gitlab.issue.update", () => {
  const UPDATED_FIXTURE = { ...ISSUE_FIXTURE, title: "Updated title", state: "closed" };
  let tools: ReturnType<typeof createIssueTools>;

  beforeEach(() => {
    const resp = mockResponse(UPDATED_FIXTURE, 200, true);
    tools = createIssueTools(() => Promise.resolve(mockClient(resp)));
  });

  describe("input validation", () => {
    it("updates issue title", async () => {
      const result = await (tools["gitlab.issue.update"] as any).execute(
        { projectId: 1, issueIid: 5, title: "Updated title" },
        mockContext,
      );
      expect(result.output).toContain("updated successfully");
      expect(result.metadata.title).toBe("Updated title");
    });

    it("closes an issue via stateEvent", async () => {
      const result = await (tools["gitlab.issue.update"] as any).execute(
        { projectId: 1, issueIid: 5, stateEvent: "close" },
        mockContext,
      );
      expect(result.metadata.state).toBe("closed");
    });

    it("reopens an issue via stateEvent", async () => {
      const reopened = { ...ISSUE_FIXTURE, state: "opened" };
      const resp = mockResponse(reopened, 200, true);
      const toolsReopen = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (toolsReopen["gitlab.issue.update"] as any).execute(
        { projectId: 1, issueIid: 5, stateEvent: "reopen" },
        mockContext,
      );
      expect(result.metadata.state).toBe("opened");
    });

    it("returns early if no fields provided", async () => {
      const result = await (tools["gitlab.issue.update"] as any).execute(
        { projectId: 1, issueIid: 5 },
        mockContext,
      );
      expect(result.output).toContain("No fields to update");
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await (tools["gitlab.issue.update"] as any).execute(
        { projectId: 1, issueIid: 5, title: "Aborted" },
        { abort: controller.signal },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });

  describe("output shape", () => {
    it("returns curated fields with _raw in metadata", async () => {
      const result = await (tools["gitlab.issue.update"] as any).execute(
        { projectId: 1, issueIid: 5, title: "Updated title" },
        mockContext,
      );
      expect(result.metadata._raw).toEqual(UPDATED_FIXTURE);
      expect(result.metadata.iid).toBe(5);
      expect(result.metadata.url).toBe("https://gitlab.com/owner/repo/-/issues/5");
    });
  });

  describe("error handling", () => {
    it("handles 404 on non-existent issue", async () => {
      const resp = mockResponse({ message: "Not found" }, 404, false);
      const tools404 = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (tools404["gitlab.issue.update"] as any).execute(
        { projectId: 1, issueIid: 999, title: "Nope" },
        mockContext,
      );
      expect(result.output).toContain("not found");
    });
  });
});

describe("gitlab.issue.comment", () => {
  let tools: ReturnType<typeof createIssueTools>;

  beforeEach(() => {
    const resp = mockResponse(NOTE_FIXTURE, 201, true);
    tools = createIssueTools(() => Promise.resolve(mockClient(resp)));
  });

  describe("input validation", () => {
    it("adds a comment with valid inputs", async () => {
      const result = await (tools["gitlab.issue.comment"] as any).execute(
        { projectId: 1, issueIid: 5, body: "I can reproduce this." },
        mockContext,
      );
      expect(result.output).toContain("Comment added");
      expect(result.metadata.id).toBe(100);
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await (tools["gitlab.issue.comment"] as any).execute(
        { projectId: 1, issueIid: 5, body: "Test" },
        { abort: controller.signal },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });

  describe("output shape", () => {
    it("returns note fields with _raw in metadata", async () => {
      const result = await (tools["gitlab.issue.comment"] as any).execute(
        { projectId: 1, issueIid: 5, body: "I can reproduce this." },
        mockContext,
      );
      expect(result.metadata._raw).toEqual(NOTE_FIXTURE);
      expect(result.metadata.id).toBe(100);
      expect(result.metadata.author.username).toBe("testuser");
      expect(result.metadata.system).toBe(false);
    });

    it("formats output as Markdown summary", async () => {
      const result = await (tools["gitlab.issue.comment"] as any).execute(
        { projectId: 1, issueIid: 5, body: "I can reproduce this." },
        mockContext,
      );
      expect(result.output).toContain("Comment added to issue #5");
      expect(result.output).toContain("Note ID: 100");
      expect(result.output).toContain("Author:");
      expect(result.output).toContain("Body:");
    });
  });

  describe("error handling", () => {
    it("handles 422 for empty body", async () => {
      const resp = mockResponse(
        { error: "Body can't be blank" },
        422,
        false,
      );
      const tools422 = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (tools422["gitlab.issue.comment"] as any).execute(
        { projectId: 1, issueIid: 5, body: "" },
        mockContext,
      );
      expect(result.output).toContain("Validation error");
    });

    it("handles 404 on non-existent issue", async () => {
      const resp = mockResponse({ message: "Not found" }, 404, false);
      const tools404 = createIssueTools(() => Promise.resolve(mockClient(resp)));
      const result = await (tools404["gitlab.issue.comment"] as any).execute(
        { projectId: 1, issueIid: 999, body: "Hello" },
        mockContext,
      );
      expect(result.output).toContain("not found");
    });
  });
});
