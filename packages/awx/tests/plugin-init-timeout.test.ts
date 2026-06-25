/**
 * Init-Time Timeout Cleanup Tests
 *
 * Verifies that createTimeoutSignal().clear() is called after init-time
 * token validation in the plugin server() function. This ensures no
 * dangling timeout persists when validation completes (success or failure).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PluginInput, Hooks } from "@opencode-ai/plugin";

// ── Shared mocks (hoisted before vi.mock factories) ─────────────
// vi.hoisted() runs before vi.mock() so these variables are available
// in the factory callbacks. Without hoisting, vi.mock factories would
// reference the variable before initialization.

const { mockClear, mockCreateTimeoutSignal, mockValidateToken } = vi.hoisted(
  () => {
    const mockClear = vi.fn();
    const mockCreateTimeoutSignal = vi.fn(() => ({
      signal: new AbortController().signal,
      clear: mockClear,
    }));
    const mockValidateToken = vi.fn().mockResolvedValue({
      valid: true,
      error: null,
      status: 200,
    });
    return { mockClear, mockCreateTimeoutSignal, mockValidateToken };
  },
);

// ── Module mocks (hoisted by vitest) ────────────────────────────
// These replace createTimeoutSignal and validateToken before the
// module under test imports them, allowing us to spy on clear().

vi.mock("../src/client.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...(original as object),
    createTimeoutSignal: mockCreateTimeoutSignal,
  };
});

vi.mock("../src/auth.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...(original as object),
    validateToken: mockValidateToken,
  };
});

// Import must come after vi.mock — vitest hoists the mock calls
// so by the time this import runs, the mocks are in place.
import { AwxPlugin } from "../src/index.js";

// ── Helpers ─────────────────────────────────────────────────────

/** Minimal PluginInput that returns a stored token for init-time validation. */
function mockPluginInputWithToken(): PluginInput {
  return {
    client: {
      getSecret: vi.fn().mockResolvedValue("test-pat-token"),
      app: {
        log: vi.fn(),
      },
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

/** Minimal PluginInput with no stored token (validation path skipped). */
function mockPluginInputWithoutToken(): PluginInput {
  return {
    client: {
      getSecret: vi.fn().mockResolvedValue(undefined),
      app: {
        log: vi.fn(),
      },
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

// ── Tests ───────────────────────────────────────────────────────

describe("init-time timeout cleanup", () => {
  beforeEach(() => {
    // Clear call counts between tests AND unstub any env vars from prior tests
    mockClear.mockClear();
    mockCreateTimeoutSignal.mockClear();
    mockValidateToken.mockClear();
    vi.unstubAllEnvs();

    // Re-establish default implementations (vitest restoreMocks may
    // have reverted vi.fn() instances between tests).
    mockCreateTimeoutSignal.mockImplementation(() => ({
      signal: new AbortController().signal,
      clear: mockClear,
    }));
    mockValidateToken.mockResolvedValue({
      valid: true,
      error: null,
      status: 200,
    });
  });

  it("calls clear() after successful token validation", async () => {
    vi.stubEnv("AWX_BASE_URL", "https://aap.example.com");
    const hooks: Hooks = await AwxPlugin(
      mockPluginInputWithToken(),
    );
    try {
      // createTimeoutSignal must have been called during init validation
      expect(mockCreateTimeoutSignal).toHaveBeenCalledWith(10_000);

      // clear() must have been called in the finally block
      expect(mockClear).toHaveBeenCalledTimes(1);
    } finally {
      await hooks.dispose?.();
    }
  });

  it("calls clear() even when token validation fails", async () => {
    // Make validateToken return an invalid result
    mockValidateToken.mockResolvedValueOnce({
      valid: false,
      error: "AWX token is invalid or expired.",
      status: 401,
    });

    vi.stubEnv("AWX_BASE_URL", "https://aap.example.com");
    const hooks: Hooks = await AwxPlugin(
      mockPluginInputWithToken(),
    );
    try {
      // clear() must still be called in the finally block (cleanup
      // happens regardless of validation outcome)
      expect(mockClear).toHaveBeenCalledTimes(1);
    } finally {
      await hooks.dispose?.();
    }
  });

  it("does not call createTimeoutSignal when no token is stored", async () => {
    vi.stubEnv("AWX_BASE_URL", "https://aap.example.com");
    const hooks: Hooks = await AwxPlugin(
      mockPluginInputWithoutToken(),
    );
    try {
      // No token → no validation → no timeout signal created
      expect(mockCreateTimeoutSignal).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    } finally {
      await hooks.dispose?.();
    }
  });

  it("does not call createTimeoutSignal when baseUrl is not configured", async () => {
    // Explicitly clear the env var because the real environment may have it set
    vi.stubEnv("AWX_BASE_URL", "");
    const hooks: Hooks = await AwxPlugin(
      mockPluginInputWithToken(),
      // No baseUrl → init validation skipped entirely
    );
    try {
      expect(mockCreateTimeoutSignal).not.toHaveBeenCalled();
      expect(mockClear).not.toHaveBeenCalled();
    } finally {
      await hooks.dispose?.();
    }
  });
});
