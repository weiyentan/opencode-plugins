/**
 * GraphQL Client Tests — GitLab Plugin
 *
 * Validates the GitLab GraphQL wrapper: auth injection, query execution,
 * variable serialization, error parsing, and abort/timeout handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGraphQLClient } from "../src/graphql.js";

/* ── Mock fetch ───────────────────────────────────────────────── */
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createGraphQLClient", () => {
  it("returns a client with a request method", () => {
    const client = createGraphQLClient("https://gitlab.com", "token123");
    expect(client).toBeDefined();
    expect(typeof client.request).toBe("function");
  });

  it("sends a POST request to /api/graphql", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: { currentUser: { name: "test" } } }),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com", "token123");
    const result = await client.request(
      "query { currentUser { name } }",
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://gitlab.com/api/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token123",
          "Content-Type": "application/json",
          Accept: "application/json",
        }),
      }),
    );
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ currentUser: { name: "test" } });
  });

  it("normalises baseUrl trailing slash", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: {} }),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com/", "token123");
    await client.request("query { }");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://gitlab.com/api/graphql",
      expect.any(Object),
    );
  });

  it("serializes variables in the JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: {} }),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com", "token123");
    await client.request(
      "query($id: ID!) { project(fullPath: $id) { name } }",
      { id: "group/project" },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          query: "query($id: ID!) { project(fullPath: $id) { name } }",
          variables: { id: "group/project" },
        }),
      }),
    );
  });

  it("serializes empty variables object when not provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: {} }),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com", "token123");
    await client.request("query { currentUser { name } }");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          query: "query { currentUser { name } }",
          variables: {},
        }),
      }),
    );
  });
});

describe("GraphQL error parsing", () => {
  it("returns errors when GraphQL response contains errors array", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: null,
          errors: [
            {
              message: "Field 'nonexistent' doesn't exist on type 'Query'",
              locations: [{ line: 1, column: 9 }],
              path: ["query", "nonexistent"],
            },
          ],
        }),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com", "token123");
    const result = await client.request(
      "query { nonexistent { name } }",
    );

    expect(result.status).toBe(200);
    expect(result.ok).toBe(false); // GraphQL errors → not ok
    expect(result.data).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]!.message).toContain("doesn't exist");
    expect(result.errors![0]!.locations).toBeDefined();
    expect(result.errors![0]!.path).toBeDefined();
  });

  it("returns both data and errors when response has partial data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: { currentUser: { name: "test" } },
          errors: [
            {
              message: "Some fields could not be resolved",
            },
          ],
        }),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com", "token123");
    const result = await client.request("query { ... }");

    expect(result.ok).toBe(false);
    expect(result.data).toEqual({ currentUser: { name: "test" } });
    expect(result.errors).toHaveLength(1);
  });

  it("handles HTTP errors from GraphQL endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: () => Promise.resolve({}),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com", "bad-token");
    const result = await client.request("query { currentUser { name } }");

    expect(result.status).toBe(401);
    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.errors).toBeDefined();
    expect(result.errors![0]!.message).toContain("401");
  });
});

describe("GraphQL timeout and abort", () => {
  it("handles timeout for slow requests", async () => {
    mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });

    // Make it fail fast by using very short mock timeout
    const client = createGraphQLClient("https://gitlab.com", "token123", {
      timeoutMs: 1,
    });

    const result = await client.request("query { currentUser { name } }");

    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]!.message).toContain("aborted");
  });

  it("respects abort signal for cancellation", async () => {
    const controller = new AbortController();

    mockFetch.mockImplementationOnce((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    });

    const client = createGraphQLClient("https://gitlab.com", "token123");

    const requestPromise = client.request(
      "query { currentUser { name } }",
      undefined,
      controller.signal,
    );

    // Small delay then abort
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();

    const result = await requestPromise;
    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]!.message).toContain("aborted");
  });

  it("handles network error gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));

    const client = createGraphQLClient("https://gitlab.com", "token123");
    const result = await client.request("query { currentUser { name } }");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.data).toBeNull();
    expect(result.errors).toBeDefined();
    expect(result.errors![0]!.message).toContain("fetch failed");
  });
});

describe("GraphQL mutation support", () => {
  it("sends mutations with variables", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: {
            createSnippet: {
              snippet: { id: "gid://gitlab/Snippet/42" },
              errors: [],
            },
          },
        }),
    } as Response);

    const client = createGraphQLClient("https://gitlab.com", "token123");
    const result = await client.request(
      `mutation($title: String!) {
        createSnippet(input: { title: $title, visibilityLevel: "private" }) {
          snippet { id }
          errors
        }
      }`,
      { title: "Test Snippet" },
    );

    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });
});
