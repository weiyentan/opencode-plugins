/**
 * Integration Tests: AWX Job Lifecycle
 *
 * Tests the real AWX job lifecycle end-to-end using the plugin's own
 * tool registration mechanism (hooks.tool): awx-launch-job →
 * awx-job-status → awx-wait-job → awx-get-job-events.
 *
 * ## Gating
 *
 * All tests are gated behind the AWX_TOKEN environment variable.
 * If AWX_TOKEN is not set, the entire suite is silently skipped.
 * No mock data is used — tests interact with a real AAP instance.
 *
 * ## Prerequisites
 *
 * | Env Var | Default | Description |
 * |---------|---------|-------------|
 * | `AWX_TOKEN` | *(required)* | Valid AAP Personal Access Token (PAT) |
 * | `AAP_BASE_URL` | `https://example.com` | Base URL of the AAP instance |
 * | `JOB_TEMPLATE_ID` | `10` | Non-production AWX job template ID to launch |
 * | `EXTRA_VARS_INVENTORY` | `"test"` | Inventory name for extra_vars |
 * | `EXTRA_VARS_SCM_URL` | `"https://github.com/example/repo.git"` | SCM URL for extra_vars |
 * | `EXTRA_VARS_SCM_BRANCH` | `"main"` | SCM branch for extra_vars |
 *
 * ## Run
 *
 * ```bash
 * export AWX_TOKEN=your_pat_token_here
 * export JOB_TEMPLATE_ID=27    # non-production template ID
 * npx vitest run tests/integration/job-lifecycle.test.ts
 * ```
 *
 * ## Important
 *
 * - **Use a NON-PRODUCTION job template.** The launch tool starts a real
 *   job on AAP every time these tests run.
 * - The extra_vars must match what the selected job template expects.
 *   By default, the plugin's transforms pipeline requires `inventory`,
 *   `scm_url`, and `scm_branch` — configure them via env vars if needed.
 * - Jobs are NOT automatically cancelled after the test run. If the
 *   launched job runs for a long time, cancel it manually in the AAP UI.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../../src/index.js";

// ── Environment Configuration ──────────────────────────────────

const AWX_TOKEN = process.env.AWX_TOKEN;
const AAP_BASE_URL =
  process.env.AAP_BASE_URL ?? "https://example.com";
const JOB_TEMPLATE_ID = Number(process.env.JOB_TEMPLATE_ID) || 10;
const EXTRA_VARS: Record<string, string> = {
  inventory: process.env.EXTRA_VARS_INVENTORY ?? "test",
  scm_url: process.env.EXTRA_VARS_SCM_URL ?? "https://github.com/example/repo.git",
  scm_branch: process.env.EXTRA_VARS_SCM_BRANCH ?? "main",
};

// ── Test Helpers ───────────────────────────────────────────────

/** Minimal ToolContext mock for tool execute calls. */
function mockToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    sessionID: "integration-test",
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
 * Create a PluginInput that returns the AWX_TOKEN from the environment.
 * The getSecret mock always resolves to AWX_TOKEN so the lazy client
 * resolver picks it up on every tool invocation.
 */
