/**
 * List Workflow Templates Tool Tests
 *
 * Validates pagination, timeout budget, page cap, sorting,
 * and error handling for the awx-list-workflow-templates tool.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listWorkflowTemplates } from "../src/list-workflow-templates.js";
import type { WorkflowTemplate, ListWorkflowTemplatesOutput } from "../src/list-workflow-templates.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

function createMockWorkflowTemplate(overrides?: Partial<WorkflowTemplate>): WorkflowTemplate {
  return {
    id: 1,
    name: "workflow-a",
    description: "Test workflow job template",
    url: "/api/v2/workflow_job_templates/1/",
    related: {},
    summary_fields: {},
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<WorkflowTemplate>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<WorkflowTemplate> = {
    count: data.count ?? 0,
    next: data.next ?? null,
    previous: data.previous ?? null,
    results: data.results ?? [],
  };

  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: () => Promise.resolve(body),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as Response;
}

function createMockClient(): AwxClient {
  return {
    request: vi.fn(),
  };
}

/* ══════════════════════════════════════════════════════════════════
   Tracer Bullet: basic listWorkflowTemplates shape
   ══════════════════════════════════════════════════════════════════ */

describe("listWorkflowTemplates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty results when no workflow templates exist", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 0,
          results: [],
          next: null,
        },
      }),
    );

    const result = await listWorkflowTemplates(client);

    expect(result).toEqual<Partial<ListWorkflowTemplatesOutput>>({
      count: 0,
      results: [],
    });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-workflow-templates",
      "/api/v2/workflow_job_templates/?page=1&page_size=50",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  it("returns a single page of workflow templates", async () => {
    const client = createMockClient();
    const tmpl1 = createMockWorkflowTemplate({ id: 1, name: "workflow-a" });
    const tmpl2 = createMockWorkflowTemplate({ id: 2, name: "workflow-b" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 2,
          results: [tmpl1, tmpl2],
          next: null,
        },
      }),
    );

    const result = await listWorkflowTemplates(client);

    expect(result.count).toBe(2);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].name).toBe("workflow-a");
    expect(result.results[1].name).toBe("workflow-b");
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination Loop — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1Templates = [
      createMockWorkflowTemplate({ id: 1, name: "workflow-a" }),
      createMockWorkflowTemplate({ id: 2, name: "workflow-b" }),
    ];
    const page2Templates = [
      createMockWorkflowTemplate({ id: 3, name: "workflow-c" }),
      createMockWorkflowTemplate({ id: 4, name: "workflow-d" }),
    ];
    const page3Templates = [
      createMockWorkflowTemplate({ id: 5, name: "workflow-e" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page1Templates,
          next: "/api/v2/workflow_job_templates/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page2Templates,
          next: "/api/v2/workflow_job_templates/?page=3",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 5,
          results: page3Templates,
          next: null,
        },
      }),
    );

    const result = await listWorkflowTemplates(client);

    expect(result.count).toBe(5);
    expect(result.results).toHaveLength(5);
    expect(client.request).toHaveBeenCalledTimes(3);
    expect(client.request).toHaveBeenNthCalledWith(1, "awx-list-workflow-templates", "/api/v2/workflow_job_templates/?page=1&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(2, "awx-list-workflow-templates", "/api/v2/workflow_job_templates/?page=2&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(client.request).toHaveBeenNthCalledWith(3, "awx-list-workflow-templates", "/api/v2/workflow_job_templates/?page=3&page_size=50", expect.any(Object), expect.any(AbortSignal));
    expect(result.warning).toBeUndefined();
  });

  it("stops pagination when next is null (last page)", async () => {
    const client = createMockClient();
    const page1Templates = [createMockWorkflowTemplate({ id: 1, name: "workflow-a" })];
    const page2Templates: WorkflowTemplate[] = [];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page1Templates, next: "/api/v2/workflow_job_templates/?page=2" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 1, results: page2Templates, next: null },
        }),
      );

    const result = await listWorkflowTemplates(client);

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Cap — limited by maxPages (default: 5)
     ══════════════════════════════════════════════════════════════════ */

  it("respects maxPages cap and returns warning when more pages exist", async () => {
    const client = createMockClient();
    for (let i = 0; i < 6; i++) {
      (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 60,
            results: [createMockWorkflowTemplate({ id: i + 1, name: `workflow-${String.fromCharCode(97 + i)}` })],
            next: i < 5 ? `/api/v2/workflow_job_templates/?page=${i + 2}` : null,
          },
        }),
      );
    }

    const result = await listWorkflowTemplates(client, { maxPages: 3 });

    expect(client.request).toHaveBeenCalledTimes(3);
    expect(result.results).toHaveLength(3);
    expect(result.warning).toBe("More items exist. Increase max-pages or use a filter.");
  });

  it("does not include warning when all pages are fetched before cap", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockWorkflowTemplate({ id: 1, name: "workflow-a" })],
            next: "/api/v2/workflow_job_templates/?page=2",
          },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 2,
            results: [createMockWorkflowTemplate({ id: 2, name: "workflow-b" })],
            next: null,
          },
        }),
      );

    const result = await listWorkflowTemplates(client, { maxPages: 5 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const templates = [
      createMockWorkflowTemplate({ id: 3, name: "z-workflow" }),
      createMockWorkflowTemplate({ id: 1, name: "alpha-workflow" }),
      createMockWorkflowTemplate({ id: 2, name: "beta-workflow" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 3,
          results: templates,
          next: null,
        },
      }),
    );

    const result = await listWorkflowTemplates(client);

    expect(result.results[0].name).toBe("alpha-workflow");
    expect(result.results[1].name).toBe("beta-workflow");
    expect(result.results[2].name).toBe("z-workflow");
  });

  it("sorts across paginated results", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockWorkflowTemplate({ id: 3, name: "c-workflow" }),
            createMockWorkflowTemplate({ id: 1, name: "a-workflow" }),
          ],
          next: "/api/v2/workflow_job_templates/?page=2",
        },
      }),
    );
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 4,
          results: [
            createMockWorkflowTemplate({ id: 4, name: "d-workflow" }),
            createMockWorkflowTemplate({ id: 2, name: "b-workflow" }),
          ],
          next: null,
        },
      }),
    );

    const result = await listWorkflowTemplates(client);

    expect(result.results).toHaveLength(4);
    expect(result.results[0].name).toBe("a-workflow");
    expect(result.results[1].name).toBe("b-workflow");
    expect(result.results[2].name).toBe("c-workflow");
    expect(result.results[3].name).toBe("d-workflow");
  });

  /* ══════════════════════════════════════════════════════════════════
     Page Size — custom page_size parameter
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    const templates = [createMockWorkflowTemplate({ id: 1, name: "workflow-a" })];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: templates, next: null },
      }),
    );

    await listWorkflowTemplates(client, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-workflow-templates",
      "/api/v2/workflow_job_templates/?page=1&page_size=10",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Error Handling
     ══════════════════════════════════════════════════════════════════ */

  it("throws when a page request fails with non-ok status", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 500 }),
    );

    await expect(listWorkflowTemplates(client)).rejects.toThrow(
      "Failed to fetch workflow job templates: 500 Error",
    );
  });

  it("propagates abort error when tool context is aborted", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [createMockWorkflowTemplate()], next: null },
      }),
    );

    await expect(
      listWorkflowTemplates(client, { abortSignal: controller.signal }),
    ).rejects.toThrow(DOMException);
  });

  /* ══════════════════════════════════════════════════════════════════
     Timeout Budget — per-page timeout enforcement
     ══════════════════════════════════════════════════════════════════ */

  it("throws timeout error when page request exceeds per-page budget", async () => {
    vi.useFakeTimers();

    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockImplementation(
      (_toolName: string, _path: string, _init: unknown, signal?: AbortSignal) => {
        return new Promise<Response>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      },
    );

    const listPromise = listWorkflowTemplates(client, { timeout: 6_000, maxPages: 2 });
    listPromise.catch(() => {});

    await vi.advanceTimersByTimeAsync(2_001);

    await expect(listPromise).rejects.toThrow("timed out after");
    vi.useRealTimers();
  });

  /* ══════════════════════════════════════════════════════════════════
     Filter Parameter — server-side filtering via query params
     ══════════════════════════════════════════════════════════════════ */

  it("passes filter params in the request URL", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    await listWorkflowTemplates(client, { filters: ["name__icontains=prod"] });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-workflow-templates",
      "/api/v2/workflow_job_templates/?page=1&page_size=50&name__icontains=prod",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
