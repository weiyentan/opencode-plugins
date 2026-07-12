/**
 * Test fixtures for github.query (generic GraphQL passthrough).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A simple viewer query response */
export const VIEWER_QUERY_RESPONSE: any = {
  viewer: {
    login: "testuser",
    name: "Test User",
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
  },
};

/** Fixture: A simple repository query response */
export const REPO_QUERY_RESPONSE: any = {
  repository: {
    name: "test-repo",
    stargazerCount: 100,
  },
};
