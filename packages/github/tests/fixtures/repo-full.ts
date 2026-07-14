/**
 * Test fixtures for github_repo_get_full GraphQL responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A full repository response with README, commits, and contributors */
export const REPO_FULL_RESPONSE: any = {
  repository: {
    id: "R_kgDOAAAAAAABC500",
    name: "my-project",
    owner: { login: "owner" },
    description: "A sample project for testing",
    url: "https://github.com/owner/my-project",
    homepageUrl: "https://my-project.dev",
    createdAt: "2024-06-01T00:00:00Z",
    updatedAt: "2025-02-15T12:00:00Z",
    pushedAt: "2025-02-15T12:00:00Z",
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    languages: {
      nodes: [
        { name: "TypeScript", color: "#3178c6" },
        { name: "JavaScript", color: "#f1e05a" },
      ],
    },
    stargazerCount: 150,
    forkCount: 25,
    openIssueCount: { totalCount: 5 },
    openPRCount: { totalCount: 2 },
    readme: {
      text: "# My Project\n\nThis is a sample project.\n\n## Getting Started\n\n```bash\nnpm install\n```\n",
    },
    defaultBranchRef: {
      target: {
        history: {
          nodes: [
            {
              oid: "abc100def001",
              messageHeadline: "Fix critical bug in parser",
              committedDate: "2025-02-15T12:00:00Z",
              author: {
                name: "Test User",
                user: { login: "testuser" },
              },
            },
            {
              oid: "abc100def002",
              messageHeadline: "Add new feature X",
              committedDate: "2025-02-14T10:00:00Z",
              author: {
                name: "Collaborator One",
                user: { login: "collaborator1" },
              },
            },
            {
              oid: "abc100def003",
              messageHeadline: "Update documentation",
              committedDate: "2025-02-13T09:00:00Z",
              author: {
                name: "Test User",
                user: { login: "testuser" },
              },
            },
          ],
        },
      },
    },
    mentionableUsers: {
      nodes: [
        { login: "testuser", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
        { login: "collaborator1", avatarUrl: "https://avatars.githubusercontent.com/u/2" },
        { login: "maintainer1", avatarUrl: "https://avatars.githubusercontent.com/u/3" },
      ],
    },
  },
};

/** Fixture: Repository without README */
export const REPO_NO_README_RESPONSE: any = {
  repository: {
    id: "R_kgDOAAAAAAABC600",
    name: "empty-repo",
    owner: { login: "owner" },
    description: "An empty repo with no readme",
    url: "https://github.com/owner/empty-repo",
    homepageUrl: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    pushedAt: "2025-01-01T00:00:00Z",
    primaryLanguage: null,
    languages: { nodes: [] },
    stargazerCount: 0,
    forkCount: 0,
    openIssueCount: { totalCount: 0 },
    openPRCount: { totalCount: 0 },
    readme: null,
    defaultBranchRef: null,
    mentionableUsers: { nodes: [] },
  },
};

/** Fixture: Repository not found */
export const REPO_NOT_FOUND_RESPONSE: any = {
  repository: null,
};
