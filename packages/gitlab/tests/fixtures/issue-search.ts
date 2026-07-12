/**
 * Test fixtures for gitlab.issue.search GraphQL responses.
 *
 * These fixtures simulate the shape of the GitLab GraphQL API response
 * for the project search + issues query.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: Search that finds projects with issues */
export const ISSUE_SEARCH_RESPONSE: any = {
  projects: {
    nodes: [
      {
        id: "gid://gitlab/Project/123",
        fullPath: "group/project",
        name: "project",
        description: "A sample project",
        webUrl: "https://gitlab.com/group/project",
        issues: {
          nodes: [
            {
              iid: "100",
              title: "Memory leak in worker",
              description: "Worker process leaks memory over time.",
              state: "opened",
              webUrl: "https://gitlab.com/group/project/-/issues/100",
              createdAt: "2025-03-01T10:00:00Z",
              updatedAt: "2025-03-05T12:00:00Z",
              author: { username: "testuser" },
              labels: {
                nodes: [
                  { title: "bug", color: "#d73a4a" },
                ],
              },
            },
            {
              iid: "101",
              title: "Add search feature",
              description: "Implement full-text search.",
              state: "opened",
              webUrl: "https://gitlab.com/group/project/-/issues/101",
              createdAt: "2025-03-02T08:00:00Z",
              updatedAt: "2025-03-04T09:00:00Z",
              author: { username: "contributor1" },
              labels: {
                nodes: [],
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: "aXNzdWU6Mg",
          },
        },
      },
      {
        id: "gid://gitlab/Project/456",
        fullPath: "other-org/other-project",
        name: "other-project",
        description: "Another related project",
        webUrl: "https://gitlab.com/other-org/other-project",
        issues: {
          nodes: [
            {
              iid: "50",
              title: "Cache invalidation bug",
              description: "Cache entries are not invalidated properly.",
              state: "opened",
              webUrl: "https://gitlab.com/other-org/other-project/-/issues/50",
              createdAt: "2025-02-15T14:00:00Z",
              updatedAt: "2025-03-03T16:00:00Z",
              author: { username: "dev-user" },
              labels: {
                nodes: [
                  { title: "performance", color: "#ff9900" },
                ],
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: "aXNzdWU6MQ",
          },
        },
      },
    ],
    pageInfo: {
      hasNextPage: false,
      endCursor: "cHJvamVjdDoy",
    },
  },
};

/** Fixture: Empty search results */
export const ISSUE_SEARCH_EMPTY_RESPONSE: any = {
  projects: {
    nodes: [],
    pageInfo: {
      hasNextPage: false,
      endCursor: null,
    },
  },
};

/** Fixture: Projects found but none have issues */
export const ISSUE_SEARCH_NO_ISSUES_RESPONSE: any = {
  projects: {
    nodes: [
      {
        id: "gid://gitlab/Project/789",
        fullPath: "empty-org/empty-project",
        name: "empty-project",
        description: "An empty project",
        webUrl: "https://gitlab.com/empty-org/empty-project",
        issues: {
          nodes: [],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      },
    ],
    pageInfo: {
      hasNextPage: false,
      endCursor: "cHJvamVjdDox",
    },
  },
};
