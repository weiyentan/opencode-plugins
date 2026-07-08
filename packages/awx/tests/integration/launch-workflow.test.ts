/**
 * Integration Tests: AWX Workflow Launch
 *
 * Tests the awx-launch-workflow tool end-to-end using the plugin's own
 * tool registration mechanism (hooks.tool).
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
 * | `WORKFLOW_TEMPLATE_ID` | `1` | Non-production AWX workflow template ID to launch |
 *
 * ## Run
 *
 * ```bash
 * export AWX_TOKEN=your_pat_token_here
 * export WORKFLOW_TEMPLATE_ID=1
 * npx vitest run tests/integration/launch-workflow.test.ts
 * ```
 *
 * ## Important
 *
 * - **Use a NON-PRODUCTION workflow template.** The launch tool starts a
 *   real workflow on AAP every time these tests run.
 * - Workflows are NOT automatically cancelled after the test run.
 */
import { describe, it, expect, vi } from "vitest";
import type { PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { AwxPlugin } from "../../src/index.js";

// ── Environment Configuration ──────────────────────────────────

const AWX_TOKEN = process.env.AWX_TOKEN;
const AAP_BASE_URL =
  process.env.AAP_BASE_URL ?? "https://example.com";
const WORKFLOW_TEMPLATE_ID = Number(process.env.WORKFLOW_TEMPLATE_ID) || 1;

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

describe.skipIf(!AWX_TOKEN)("AWX Workflow Launch Integration", () => {
  /* ═══════════════════════════════════════════════════════════════
     Tool Registration (smoke test)
     ═══════════════════════════════════════════════════════════════ */

  it("creates a plugin instance with awx-launch-workflow registered", async () => {
    const hooks = await createHooks();

    try {
      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!["awx-launch-workflow"]).toBeDefined();
    } finally {
      await hooks.dispose?.();
    }
  });

  /* ═══════════════════════════════════════════════════════════════
     Launch Workflow
     ═══════════════════════════════════════════════════════════════ */

  it("awx-launch-workflow launches a workflow template and returns a job ID", async () => {
    const hooks = await createHooks();

    try {
      const result = await hooks.tool!["awx-launch-workflow"]!.execute(
        { template_id: WORKFLOW_TEMPLATE_ID },
        mockToolContext(),
      );

      const parsed = getMetadata(result);

      // The output should be a human-readable message
      expect(typeof (result as { output: string }).output).toBe("string");
      expect((result as { output: string }).output).toContain(
        `Workflow job template ${WORKFLOW_TEMPLATE_ID} launched`,
      );

      // AWX launch returns the raw workflow job object
      expect(parsed.id).toBeGreaterThan(0);
      expect(parsed.status).toBeDefined();
    } finally {
      await hooks.dispose?.();
    }
  });

  it("awx-launch-workflow with extra_vars", async () => {
    const hooks = await createHooks();

    try {
      const result = await hooks.tool!["awx-launch-workflow"]!.execute(
        {
          template_id: WORKFLOW_TEMPLATE_ID,
          extra_vars: { test_var: "hello" },
        },
        mockToolContext(),
      );

      const parsed = getMetadata(result);

      expect(parsed.id).toBeGreaterThan(0);
      expect(parsed.status).toBeDefined();
      expect((result as { output: string }).output).toContain(
        `Workflow job template ${WORKFLOW_TEMPLATE_ID} launched`,
      );
    } finally {
      await hooks.dispose?.();
    }
  });

  it("awx-launch-workflow returns error with invalid template ID", async () => {
    const hooks = await createHooks();

    try {
      const result = await hooks.tool!["awx-launch-workflow"]!.execute(
        { template_id: 999999 },
        mockToolContext(),
      );

      // Should return an error message, not throw
      expect((result as { output: string }).output).toContain("Failed to launch workflow");
    } finally {
      await hooks.dispose?.();
    }
  });
});
