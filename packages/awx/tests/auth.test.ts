/**
 * Auth Hook Tests
 *
 * Validates the AWX auth hook contract: structure, authorize() behavior,
 * error messages, and token validation logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAwxAuthHook, validateToken } from "../src/auth.js";

/* ── Mock fetch for validateToken tests ─────────────────────── */
const mockFetch = vi.fn();

// Replace global fetch for testing
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("createAwxAuthHook", () => {
  it("returns auth hook with correct provider", () => {
    const hook = createAwxAuthHook();
    expect(hook.provider).toBe("awx");
  });

  it("has one auth method of type api", () => {
    const hook = createAwxAuthHook();
    expect(hook.methods).toHaveLength(1);
    expect(hook.methods[0]!.type).toBe("api");
  });

  it("auth method has a label", () => {
    const hook = createAwxAuthHook();
    expect(hook.methods[0]!.label).toContain("AWX");
  });

  it("auth method has a token text prompt", () => {
    const hook = createAwxAuthHook();
    const prompts = hook.methods[0]!.prompts;
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.type).toBe("text");
    expect(prompts[0]!.key).toBe("token");
    expect(prompts[0]!.message).toContain("Personal Access Token");
  });

  describe("authorize()", () => {
    const method = createAwxAuthHook().methods[0]!;

    it("returns success with key on valid token", async () => {
      const result = await method.authorize({ token: "my-pat-token" });

      expect(result.type).toBe("success");
      expect(result.key).toBe("my-pat-token");
    });

    it("trims whitespace from token", async () => {
      const result = await method.authorize({ token: "  my-pat-token  " });

      expect(result.type).toBe("success");
      expect(result.key).toBe("my-pat-token");
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
  const baseUrl = "https://example.com/";
  const token = "valid-pat-token";

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
      expect.stringContaining("/api/v2/me/"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
        }),
      }),
    );
  });

  it("normalises baseUrl trailing slash", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await validateToken("https://example.com", token);

    // Should have added trailing slash and api/v2/me/
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/api/v2/me/",
      expect.any(Object),
    );
  });

  it("returns invalid on 401 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toContain("invalid or expired");
    expect(result.error).toContain("/api/v2/tokens/");
  });

  it("returns invalid on 403 response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
    });

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toContain("permissions");
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
    expect(result.error).toContain("Cannot reach AAP");
    expect(result.error).toContain("AWX_BASE_URL");
  });

  it("returns invalid on AbortError (timeout)", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toContain("Timeout");
    expect(result.error).toContain("AWX_BASE_URL");
  });

  it("returns invalid on TimeoutError (createTimeoutSignal abort)", async () => {
    const timeoutError = new DOMException("The operation timed out.", "TimeoutError");
    mockFetch.mockRejectedValueOnce(timeoutError);

    const result = await validateToken(baseUrl, token);

    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toContain("Timeout");
    expect(result.error).toContain("AWX_BASE_URL");
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
});
