/**
 * Merge Request Tools Tests — GitLab Plugin
 *
 * Tests for gitlab.mr.list, gitlab.mr.get, gitlab.mr.create, gitlab.mr.merge.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitLabClient } from "../src/client.js";
import { createMRTools } from "../src/tools/mrs.js";

/* ── Mock helpers ──────────────────────────────────────────────── */

function createMockClient(): GitLabClient {
  return {
    request: vi.fn(),
  };
}

function mockAbort(): AbortSignal {
  return new AbortController().signal;
}

/* ── Sample responses ─────────────────────────────────────────── */

const SAMPLE_MR_LIST = [
  {
    iid: 1,
    title: "Fix login bug",
    description: "Fixes the login authentication bug",
    state: "opened",
    web_url: "https://gitlab.com/group/project/-/merge_requests/1",
    source_branch: "fix-login",
    target_branch: "main",
    author: { username: "alice", name: "Alice" },
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-02T00:00:00.000Z",
    merged_at: null,
    closed_at: null,
    merge_status: "can_be_merged",
    draft: false,
    work_in_progress: false,
    labels: ["bug", "frontend"],
    has_conflicts: false,
    merge_error: null,
    user_notes_count: 3,
    upvotes: 2,
    downvotes: 0,
  },
  {
    iid: 2,
    title: "Add feature flag support",
    description: null,
    state: "opened",
    web_url: "https://gitlab.com/group/project/-/merge_requests/2",
    source_branch: "feat-flags",
    target_branch: "main",
    author: { username: "bob", name: "Bob" },
    created_at: "2025-01-03T00:00:00.000Z",
    updated_at: "2025-01-04T00:00:00.000Z",
    merged_at: null,
    closed_at: null,
    merge_status: "can_be_merged",
    draft: true,
    work_in_progress: true,
    labels: ["feature"],
    has_conflicts: false,
    merge_error: null,
    user_notes_count: 1,
    upvotes: 0,
    downvotes: 1,
  },
];

const SAMPLE_SINGLE_MR = {
  ...SAMPLE_MR_LIST[0],
  diff_refs: { additions: 42, deletions: 10, changes: 52 },
  task_completion_status: { count: 3, completed_count: 1 },
};

const SAMPLE_COMMITS = [
  {
    id: "abc123def456",
    title: "Fix login validation",
    message: "Fix login validation\n\nAdded proper error handling",
    author_name: "Alice",
    committed_date: "2025-01-01T00:00:00.000Z",
  },
];

/* ── Helper to create mock Response objects ──────────────────── */

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    json: () => Promise.resolve(data),
    clone: () => mockJsonResponse(data, status),
  } as unknown as Response;
}

