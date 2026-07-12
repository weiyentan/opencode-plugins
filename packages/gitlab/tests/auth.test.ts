/**
 * Auth Hook Tests — GitLab Plugin
 *
 * Validates the GitLab auth hook contract: structure, authorize() behavior,
 * error messages, and token validation logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGitLabAuthHook, validateToken } from "../src/auth.js";

/* ── Mock fetch for validateToken tests ─────────────────────── */
const mockFetch = vi.fn();

// Replace global fetch for testing
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("createGitLabAuthHook", () => {
  it("returns auth hook with correct provider", () => {
    const hook = createGitLabAuthHook();
    expect(hook.provider).toBe("gitlab");
  });

  it("has one auth method of type api", () => {
    const hook = createGitLabAuthHook();
    expect(hook.methods).toHaveLength(1);
    expect(hook.methods[0]!.type).toBe("api");
  });

  it("auth method has a label", () => {
    const hook = createGitLabAuthHook();
    expect(hook.methods[0]!.label).toContain("GitLab");
  });

  it("auth method has a token text prompt", () => {
    const hook = createGitLabAuthHook();
    const prompts = hook.methods[0]!.prompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.type).toBe("text");
    expect(prompts[0]!.key).toBe("token");
    expect(prompts[0]!.message).toContain("Personal Access Token");
  });

  describe("authorize()", () => {
    const method = createGitLabAuthHook().methods[0]!;

    it("returns success with key on valid token", async () => {
      const result = await method.authorize({ token: "glpat-abc123xyz" });

      expect(result.type).toBe("success");
      expect(result.key).toBe("glpat-abc123xyz");
    });

    it("trims whitespace from token", async () => {
      const result = await method.authorize({ token: "  glpat-abc123  " });

      expect(result.type).toBe("success");
      expect(result.key).toBe("glpat-abc123");
    });

    it("returns failure on empty token", async () => {
      const result = await method.authorize({ token: "" });

      expect(result.type).toBe("failed");
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe("string");
      expect((result.message as string).length).toBeGreaterThan(0);
    });

    it("returns failure on whitespace-only token", async () => {
      const result = await method.authorize({ token: "   " });

      expect(result.type).toBe("failed");
      expect(result.message).toBeDefined();
      expect(typeof result.message).toBe("string");
      expect((result.message as string).length).toBeGreaterThan(0);
    });

    it("returns failed type on validation failure", async () => {
      const result = await method.authorize({ token: "" });

      expect(result.type).toBe("failed");
    });
  });
});

describe("validateToken", () => {
  const baseUrl = "https://gitlab.com/";
  const token = "glpat-valid-token";

  it("returns valid on 200 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v4/user"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
        }),
      }),
    );
  });

  it("normalises baseUrl trailing slash", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await validateToken("https://gitlab.com", token);

    // Should have added trailing slash and api/v4/user
    expect(mockFetch).toHaveBeenCalledWith(
      "https://gitlab.com/api/v4/user",
      expect.any(Object),
    );
  });

  it("returns invalid on 401 response with actionable message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain("invalid or expired");
    expect(result.error).toContain("personal_access_tokens");
  });

  it("returns invalid on 403 response with permissions guidance", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("permissions");
    expect(result.error).toContain("read_user");
    expect(result.error).toContain("api");
  });

  it("returns invalid on other HTTP error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
    });

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("502");
  });

  it("returns invalid on network error with actionable message", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toContain("Cannot reach GitLab");
    expect(result.error).toContain("Connection refused");
  });

  it("returns invalid on AbortError (timeout)", async () => {
    const abortError = new DOMException(
      "The operation was aborted",
      "AbortError",
    );
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toContain("Timeout");
    expect(result.error).toContain("GitLab");
  });

  it("returns invalid on TimeoutError", async () => {
    const timeoutError = new DOMException(
      "The operation timed out.",
      "TimeoutError",
    );
    mockFetch.mockRejectedValueOnce(timeoutError);

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toContain("Timeout");
    expect(result.error).toContain("GitLab");
  });

  it("respects the abort signal", async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await validateToken(baseUrl, token, controller.signal);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("handles non-Error exception gracefully", async () => {
    mockFetch.mockRejectedValueOnce("Random string error");

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toContain("Cannot reach GitLab");
    expect(result.error).toContain("Random string error");
  });
});
