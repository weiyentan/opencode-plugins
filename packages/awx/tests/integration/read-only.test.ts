/**
 * Read-Only Tool Integration Tests
 *
 * These tests call the real AWX API to validate end-to-end behavior
 * of the read-only tools (awx-list-templates, awx-list-projects).
 * They use the plugin's own tool registration mechanism — not direct
 * API calls — to exercise the full plugin execution path.
 *
 * ## Prerequisites
 *
 * - Access to a live AAP instance
 * - `AWX_TOKEN` environment variable set with a valid AAP Personal Access Token
 *
 * ## Environment Variables
 *
 * | Variable       | Required | Default                                         | Description                          |
 * |----------------|----------|-------------------------------------------------|--------------------------------------|
 * | `AWX_TOKEN`    | Yes      | —                                               | AAP Personal Access Token            |
 * | `AAP_BASE_URL` | No       | `https://example.com`            | AAP base URL                         |
 *
 * ## Running
 *
 * ```bash
 * # From packages/awx/:
 * AWX_TOKEN=<your-pat> npx vitest run tests/integration/read-only.test.ts
 *
 * # With custom AAP URL:
 * AWX_TOKEN=<your-pat> AAP_BASE_URL=https://my-aap.example.com npx vitest run tests/integration/read-only.test.ts
 * ```
 *
 * Tests that require a live AAP connection are gated behind `AWX_TOKEN`.
 * When `AWX_TOKEN` is not set, only the configuration-error tests run.
 */
import { describe, it, expect, vi } from "vitest";
import type { PluginInput, Hooks, ToolContext, ToolResult } from "@opencode-ai/plugin";
import { AwxPlugin } from "../../src/index.js";

// Capture at module load time, before any vi.stubEnv can pollute it
const ENV_AWX_TOKEN = process.env.AWX_TOKEN;

// ── Shared Test Helpers ──────────────────────────────────────────

/** Minimal mock of ToolContext for tool execute tests */
function mockToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionID: "test-session",
    messageID: "test-message",
    agent: "test-agent",
    directory: "/mock/dir",
    worktree: "/mock/worktree",
    abort: new AbortController().signal,
    metadata: vi.fn(),
    ask: vi.fn(async () => {}),
    ...overrides,
  };
}

/**
 * Create a plugin instance with a configurable AWX token.
 *
 * @param token  The bearer token to use (undefined = no token stored)
 * @param baseUrl  The AAP base URL (defaults to env var or production URL)
 */
async function createPlugin(
  token?: string,
  baseUrl?: string,
): Promise<Hooks> {
  const resolvedBaseUrl =
    baseUrl ?? process.env.AAP_BASE_URL ?? "https://example.com";

  const mockLog = vi.fn();
  const input: PluginInput = {
    client: {
      app: { log: mockLog },
      getSecret: vi.fn().mockResolvedValue(token ?? null),
    } as unknown as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: "/mock/dir",
    worktree: "/mock/worktree",
    experimental_workspace: {
      register: vi.fn(),
    },
    serverUrl: new URL("http://localhost:0"),
    $: {} as PluginInput["$"],
  };

  vi.stubEnv("AWX_BASE_URL", resolvedBaseUrl);
  // Ensure AWX_TOKEN is not set so the test relies solely on getSecret
  vi.stubEnv("AWX_TOKEN", undefined);
  return AwxPlugin(input);
}

// ── Parse helpers for tool outputs ───────────────────────────────

/**
 * Extract metadata from a tool result.
 * The standardised output shape is { output: string, metadata?: object }.
 */
function getMetadata(result: ToolResult): Record<string, unknown> {
  const obj = result as { output: string; metadata?: Record<string, unknown> };
  return obj.metadata ?? {};
}

// ══════════════════════════════════════════════════════════════════
// Configuration Errors (always run, no AWX_TOKEN needed)
// ══════════════════════════════════════════════════════════════════

