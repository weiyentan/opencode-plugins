/**
 * Ping Integration Tests
 *
 * These tests call the real AWX API to validate end-to-end behavior
 * of the awx-ping tool. They use the plugin's own tool registration
 * mechanism to exercise the full plugin execution path.
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
 * AWX_TOKEN=<your-pat> npx vitest run tests/integration/ping.test.ts
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
  vi.stubEnv("AWX_TOKEN", undefined);
  return AwxPlugin(input);
}

/**
 * Extract metadata from a tool result.
 */
function getMetadata(result: ToolResult): Record<string, unknown> {
  const obj = result as { output: string; metadata?: Record<string, unknown> };
  return obj.metadata ?? {};
}

// ══════════════════════════════════════════════════════════════════
// Configuration Errors (always run, no AWX_TOKEN needed)
// ══════════════════════════════════════════════════════════════════

describe("Ping Tool — Configuration Errors", () => {
  it("awx-ping returns configuration error when no token is configured", async () => {
    const hooks = await createPlugin(/* no token */);

    try {
      const result = await hooks.tool!["awx-ping"]!.execute(
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

describe.skipIf(!ENV_AWX_TOKEN)("Ping Tool — Live AAP Integration", () => {
  it("returns reachable message with metadata containing version and ha info", async () => {
    const hooks = await createPlugin(ENV_AWX_TOKEN);

    try {
      const result = await hooks.tool!["awx-ping"]!.execute(
        {},
        mockToolContext(),
      );

      // Should have output
      expect(result).toHaveProperty("output");
      const out = (result as { output: string }).output;
      expect(out).toContain("reachable");
      expect(out).toContain("Version:");

      // Should have metadata with ping response fields
      const metadata = getMetadata(result);
      expect(metadata).toHaveProperty("version");
      expect(typeof metadata.version).toBe("string");
      expect(metadata).toHaveProperty("install_uuid");
      expect(typeof metadata.install_uuid).toBe("string");
    } finally {
      await hooks.dispose?.();
    }
  });
});
