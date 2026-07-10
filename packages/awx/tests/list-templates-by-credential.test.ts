/**
 * List Templates By Credential — Unit Tests
 *
 * Validates that listTemplatesByCredential correctly constructs URLs,
 * passes credential_id, handles missing credentials, and follows
 * the same pagination/sorting pattern as list-credentials.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AwxClient } from "../src/client.js";

// Import functions to test
import { listTemplatesByCredential } from "../src/list-templates-by-credential.js";
import type { ListTemplatesByCredentialOutput } from "../src/list-templates-by-credential.js";
import type { TemplateResult } from "../src/list-templates.js";
import type { AwxPageResponse } from "../src/pagination.js";

/* ── Mock client helpers ──────────────────────────────────────── */

/** Raw AWX API response item shape (used to test mapTemplate translation) */
interface RawApiTemplate {
  id: number;
  name: string;
  description: string;
  job_type?: string;
  playbook?: string;
  status?: string;
  last_job_failed?: boolean;
  last_job_run?: string;
  summary_fields?: {
    project?: { id?: number; name?: string };
    inventory?: { id?: number; name?: string };
  };
  [key: string]: unknown;
}

function createRawTemplate(overrides?: Partial<RawApiTemplate>): RawApiTemplate {
  return {
    id: 1,
    name: "template-a",
    description: "Test template",
    job_type: "run",
    playbook: "site.yml",
    status: "successful",
    summary_fields: {
      project: { id: 10, name: "project-a" },
      inventory: { id: 20, name: "inventory-a" },
    },
    ...overrides,
  };
}

interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  data?: Partial<AwxPageResponse<RawApiTemplate>>;
}

