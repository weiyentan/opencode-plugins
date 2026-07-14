/**
 * Project Tools Tests — GitLab Plugin
 *
 * Tests for gitlab_project_get and gitlab_project_search.
 */
import { describe, it, expect, vi } from "vitest";
import type { GitLabClient } from "../src/client.js";
import { createProjectTools } from "../src/tools/projects.js";

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

const SAMPLE_PROJECT = {
  id: 42,
  name: "my-project",
  name_with_namespace: "group/my-project",
  path_with_namespace: "group/my-project",
  description: "A sample project for testing",
  web_url: "https://gitlab.com/group/my-project",
  visibility: "public",
  topics: ["typescript", "testing"],
  default_branch: "main",
  programming_language: "TypeScript",
  star_count: 15,
  forks_count: 3,
  open_issues_count: 5,
  created_at: "2024-01-01T00:00:00.000Z",
  updated_at: "2025-06-01T00:00:00.000Z",
  last_activity_at: "2025-06-10T00:00:00.000Z",
  archived: false,
  owner: { username: "admin", name: "Admin User" },
  namespace: { name: "group", full_path: "group" },
  avatar_url: null,
  http_url_to_repo: "https://gitlab.com/group/my-project.git",
  ssh_url_to_repo: "git@gitlab.com:group/my-project.git",
  readme_url: "https://gitlab.com/group/my-project/-/blob/main/README.md",
  tag_list: ["typescript", "testing"],
  packages_enabled: true,
  empty_repo: false,
};

const SAMPLE_PROJECTS_SEARCH = [
  SAMPLE_PROJECT,
  {
    ...SAMPLE_PROJECT,
    id: 43,
    name: "my-other-project",
    name_with_namespace: "other-group/my-other-project",
    path_with_namespace: "other-group/my-other-project",
    description: "Another project",
    star_count: 5,
    forks_count: 1,
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
  } as unknown as Response;
}

/* ══════════════════════════════════════════════════════════════════
   gitlab_project_get
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab_project_get", () => {
  it("returns project details in markdown format", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECT),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_get"]!;
    const result = await toolDef.execute(
      { project_id: 42 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("group/my-project");
    expect(result.output).toContain("TypeScript");
    expect(result.output).toContain("15"); // star_count
    expect(result.output).toContain("3"); // forks_count
    expect(result.output).toContain("public");
    expect(result.metadata).toBeDefined();
    expect((result.metadata! as any).id).toBe(42);
    expect((result.metadata! as any)._raw).toEqual(SAMPLE_PROJECT);
  });

  it("handles string project path", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECT),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_get"]!;
    await toolDef.execute(
      { project_id: "group/my-project" },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("group/my-project");
  });

  it("respects abort signal", async () => {
    const tools = createProjectTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab_project_get"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      { project_id: 42 },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles 404 when project not found", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Project not found" }, 404),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_get"]!;
    const result = await toolDef.execute(
      { project_id: 999 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Failed to get project");
    expect(result.output).toContain("404");
  });
});

/* ══════════════════════════════════════════════════════════════════
   gitlab_project_search
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab_project_search", () => {
  it("returns search results in markdown format", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    const result = await toolDef.execute(
      { query: "my-project" },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Project Search Results");
    expect(result.output).toContain("group/my-project");
    expect(result.output).toContain("other-group/my-other-project");
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.count).toBe(2);
  });

  it("includes search query in request", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    await toolDef.execute(
      { query: "typescript", visibility: "public" },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("search=typescript");
    expect(requestUrl).toContain("visibility=public");
  });

  it("returns empty message when no results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse([]),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    const result = await toolDef.execute(
      { query: "nonexistent" },
      { abort: mockAbort() },
    );

    expect(result.output).toContain('No projects found matching "nonexistent"');
  });

  it("respects abort signal", async () => {
    const tools = createProjectTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab_project_search"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      { query: "test" },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles API error response", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Unauthorized" }, 401),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    const result = await toolDef.execute(
      { query: "test" },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Failed to search projects");
    expect(result.output).toContain("401");
  });

  it("includes membership param when provided", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    await toolDef.execute(
      { query: "my-project", membership: true },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("membership=true");
  });

  it("includes owned param when provided", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    await toolDef.execute(
      { query: "my-project", owned: true },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("owned=true");
  });

  it("includes both membership and owned params together", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    await toolDef.execute(
      { query: "my-project", membership: true, owned: true },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("membership=true");
    expect(requestUrl).toContain("owned=true");
  });

  it("does not include membership or owned when not provided", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_search"]!;
    await toolDef.execute(
      { query: "my-project" },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).not.toContain("membership");
    expect(requestUrl).not.toContain("owned");
  });
});

/* ══════════════════════════════════════════════════════════════════
   gitlab_project_list
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab_project_list", () => {
  it("returns a list of projects in markdown format", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_list"]!;
    const result = await toolDef.execute(
      { membership: true },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Your Projects");
    expect(result.output).toContain("group/my-project");
    expect(result.output).toContain("other-group/my-other-project");
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.count).toBe(2);
  });

  it("defaults membership to true", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_list"]!;
    await toolDef.execute({}, { abort: mockAbort() });

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("membership=true");
  });

  it("includes owned param when provided", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_list"]!;
    await toolDef.execute(
      { owned: true },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("owned=true");
  });

  it("includes search param when provided", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_list"]!;
    await toolDef.execute(
      { search: "my-project" },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("search=my-project");
  });

  it("returns empty message when no results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse([]),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_list"]!;
    const result = await toolDef.execute(
      { membership: true },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("No projects found");
  });

  it("respects abort signal", async () => {
    const tools = createProjectTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab_project_list"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      { membership: true },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles API error response", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Unauthorized" }, 401),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_list"]!;
    const result = await toolDef.execute(
      { membership: true },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Failed to list projects");
    expect(result.output).toContain("401");
  });

  it("includes sort and order options", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_PROJECTS_SEARCH),
    );

    const tools = createProjectTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab_project_list"]!;
    await toolDef.execute(
      {
        membership: true,
        order_by: "name",
        sort: "asc",
        per_page: 50,
        visibility: "private",
      },
      { abort: mockAbort() },
    );

    const requestUrl = (client.request as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as string;
    expect(requestUrl).toContain("order_by=name");
    expect(requestUrl).toContain("sort=asc");
    expect(requestUrl).toContain("per_page=50");
    expect(requestUrl).toContain("visibility=private");
  });
});