/* ══════════════════════════════════════════════════════════════════
   gitlab.mr.list
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab.mr.list", () => {
  it("returns a markdown list of merge requests", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_MR_LIST),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.list"]!;
    const result = await toolDef.execute(
      { project_id: 1 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Merge Requests");
    expect(result.output).toContain("**!1** — Fix login bug");
    expect(result.output).toContain("**!2** — Add feature flag support");
    expect(result.output).toContain("[DRAFT]");
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.count).toBe(2);
    expect(result.metadata!._raw).toEqual(SAMPLE_MR_LIST);
  });

  it("respects state filter parameter", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse([]),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.list"]!;
    await toolDef.execute(
      { project_id: 1, state: "merged" },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("state=merged");
  });

  it("includes label filter in query", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse([]),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.list"]!;
    await toolDef.execute(
      { project_id: 1, labels: "bug,frontend" },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("labels=bug%2Cfrontend");
  });

  it("returns empty message when no MRs found", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse([]),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.list"]!;
    const result = await toolDef.execute(
      { project_id: 1 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("No merge requests found");
  });

  it("respects abort signal", async () => {
    const client = createMockClient();
    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.list"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      { project_id: 1 },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles API error response", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Project not found" }, 404),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.list"]!;
    const result = await toolDef.execute(
      { project_id: 999 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Failed to list merge requests");
    expect(result.output).toContain("404");
  });
});

/* ══════════════════════════════════════════════════════════════════
   gitlab.mr.get
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab.mr.get", () => {
  it("returns full merge request details", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockJsonResponse(SAMPLE_SINGLE_MR))
      .mockResolvedValueOnce(mockJsonResponse(SAMPLE_COMMITS));

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.get"]!;
    const result = await toolDef.execute(
      { project_id: 1, iid: 1 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("**!1 — Fix login bug**");
    expect(result.output).toContain("Fixes the login authentication bug");
    expect(result.metadata).toBeDefined();
    expect((result.metadata! as any).diff_stats).toBeDefined();
    expect((result.metadata! as any).diff_stats.additions).toBe(42);
    expect((result.metadata! as any).commits).toBeDefined();
    expect((result.metadata! as any).commits.length).toBe(1);
  });

  it("handles commits fetch failure gracefully", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockJsonResponse(SAMPLE_SINGLE_MR))
      .mockRejectedValueOnce(new Error("Commits API error"));

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.get"]!;
    const result = await toolDef.execute(
      { project_id: 1, iid: 1 },
      { abort: mockAbort() },
    );

    // Should still return MR details without commits
    expect(result.output).toContain("!1 — Fix login bug");
    expect((result.metadata! as any).commits).toBeUndefined();
  });

  it("respects abort signal", async () => {
    const tools = createMRTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab.mr.get"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      { project_id: 1, iid: 1 },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles 404 when MR not found", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Not found" }, 404),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.get"]!;
    const result = await toolDef.execute(
      { project_id: 1, iid: 999 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Failed to get merge request !999");
    expect(result.output).toContain("404");
  });
});

/* ══════════════════════════════════════════════════════════════════
   gitlab.mr.create
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab.mr.create", () => {
  it("creates a merge request successfully", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_MR_LIST[0]),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.create"]!;
    const result = await toolDef.execute(
      {
        project_id: 1,
        title: "Fix login bug",
        source_branch: "fix-login",
        target_branch: "main",
      },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("created successfully");
    expect(result.output).toContain("**!1** — Fix login bug");

    // Verify POST request was made with correct body
    const requestInit = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as RequestInit;
    expect(requestInit.method).toBe("POST");
    const body = JSON.parse(requestInit.body as string);
    expect(body.title).toBe("Fix login bug");
    expect(body.source_branch).toBe("fix-login");
    expect(body.target_branch).toBe("main");
  });

  it("includes description and draft in request body", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_MR_LIST[1]),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.create"]!;
    await toolDef.execute(
      {
        project_id: 1,
        title: "Add feature flag",
        source_branch: "feat-flags",
        target_branch: "main",
        description: "Implements feature flags",
        draft: true,
      },
      { abort: mockAbort() },
    );

    const requestInit = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.description).toBe("Implements feature flags");
    expect(body.draft).toBe(true);
  });

  it("respects abort signal", async () => {
    const tools = createMRTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab.mr.create"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      {
        project_id: 1,
        title: "Test",
        source_branch: "test",
        target_branch: "main",
      },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });
});

/* ══════════════════════════════════════════════════════════════════
   gitlab.mr.merge
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab.mr.merge", () => {
  it("merges a merge request successfully", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ ...SAMPLE_SINGLE_MR, state: "merged", merged_at: "2025-01-05T00:00:00.000Z" }),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.merge"]!;
    const result = await toolDef.execute(
      { project_id: 1, iid: 1 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("merged successfully");
    expect(result.output).toContain("!1");

    // Verify PUT request was made
    const requestInit = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as RequestInit;
    expect(requestInit.method).toBe("PUT");
  });

  it("passes squash and remove source branch params", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ ...SAMPLE_SINGLE_MR, state: "merged" }),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.merge"]!;
    await toolDef.execute(
      {
        project_id: 1,
        iid: 1,
        merge_strategy: "squash",
        should_remove_source_branch: false,
      },
      { abort: mockAbort() },
    );

    const requestInit = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][2] as RequestInit;
    const body = JSON.parse(requestInit.body as string);
    expect(body.squash).toBe(true);
    expect(body.should_remove_source_branch).toBe(false);
  });

  it("respects abort signal", async () => {
    const tools = createMRTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab.mr.merge"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      { project_id: 1, iid: 1 },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles merge failure with error message", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Merge conflict" }, 409),
    );

    const tools = createMRTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.mr.merge"]!;
    const result = await toolDef.execute(
      { project_id: 1, iid: 1 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Failed to merge");
    expect(result.output).toContain("409");
  });
});
