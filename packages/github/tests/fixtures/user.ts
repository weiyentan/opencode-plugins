/**
 * Test fixtures for github.user.get REST API response.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: Authenticated user response */
export const USER_GET_RESPONSE: any = {
  login: "testuser",
  id: 1,
  name: "Test User",
  email: "testuser@example.com",
  avatar_url: "https://avatars.githubusercontent.com/u/1",
  html_url: "https://github.com/testuser",
  company: "Acme Corp",
  location: "San Francisco, CA",
  bio: "A test user for development",
  blog: "https://testuser.dev",
  twitter_username: "testuser",
  public_repos: 42,
  public_gists: 10,
  followers: 100,
  following: 50,
  plan: {
    name: "pro",
    monthly_collaborators: 10,
    private_repos: 500,
    space: 1000000,
  },
  created_at: "2023-01-01T00:00:00Z",
  updated_at: "2025-07-01T12:00:00Z",
};