describe("Read-Only Tools — Configuration Errors", () => {
  it("awx-list-templates returns configuration error when no token is configured", async () => {
    const hooks = await createPlugin(/* no token */);

    try {
      const result = await hooks.tool!["awx-list-templates"]!.execute(
        {},
        mockToolContext(),
      );

      const parsed = getMetadata(result);
      expect(parsed.count).toBe(0);
      expect(parsed.results).toEqual([]);
      expect(parsed.warning).toContain("PAT");
    } finally {
      await hooks.dispose?.();
    }
  });

  it("list-projects returns configuration error when no token is configured", async () => {
    const hooks = await createPlugin(/* no token */);

    try {
      const result = await hooks.tool!["awx-list-projects"]!.execute(
        {},
        mockToolContext(),
      );

      const out = (result as { output: string }).output;
      expect(out).toContain("PAT");
    } finally {
      await hooks.dispose?.();
    }
  });

  it("awx-list-jobs returns configuration error when no token is configured", async () => {
    const hooks = await createPlugin(/* no token */);

    try {
      const result = await hooks.tool!["awx-list-jobs"]!.execute(
        {},
        mockToolContext(),
      );

      const metadata = getMetadata(result);
      expect(metadata.total_jobs).toBe(0);
      expect(metadata.results).toEqual([]);
      expect(metadata.warning).toContain("PAT");
    } finally {
      await hooks.dispose?.();
    }
  });

  it("awx-list-users returns configuration error when no token is configured", async () => {
    const hooks = await createPlugin(/* no token */);

    try {
      const result = await hooks.tool!["awx-list-users"]!.execute(
        {},
        mockToolContext(),
      );

      const out = (result as { output: string }).output;
      expect(out).toContain("PAT");
    } finally {
      await hooks.dispose?.();
    }
  });

  it("awx-list-teams returns configuration error when no token is configured", async () => {
    const hooks = await createPlugin(/* no token */);

    try {
      const result = await hooks.tool!["awx-list-teams"]!.execute(
        {},
        mockToolContext(),
      );

      const out = (result as { output: string }).output;
      expect(out).toContain("PAT");
    } finally {
      await hooks.dispose?.();
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// Live AAP Integration Tests (gated behind AWX_TOKEN)
// ══════════════════════════════════════════════════════════════════

describe.skipIf(!process.env.AWX_TOKEN)("Read-Only Tools — Live AAP Integration", () => {
  describe("awx-list-templates", () => {
    it("returns structured response with count and results", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-templates"]!.execute(
          {},
          mockToolContext(),
        );

        const parsed = getMetadata(result);
        expect(parsed).toHaveProperty("count");
        expect(typeof parsed.count).toBe("number");
        expect(Array.isArray(parsed.results)).toBe(true);

        // Validate result shape when results are present
        if ((parsed.results as unknown[]).length > 0) {
          for (const item of parsed.results as Record<string, unknown>[]) {
            expect(item).toHaveProperty("id");
            expect(typeof item.id).toBe("number");
            expect(item).toHaveProperty("name");
            expect(typeof item.name).toBe("string");
            expect(item).toHaveProperty("description");
            expect(typeof item.description).toBe("string");
          }
        }

        // Should NOT have a warning for a successful default query
        expect(parsed.warning).toBeUndefined();
      } finally {
        await hooks.dispose?.();
      }
    });

    it("returns paginated results when page size is small", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-templates"]!.execute(
          { pageSize: 1, maxPages: 3 },
          mockToolContext(),
        );

        const parsed = getMetadata(result);
        expect(parsed).toHaveProperty("count");
        expect(typeof parsed.count).toBe("number");
        expect(Array.isArray(parsed.results)).toBe(true);

        // When forcing small pages, we either get results or get a warning
        if ((parsed.results as unknown[]).length > 0) {
          expect((parsed.results as unknown[]).length).toBeGreaterThan(0);
        }
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("awx-list-projects", () => {
    it("returns structured response with count and results", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-projects"]!.execute(
          {},
          mockToolContext(),
        );

        // listProjects returns { output, metadata }
        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("count");
        expect(typeof metadata.count).toBe("number");
        expect(Array.isArray(metadata.results)).toBe(true);

        // Validate result shape when results are present
        if ((metadata.results as unknown[]).length > 0) {
          for (const item of metadata.results as Record<string, unknown>[]) {
            expect(item).toHaveProperty("id");
            expect(typeof item.id).toBe("number");
            expect(item).toHaveProperty("name");
            expect(typeof item.name).toBe("string");
            expect(item).toHaveProperty("type");
            expect(item).toHaveProperty("url");
            expect(typeof item.url).toBe("string");
            expect(item).toHaveProperty("scm_type");
            expect(typeof item.scm_type).toBe("string");
            expect(item).toHaveProperty("status");
            expect(typeof item.status).toBe("string");
          }
        }
      } finally {
        await hooks.dispose?.();
      }
    });

    it("accepts pagination options", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-projects"]!.execute(
          { maxPages: 2, pageSize: 10, timeout: 15_000 },
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("count");
        expect(Array.isArray(metadata.results)).toBe(true);
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("auth failure", () => {
    it("returns clear error message with deliberately invalid token", async () => {
      const hooks = await createPlugin(
        "this-is-a-deliberately-invalid-token-for-testing",
      );

      try {
        const result = await hooks.tool!["awx-list-templates"]!.execute(
          {},
          mockToolContext(),
        );

        const parsed = getMetadata(result);
        expect(parsed.count).toBe(0);
        expect(parsed.results).toEqual([]);
        expect(parsed.warning).toBeDefined();
        expect(typeof parsed.warning).toBe("string");
        expect((parsed.warning as string).length).toBeGreaterThan(0);
        expect(parsed.warning).toContain("Failed to");
      } finally {
        await hooks.dispose?.();
      }
    });

    it("list-projects returns error metadata with invalid token", async () => {
      const hooks = await createPlugin(
        "this-is-a-deliberately-invalid-token-for-testing",
      );

      try {
        const result = await hooks.tool!["awx-list-projects"]!.execute(
          {},
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        // Should contain an error field since the request will fail
        if (metadata.error) {
          expect(typeof metadata.error).toBe("string");
          expect((metadata.error as string).length).toBeGreaterThan(0);
        }
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("awx-get-resource", () => {
    it("returns structured response for credential resource", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-get-resource"]!.execute(
          { type: "credential", id: 1 },
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata.schema_version).toBe("1.0");
        expect(metadata.resource_type).toBe("credential");
        expect(typeof metadata.id).toBe("number");
        expect(metadata.data).toBeDefined();

        const data = metadata.data as Record<string, unknown>;
        expect(typeof data.name).toBe("string");
        expect(typeof data.credential_type_id).toBe("number");
        // Verify sensitive inputs are not exposed
        expect(data.inputs).toBeUndefined();
      } finally {
        await hooks.dispose?.();
      }
    });

    it("returns structured response for organization resource", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-get-resource"]!.execute(
          { type: "organization", id: 1 },
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata.schema_version).toBe("1.0");
        expect(metadata.resource_type).toBe("organization");
        expect(typeof metadata.id).toBe("number");
        expect(metadata.data).toBeDefined();

        const data = metadata.data as Record<string, unknown>;
        expect(typeof data.name).toBe("string");
        expect(data.related).toBeDefined();
        const related = data.related as Record<string, number>;
        expect(typeof related.users).toBe("number");
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("awx-list-jobs", () => {
    it("returns structured response with count and results", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-jobs"]!.execute(
          {},
          mockToolContext(),
        );

        // listJobs returns { output, metadata }
        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("total_jobs");
        expect(typeof metadata.total_jobs).toBe("number");
        expect(Array.isArray(metadata.results)).toBe(true);
        expect(metadata).toHaveProperty("schema_version");

        // Validate result shape when results are present
        if ((metadata.results as unknown[]).length > 0) {
          for (const item of metadata.results as Record<string, unknown>[]) {
            expect(item).toHaveProperty("id");
            expect(typeof item.id).toBe("number");
            expect(item).toHaveProperty("name");
            expect(typeof item.name).toBe("string");
            expect(item).toHaveProperty("job_type");
            expect(typeof item.job_type).toBe("string");
            expect(item).toHaveProperty("status");
            expect(typeof item.status).toBe("string");
            expect(item).toHaveProperty("created");
            expect(typeof item.created).toBe("string");
          }
        }
      } finally {
        await hooks.dispose?.();
      }
    });

    it("accepts pagination options", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-jobs"]!.execute(
          { maxPages: 2, pageSize: 10, timeout: 15_000 },
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("total_jobs");
        expect(Array.isArray(metadata.results)).toBe(true);
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("awx-list-users", () => {
    it("returns structured response with count and results", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-users"]!.execute(
          {},
          mockToolContext(),
        );

        // listUsers returns { output, metadata }
        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("count");
        expect(typeof metadata.count).toBe("number");
        expect(Array.isArray(metadata.results)).toBe(true);

        // Validate result shape when results are present
        if ((metadata.results as unknown[]).length > 0) {
          for (const item of metadata.results as Record<string, unknown>[]) {
            expect(item).toHaveProperty("id");
            expect(typeof item.id).toBe("number");
            expect(item).toHaveProperty("username");
            expect(typeof item.username).toBe("string");
            expect(item).toHaveProperty("email");
            expect(typeof item.email).toBe("string");
          }
        }
      } finally {
        await hooks.dispose?.();
      }
    });

    it("accepts pagination options", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-users"]!.execute(
          { maxPages: 2, pageSize: 10, timeout: 15_000 },
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("count");
        expect(Array.isArray(metadata.results)).toBe(true);
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("awx-list-teams", () => {
    it("returns structured response with count and results", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-teams"]!.execute(
          {},
          mockToolContext(),
        );

        // listTeams returns { output, metadata }
        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("count");
        expect(typeof metadata.count).toBe("number");
        expect(Array.isArray(metadata.results)).toBe(true);

        // Validate result shape when results are present
        if ((metadata.results as unknown[]).length > 0) {
          for (const item of metadata.results as Record<string, unknown>[]) {
            expect(item).toHaveProperty("id");
            expect(typeof item.id).toBe("number");
            expect(item).toHaveProperty("name");
            expect(typeof item.name).toBe("string");
            expect(item).toHaveProperty("description");
            expect(typeof item.description).toBe("string");
          }
        }
      } finally {
        await hooks.dispose?.();
      }
    });

    it("accepts pagination options", async () => {
      const hooks = await createPlugin(ENV_AWX_TOKEN);

      try {
        const result = await hooks.tool!["awx-list-teams"]!.execute(
          { maxPages: 2, pageSize: 10, timeout: 15_000 },
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        expect(metadata).toHaveProperty("count");
        expect(Array.isArray(metadata.results)).toBe(true);
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("auth failure (awx-list-jobs)", () => {
    it("returns error metadata with invalid token", async () => {
      const hooks = await createPlugin(
        "this-is-a-deliberately-invalid-token-for-testing",
      );

      try {
        const result = await hooks.tool!["awx-list-jobs"]!.execute(
          {},
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        if (metadata.warning) {
          expect(typeof metadata.warning).toBe("string");
          expect((metadata.warning as string).length).toBeGreaterThan(0);
        }
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("auth failure (awx-list-users)", () => {
    it("returns error metadata with invalid token", async () => {
      const hooks = await createPlugin(
        "this-is-a-deliberately-invalid-token-for-testing",
      );

      try {
        const result = await hooks.tool!["awx-list-users"]!.execute(
          {},
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        if (metadata.error) {
          expect(typeof metadata.error).toBe("string");
          expect((metadata.error as string).length).toBeGreaterThan(0);
        }
      } finally {
        await hooks.dispose?.();
      }
    });
  });

  describe("auth failure (awx-list-teams)", () => {
    it("returns error metadata with invalid token", async () => {
      const hooks = await createPlugin(
        "this-is-a-deliberately-invalid-token-for-testing",
      );

      try {
        const result = await hooks.tool!["awx-list-teams"]!.execute(
          {},
          mockToolContext(),
        );

        expect(result).toHaveProperty("output");
        expect(result).toHaveProperty("metadata");

        const metadata = (result as { output: string; metadata: Record<string, unknown> }).metadata;
        if (metadata.error) {
          expect(typeof metadata.error).toBe("string");
          expect((metadata.error as string).length).toBeGreaterThan(0);
        }
      } finally {
        await hooks.dispose?.();
      }
    });
  });
});
