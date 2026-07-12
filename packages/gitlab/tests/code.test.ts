/**
 * Code Search Tool Tests — GitLab Plugin
 *
 * Tests for gitlab.code.search.
 */
import { describe, it, expect, vi } from "vitest";
import type { GitLabClient } from "../src/client.js";
import { createCodeTools } from "../src/tools/code.js";

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

const SAMPLE_CODE_RESULTS = [
  {
    filename: "main.ts",
    path: "src/main.ts",
    ref: "main",
    language: "typescript",
    data: "function hello(): void {\n  console.log('hello world');\n}",
    startline: 1,
    project_id: 42,
  },
  {
    filename: "utils.ts",
    path: "src/utils.ts",
    ref: "main",
    language: "typescript",
    data: "export function parseConfig(): Config {\n  return JSON.parse(config);\n}",
    startline: 10,
    project_id: 42,
  },
];

const SAMPLE_PYTHON_RESULT = [
  {
    filename: "main.py",
    path: "src/main.py",
    ref: "main",
    language: "python",
    data: "def hello():\n    print('hello world')",
    startline: 1,
    project_id: 43,
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
   gitlab.code.search
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab.code.search", () => {
  it("returns code search results in markdown format", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_CODE_RESULTS),
    );

    const tools = createCodeTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.code.search"]!;
    const result = await toolDef.execute(
      { query: "hello", project_id: 42 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Code Search Results");
    expect(result.output).toContain("src/main.ts");
    expect(result.output).toContain("src/utils.ts");
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.count).toBe(2);
    expect((result.metadata! as any).query).toBe("hello");
  });

  it("filters by language when specified", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse([...SAMPLE_CODE_RESULTS, ...SAMPLE_PYTHON_RESULT]),
    );

    const tools = createCodeTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.code.search"]!;
    const result = await toolDef.execute(
      { query: "hello", project_id: 42, language: "python" },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("src/main.py");
    expect(result.output).not.toContain("src/main.ts");
    expect(result.metadata!.count).toBe(1);
  });

  it("returns empty message when no results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse([]),
    );

    const tools = createCodeTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.code.search"]!;
    const result = await toolDef.execute(
      { query: "nonexistent", project_id: 42 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("No code results found");
  });

  it("respects abort signal", async () => {
    const tools = createCodeTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab.code.search"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute(
      { query: "test", project_id: 42 },
      { abort: controller.signal },
    );

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles API error response", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Forbidden" }, 403),
    );

    const tools = createCodeTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.code.search"]!;
    const result = await toolDef.execute(
      { query: "test", project_id: 42 },
      { abort: mockAbort() },
    );

    expect(result.output).toContain("Failed to search code");
    expect(result.output).toContain("403");
  });

  it("handles client initialization failure", async () => {
    const tools = createCodeTools(() =>
      Promise.reject(new Error("No token configured")),
    );
    const toolDef = tools["gitlab.code.search"]!;
    const result = await toolDef.execute(
      { query: "test", project_id: 42 },
      { abort: mockAbort() },
    );

    expect(result.output).toBe("No token configured");
  });
});
