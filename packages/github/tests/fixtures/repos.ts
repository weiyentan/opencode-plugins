/**
 * Test fixtures for github_repo_* REST API responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: Single repo response */
export const REPO_GET_RESPONSE: any = {
  id: 123456789,
  name: "my-project",
  full_name: "owner/my-project",
  owner: { login: "owner", id: 1, avatar_url: "https://avatars.githubusercontent.com/u/1" },
  description: "A sample project for testing",
  html_url: "https://github.com/owner/my-project",
  homepage: "https://my-project.dev",
  default_branch: "main",
  visibility: "public",
  archived: false,
  fork: false,
  language: "TypeScript",
  topics: ["typescript", "api", "cli"],
  license: {
    key: "mit",
    name: "MIT License",
    spdx_id: "MIT",
  },
  stargazers_count: 150,
  forks_count: 25,
  open_issues_count: 5,
  subscribers_count: 10,
  created_at: "2024-06-01T00:00:00Z",
  updated_at: "2025-02-15T12:00:00Z",
  pushed_at: "2025-02-15T12:00:00Z",
  size: 1024,
  parent: null,
};

/** Fixture: Repo search response */
export const REPO_SEARCH_RESPONSE: any = {
  total_count: 42,
  incomplete_results: false,
  items: [
    {
      id: 1,
      name: "repo-one",
      full_name: "owner/repo-one",
      owner: { login: "owner" },
      description: "First repository for testing",
      html_url: "https://github.com/owner/repo-one",
      language: "TypeScript",
      topics: ["typescript"],
      stargazers_count: 100,
      forks_count: 20,
      open_issues_count: 5,
      license: { spdx_id: "MIT" },
      visibility: "public",
      updated_at: "2025-02-15T12:00:00Z",
      created_at: "2024-06-01T00:00:00Z",
    },
    {
      id: 2,
      name: "repo-two",
      full_name: "owner/repo-two",
      owner: { login: "owner" },
      description: "Second repository with a longer description for testing",
      html_url: "https://github.com/owner/repo-two",
      language: "Python",
      topics: ["python", "data-science"],
      stargazers_count: 50,
      forks_count: 10,
      open_issues_count: 3,
      license: { spdx_id: "Apache-2.0" },
      visibility: "public",
      updated_at: "2025-01-10T08:00:00Z",
      created_at: "2024-03-15T00:00:00Z",
    },
  ],
};

/** Fixture: Repo not found response */
export const REPO_NOT_FOUND_RESPONSE: any = {
  message: "Not Found",
  documentation_url: "https://docs.github.com/rest/repos/repos#get-a-repository",
};