function createPluginInput(): PluginInput {
  return {
    client: {
      app: { log: vi.fn() },
      getSecret: vi
        .fn<(key: string) => Promise<string | undefined>>()
        .mockResolvedValue(AWX_TOKEN),
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
}

/**
 * Create plugin hooks with the real AAP instance configuration.
 * Sets AWX_BASE_URL from the environment before creating the plugin.
 */
async function createHooks(): Promise<Hooks> {
  vi.stubEnv("AWX_BASE_URL", AAP_BASE_URL);
  return AwxPlugin(createPluginInput());
}

/**
 * Extract metadata from a standardised tool result { output, metadata }.
 */
function getMetadata(result: unknown): Record<string, unknown> {
  const obj = result as { output: string; metadata?: Record<string, unknown> };
  return obj.metadata ?? {};
}

// ── Integration Tests ──────────────────────────────────────────

/**
 * The entire suite is gated behind AWX_TOKEN using describe.skipIf.
 * When AWX_TOKEN is not set, all tests are skipped silently.
 * When AWX_TOKEN is set, each test makes real HTTP requests to the
 * configured AAP instance.
 */
describe.skipIf(!AWX_TOKEN)("AWX Job Lifecycle Integration", () => {
  let hooks: Hooks;

  beforeAll(async () => {
    hooks = await createHooks();
  });

  afterAll(async () => {
    await hooks?.dispose?.();
  });

  /* ═══════════════════════════════════════════════════════════════
     Tool Registration (smoke test)
     ═══════════════════════════════════════════════════════════════ */

  it("creates a plugin instance with all lifecycle tools registered", () => {
    expect(hooks.tool).toBeDefined();
    expect(hooks.tool!["awx-launch-job"]).toBeDefined();
    expect(hooks.tool!["awx-job-status"]).toBeDefined();
    expect(hooks.tool!["awx-wait-job"]).toBeDefined();
    expect(hooks.tool!["awx-get-job-events"]).toBeDefined();
  });

  /* ═══════════════════════════════════════════════════════════════
     Lifecycle Step 1: Launch a Job
     ═══════════════════════════════════════════════════════════════ */

  it("awx-launch-job launches a job template and returns a job ID", async () => {
    const result = await hooks.tool!["awx-launch-job"]!.execute(
      { template_id: JOB_TEMPLATE_ID, extra_vars: EXTRA_VARS },
      mockToolContext(),
    );

    const parsed = getMetadata(result);

    // The transforms pipeline must have completed without errors
    expect(parsed.errors).toEqual([]);
    // A real launch returns a positive job ID and an initial status
    expect(parsed.jobId).toBeGreaterThan(0);
    expect(parsed.jobStatus).toBeDefined();
    expect(["pending", "waiting", "running", "new"]).toContain(
      parsed.jobStatus,
    );
    // Warnings may come from URL/branch transforms — log them for debugging
    if (parsed.warnings.length > 0) {
      console.log("[launch warnings]", parsed.warnings);
    }
  });

  /* ═══════════════════════════════════════════════════════════════
     Full Lifecycle: Launch → Status → Wait → Events
     ═══════════════════════════════════════════════════════════════ */

  describe("full lifecycle sequence", () => {
    let jobId: number;

    beforeAll(async () => {
      // Launch a single job that all lifecycle tests will reference.
      // This avoids launching N jobs for N tests.
      const result = await hooks.tool!["awx-launch-job"]!.execute(
        { template_id: JOB_TEMPLATE_ID, extra_vars: EXTRA_VARS },
        mockToolContext(),
      );
      const parsed = getMetadata(result);
      jobId = parsed.jobId as number;

      // Guard: if transforms prevented launch, skip the lifecycle tests
      // with a clear error message.
      if (parsed.jobId === 0) {
        throw new Error(
          `Launch failed (jobId=0). Transforms errors: ${JSON.stringify(
            parsed.errors,
          )}. Check EXTRA_VARS_* env vars match your job template.`,
        );
      }
    });

    /* ── Step 2: Check Status ─────────────────────────────── */

    it("awx-job-status returns structured job detail matching the v1.0 contract", async () => {
      const result = await hooks.tool!["awx-job-status"]!.execute(
        { job_id: jobId },
        mockToolContext(),
      );

      const parsed = getMetadata(result);

      // Top-level contract fields
      expect(parsed.schema_version).toBe("1.0");
      expect((parsed.job as Record<string, unknown>).id).toBe(jobId);
      expect((parsed.job as Record<string, unknown>).status).toBeDefined();
      expect((parsed.job as Record<string, unknown>).job_type).toBe("run");

      // Related resource names (resolved from summary_fields)
      expect(parsed.related).toHaveProperty("inventory_name");
      expect(parsed.related).toHaveProperty("job_template_name");

      // Host status counts
      expect(parsed.host_status_counts).toHaveProperty("ok");
      expect(parsed.host_status_counts).toHaveProperty("failed");
      expect(parsed.host_status_counts).toHaveProperty("unreachable");

      // Derived boolean flags
      expect(parsed.derived).toHaveProperty("is_successful");
      expect(parsed.derived).toHaveProperty("is_failed");
      expect(parsed.derived).toHaveProperty("has_unreachable_hosts");

      // Warnings and errors arrays
      expect(Array.isArray(parsed.warnings)).toBe(true);
      expect(Array.isArray(parsed.errors)).toBe(true);
    });

    /* ── Step 3: Wait (Non-Blocking) ──────────────────────── */

    it("awx-wait-job returns current job status without waiting (non-blocking)", async () => {
      const result = await hooks.tool!["awx-wait-job"]!.execute(
        { job_id: jobId },
        mockToolContext(),
      );

      // The wait-job tool returns { output, metadata }
      expect(typeof result).toBe("object");
      expect(result).toHaveProperty("output");

      const parsed = getMetadata(result);

      // Must return immediately without polling
      expect((parsed.job as Record<string, unknown>).id).toBe(jobId);
      expect((parsed.job as Record<string, unknown>).status).toBeDefined();
      // The status may be "running" or "successful"/"failed" — the tool
      // does NOT block waiting for completion
      expect([
        "pending",
        "waiting",
        "running",
        "successful",
        "failed",
        "error",
        "canceled",
      ]).toContain((parsed.job as Record<string, unknown>).status);
    });

    /* ── Step 4: Get Events ───────────────────────────────── */

    it("awx-get-job-events returns events for the launched job", async () => {
      const result = await hooks.tool!["awx-get-job-events"]!.execute(
        { job_id: jobId },
        mockToolContext(),
      );

      const parsed = getMetadata(result);

      expect(typeof parsed.count).toBe("number");
      expect(Array.isArray(parsed.results)).toBe(true);
      // next_page is null or a number
      expect(
        parsed.next_page === null || typeof parsed.next_page === "number",
      ).toBe(true);
    });

    /* ── Step 5: Status with Stdout ───────────────────────── */

    it("awx-job-status with include_stdout includes stdout when available", async () => {
      const result = await hooks.tool!["awx-job-status"]!.execute(
        { job_id: jobId, include_stdout: true },
        mockToolContext(),
      );

      const parsed = getMetadata(result);

      // Schema should still be valid
      expect(parsed.schema_version).toBe("1.0");
      expect((parsed.job as Record<string, unknown>).id).toBe(jobId);

      // stdout may be null for a pending/running job or a failed launch,
      // but the tool must not error when include_stdout is requested.
      // It should either be a string or absent.
      if (parsed.stdout !== undefined) {
        expect(typeof parsed.stdout).toBe("string");
      }
    });
  });
});
