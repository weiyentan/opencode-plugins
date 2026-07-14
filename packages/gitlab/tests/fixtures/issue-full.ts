/**
 * Test fixtures for gitlab_issue_get_full GraphQL responses.
 *
 * These fixtures simulate the shape of the GitLab GraphQL API response
 * for a project issue query with labels, notes, and linked merge requests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A standard issue with labels, notes, and a linked MR */
export const ISSUE_FULL_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    fullPath: "group/project",
    issue: {
      id: "gid://gitlab/Issue/456",
      iid: "42",
      title: "Fix the login button styling",
      description: "The login button on the homepage has incorrect padding.",
      state: "opened",
      webUrl: "https://gitlab.com/group/project/-/issues/42",
      createdAt: "2025-01-15T10:00:00Z",
      updatedAt: "2025-01-20T14:30:00Z",
      closedAt: null,
      author: { username: "testuser", name: "Test User" },
      labels: {
        nodes: [
          { title: "bug", color: "#d73a4a", description: "Something isn't working" },
          { title: "frontend", color: "#1d76db", description: "Frontend related" },
        ],
      },
      notes: {
        nodes: [
          {
            id: "gid://gitlab/Note/789",
            body: "I can reproduce this on Chrome.",
            author: { username: "collaborator1" },
            createdAt: "2025-01-16T08:00:00Z",
            system: false,
          },
          {
            id: "gid://gitlab/Note/790",
            body: "Looking into it now.",
            author: { username: "testuser" },
            createdAt: "2025-01-17T09:00:00Z",
            system: false,
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "Y3Vyc29yOnYyOpHOA1c",
        },
      },
      mergeRequests: {
        nodes: [
          {
            iid: "7",
            title: "Fix login button padding",
            state: "opened",
            webUrl: "https://gitlab.com/group/project/-/merge_requests/7",
          },
        ],
      },
    },
  },
};

/** Fixture: Issue with no notes or linked MRs */
export const ISSUE_MINIMAL_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    fullPath: "group/project",
    issue: {
      id: "gid://gitlab/Issue/999",
      iid: "99",
      title: "Simple typo in readme",
      description: "Fix a small typo.",
      state: "closed",
      webUrl: "https://gitlab.com/group/project/-/issues/99",
      createdAt: "2025-02-01T08:00:00Z",
      updatedAt: "2025-02-02T09:00:00Z",
      closedAt: "2025-02-02T09:00:00Z",
      author: { username: "contributor1", name: "Contributor One" },
      labels: {
        nodes: [],
      },
      notes: {
        nodes: [],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
      mergeRequests: {
        nodes: [],
      },
    },
  },
};

/** Fixture: Issue not found (null issue) */
export const ISSUE_NOT_FOUND_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    fullPath: "group/project",
    issue: null,
  },
};
