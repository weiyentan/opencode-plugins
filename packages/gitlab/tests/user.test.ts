/**
 * User Profile Tool Tests — GitLab Plugin
 *
 * Tests for gitlab.user.get.
 */
import { describe, it, expect, vi } from "vitest";
import type { GitLabClient } from "../src/client.js";
import { createUserTools } from "../src/tools/user.js";

/* ── Mock helpers ──────────────────────────────────────────────── */

function createMockClient(): GitLabClient {
  return {
    request: vi.fn(),
  };
}

function mockAbort(): AbortSignal {
  return new AbortController().signal;
}

/* ── Sample responses ─────────────────────────────────────────── */

const SAMPLE_USER = {
  id: 1,
  username: "alice",
  name: "Alice Johnson",
  email: "alice@example.com",
  state: "active",
  avatar_url: "https://gitlab.com/uploads/avatar.png",
  web_url: "https://gitlab.com/alice",
  web: "https://gitlab.com/alice",
  created_at: "2023-06-15T10:00:00.000Z",
  bio: "Full-stack developer",
  location: "San Francisco",
  public_email: "alice@public.example.com",
  skype: "",
  linkedin: "",
  twitter: "@alice_dev",
  website_url: "https://alice.dev",
  organization: "Acme Corp",
  job_title: "Senior Developer",
  last_sign_in_at: "2025-06-10T08:30:00.000Z",
  confirmed_at: "2023-06-15T10:05:00.000Z",
  last_activity_on: "2025-06-12",
  current_sign_in_at: "2025-06-11T09:00:00.000Z",
  can_create_group: true,
  can_create_project: true,
  two_factor_enabled: true,
  is_admin: false,
  note: null,
  pronouns: "she/her",
  bot: false,
  namespace_id: 1,
};

const SAMPLE_MINIMAL_USER = {
  id: 2,
  username: "bot-user",
  name: "Bot User",
  state: "active",
  avatar_url: null,
  web_url: "https://gitlab.com/bot-user",
  created_at: "2024-01-01T00:00:00.000Z",
  bot: true,
  namespace_id: 2,
};

/* ── Helper to create mock Response objects ──────────────────── */

function mockJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(),
    json: () => Promise.resolve(data),
  } as unknown as Response;
}

/* ══════════════════════════════════════════════════════════════════
   gitlab.user.get
   ══════════════════════════════════════════════════════════════════ */

describe("gitlab.user.get", () => {
  it("returns user profile in markdown format", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_USER),
    );

    const tools = createUserTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.user.get"]!;
    const result = await toolDef.execute({}, { abort: mockAbort() });

    expect(result.output).toContain("Alice Johnson");
    expect(result.output).toContain("@alice");
    expect(result.output).toContain("San Francisco");
    expect(result.output).toContain("Senior Developer");
    expect(result.output).toContain("alice@example.com");
    expect(result.output).toContain("**2FA Enabled:** Yes");
    expect(result.metadata).toBeDefined();
    expect((result.metadata! as any).username).toBe("alice");
    expect((result.metadata! as any)._raw).toEqual(SAMPLE_USER);
  });

  it("handles minimal user data (e.g., bot accounts)", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse(SAMPLE_MINIMAL_USER),
    );

    const tools = createUserTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.user.get"]!;
    const result = await toolDef.execute({}, { abort: mockAbort() });

    expect(result.output).toContain("Bot User");
    expect(result.output).toContain("@bot-user");
    expect(result.output).toContain("**Bot:** Yes");
  });

  it("respects abort signal", async () => {
    const tools = createUserTools(() => Promise.resolve(createMockClient()));
    const toolDef = tools["gitlab.user.get"]!;
    const controller = new AbortController();
    controller.abort();

    const result = await toolDef.execute({}, { abort: controller.signal });

    expect(result.output).toBe("Request was aborted.");
  });

  it("handles API error response (401)", async () => {
    const client = createMockClient();
    (client.request as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockJsonResponse({ message: "Unauthorized" }, 401),
    );

    const tools = createUserTools(() => Promise.resolve(client));
    const toolDef = tools["gitlab.user.get"]!;
    const result = await toolDef.execute({}, { abort: mockAbort() });

    expect(result.output).toContain("Failed to get user profile");
    expect(result.output).toContain("401");
  });

  it("handles client initialization failure", async () => {
    const tools = createUserTools(() =>
      Promise.reject(new Error("No token configured")),
    );
    const toolDef = tools["gitlab.user.get"]!;
    const result = await toolDef.execute({}, { abort: mockAbort() });

    expect(result.output).toBe("No token configured");
  });
});
