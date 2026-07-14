/**
 * Unit tests for github_user_get REST tool.
 *
 * These tests use fixture data and a mock HTTP client to verify:
 *   1. Tool handles no-argument invocation correctly
 *   2. Output shape includes curated fields and _raw in metadata
 *   3. API errors (401, etc.) are surfaced as structured messages
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GitHubClient } from "../src/client.js";
import { USER_GET_RESPONSE } from "./fixtures/index.js";

let createUserTools: typeof import("../src/tools/user.js").createUserTools;

/* ── Helpers ──────────────────────────────────────────────────── */

function mockResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "Content-Type": "application/json" },
  });
}

function mockClient(data: unknown, status = 200): GitHubClient {
  return {
    request: vi.fn().mockResolvedValue(mockResponse(data, status)),
  };
}

const mockContext = { abort: undefined as any };

/* ── Tests ────────────────────────────────────────────────────── */

describe("github_user_get", () => {
  beforeEach(async () => {
    createUserTools = (await import("../src/tools/user.js")).createUserTools;
  });

  describe("invocation", () => {
    it("works with no arguments", async () => {
      const client = mockClient(USER_GET_RESPONSE);
      const tools = createUserTools(() => Promise.resolve(client));
      const result = await tools["github_user_get"].execute({}, mockContext);

      expect(typeof result.output).toBe("string");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("output shape", () => {
    it("returns curated user profile fields", async () => {
      const client = mockClient(USER_GET_RESPONSE);
      const tools = createUserTools(() => Promise.resolve(client));
      const result = await tools["github_user_get"].execute({}, mockContext);

      expect(typeof result.output).toBe("string");
      const meta = result.metadata as Record<string, unknown>;

      // Core fields
      expect(meta.login).toBe("testuser");
      expect(meta.name).toBe("Test User");
      expect(meta.email).toBe("testuser@example.com");
      expect(meta.company).toBe("Acme Corp");
      expect(meta.location).toBe("San Francisco, CA");
      expect(meta.bio).toBe("A test user for development");
      expect(meta.twitterUsername).toBe("testuser");

      // Stats
      expect(meta.stats).toBeDefined();
      expect((meta.stats as any).publicRepos).toBe(42);
      expect((meta.stats as any).followers).toBe(100);
      expect((meta.stats as any).following).toBe(50);

      // Plan
      expect(meta.plan).toBeDefined();
      expect((meta.plan as any).name).toBe("pro");

      // _raw
      expect(meta._raw).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("surfaces 401 authentication errors with guidance", async () => {
      const client = mockClient({ message: "Bad credentials" }, 401);
      const tools = createUserTools(() => Promise.resolve(client));
      const result = await tools["github_user_get"].execute({}, mockContext);

      expect(result.output).toContain("Authentication failed");
      expect(result.output).toContain("Personal Access Token");
      expect(result.output).toContain("github-configure");
      expect(result.metadata).toBeDefined();
    });

    it("surfaces generic API errors", async () => {
      const client = mockClient({ message: "Not Found" }, 404);
      const tools = createUserTools(() => Promise.resolve(client));
      const result = await tools["github_user_get"].execute({}, mockContext);

      expect(result.output).toContain("404");
      expect(result.output).toContain("Not Found");
      expect(result.metadata).toBeDefined();
    });
  });

  describe("abort handling", () => {
    it("respects abort signal", async () => {
      const tools = createUserTools(() => Promise.resolve(mockClient({})));
      const result = await tools["github_user_get"].execute(
        {},
        { abort: { aborted: true } as any },
      );
      expect(result.output).toBe("Request was aborted.");
    });
  });
});