function createMockResponse(opts?: MockResponseOptions): Response {
  const {
    ok = true,
    status = 200,
    data = {},
  } = opts ?? {};

  const body: AwxPageResponse<TemplateResult> = {
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
   Tracer Bullet: basic URL construction with credentialId
   ══════════════════════════════════════════════════════════════════ */

describe("listTemplatesByCredential", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs correct URL with credential ID", async () => {
    const client = createMockClient();
    const template = createRawTemplate({ id: 10, name: "deploy-playbook" });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: {
          count: 1,
          results: [template],
          next: null,
        },
      }),
    );

    const result = await listTemplatesByCredential(client, 42);

    expect(result.count).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].name).toBe("deploy-playbook");
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-templates-by-credential",
      "/api/v2/job_templates/?page=1&page_size=50&credentials__id=42",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Credential ID validation
     ══════════════════════════════════════════════════════════════════ */

  it("credentialId parameter is required (type-level contract enforced by TS)", async () => {
    // At the type level, credentialId is required — this test confirms
    // the runtime behavior when a credential ID produces empty results.
    const client = createMockClient();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 0, results: [], next: null },
      }),
    );

    // A valid credential ID with no associated templates
    const result = await listTemplatesByCredential(client, 999);

    expect(result.count).toBe(0);
    expect(result.results).toEqual([]);
    expect(client.request).toHaveBeenCalledWith(
      "awx-list-templates-by-credential",
      "/api/v2/job_templates/?page=1&page_size=50&credentials__id=999",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Error handling — non-existent credential (generic AWX API error)
     ══════════════════════════════════════════════════════════════════ */

  it("throws generic AWX API error for 404 from job_templates endpoint", async () => {
    const client = createMockClient();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 404 }),
    );

    await expect(listTemplatesByCredential(client, 999)).rejects.toThrow(
      "AWX API error: 404 Error",
    );
  });

  it("throws descriptive error for unauthorized access (403)", async () => {
    const client = createMockClient();

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 403 }),
    );

    await expect(listTemplatesByCredential(client, 42)).rejects.toThrow(
      "Not authorized to access credential 42",
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Pagination — multiple pages
     ══════════════════════════════════════════════════════════════════ */

  it("fetches multiple pages and consolidates results", async () => {
    const client = createMockClient();
    const page1 = [
      createRawTemplate({ id: 1, name: "a-template" }),
      createRawTemplate({ id: 2, name: "b-template" }),
    ];
    const page2 = [
      createRawTemplate({ id: 3, name: "c-template" }),
    ];

    (client.request as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 3, results: page1, next: "/api/v2/job_templates/?page=2&credentials__id=42" },
        }),
      )
      .mockResolvedValueOnce(
        createMockResponse({
          data: { count: 3, results: page2, next: null },
        }),
      );

    const result = await listTemplatesByCredential(client, 42);

    expect(result.count).toBe(3);
    expect(result.results).toHaveLength(3);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  /* ══════════════════════════════════════════════════════════════════
     Page cap warning
     ══════════════════════════════════════════════════════════════════ */

  it("returns warning when page cap is reached with more pages available", async () => {
    const client = createMockClient();
    for (let i = 0; i < 3; i++) {
      (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        createMockResponse({
          data: {
            count: 30,
            results: [createRawTemplate({ id: i + 1, name: `template-${String.fromCharCode(97 + i)}` })],
            next: i < 2 ? `/api/v2/job_templates/?page=${i + 2}&credentials__id=42` : null,
          },
        }),
      );
    }

    const result = await listTemplatesByCredential(client, 42, { maxPages: 2 });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(2);
    expect(result.warning).toBe("More items exist. Increase max-pages or use a filter.");
  });

  /* ══════════════════════════════════════════════════════════════════
     Sorting — results sorted by name
     ══════════════════════════════════════════════════════════════════ */

  it("sorts results alphabetically by name", async () => {
    const client = createMockClient();
    const templates = [
      createRawTemplate({ id: 3, name: "z-playbook" }),
      createRawTemplate({ id: 1, name: "alpha-deploy" }),
      createRawTemplate({ id: 2, name: "beta-deploy" }),
    ];

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 3, results: templates, next: null },
      }),
    );

    const result = await listTemplatesByCredential(client, 42);

    expect(result.results[0].name).toBe("alpha-deploy");
    expect(result.results[1].name).toBe("beta-deploy");
    expect(result.results[2].name).toBe("z-playbook");
  });

  /* ══════════════════════════════════════════════════════════════════
     Custom options — pageSize, maxPages
     ══════════════════════════════════════════════════════════════════ */

  it("uses custom page size when provided", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ data: { count: 0, results: [], next: null } }),
    );

    await listTemplatesByCredential(client, 42, { pageSize: 10 });

    expect(client.request).toHaveBeenCalledWith(
      "awx-list-templates-by-credential",
      "/api/v2/job_templates/?page=1&page_size=10&credentials__id=42",
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Error handling — non-ok response (non-auth)
     ══════════════════════════════════════════════════════════════════ */

  it("throws generic error for unknown 500 status", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ ok: false, status: 500 }),
    );

    await expect(listTemplatesByCredential(client, 42)).rejects.toThrow(
      "AWX API error: 500 Error",
    );
  });

  /* ══════════════════════════════════════════════════════════════════
     Abort propagation
     ══════════════════════════════════════════════════════════════════ */

  it("propagates abort signal", async () => {
    const client = createMockClient();
    const controller = new AbortController();
    controller.abort(new DOMException("Manually aborted", "AbortError"));

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({ data: { count: 1, results: [createRawTemplate()], next: null } }),
    );

    await expect(
      listTemplatesByCredential(client, 42, { abortSignal: controller.signal }),
    ).rejects.toThrow(DOMException);
  });

  /* ══════════════════════════════════════════════════════════════════
     Output type matches TemplateResult shape
     ══════════════════════════════════════════════════════════════════ */

  it("returns results matching TemplateResult shape", async () => {
    const client = createMockClient();
    const rawItem = createRawTemplate({
      id: 5,
      name: "prod-deploy",
      description: "Production deployment",
      job_type: "run",
      playbook: "deploy.yml",
      status: "successful",
      summary_fields: {
        project: { id: 10, name: "prod-project" },
        inventory: { id: 20, name: "prod-inventory" },
      },
    });

    (client.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      createMockResponse({
        data: { count: 1, results: [rawItem], next: null },
      }),
    );

    const result = await listTemplatesByCredential(client, 42);

    expect(result.results[0]).toEqual<TemplateResult>({
      id: 5,
      name: "prod-deploy",
      description: "Production deployment",
      job_type: "run",
      playbook: "deploy.yml",
      status: "successful",
      project_name: "prod-project",
      inventory_name: "prod-inventory",
    });
  });
});
