/**
 * Test fixtures for github_issue_get_full GraphQL responses.
 *
 * These fixtures simulate the shape of the GitHub GraphQL API response
 * for a repository issue query with labels, comments, and timeline events.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A standard issue with labels, comments, and a linked PR */
export const ISSUE_FULL_RESPONSE: any = {
  repository: {
    issue: {
      id: "I_kwDOAAAAAAABC123",
      number: 42,
      title: "Fix the login button styling",
      body: "The login button on the homepage has incorrect padding.",
      state: "OPEN",
      url: "https://github.com/owner/repo/issues/42",
      createdAt: "2025-01-15T10:00:00Z",
      updatedAt: "2025-01-20T14:30:00Z",
      closedAt: null,
      author: {
        login: "testuser",
      },
      labels: {
        nodes: [
          { name: "bug", color: "d73a4a", description: "Something isn't working" },
          { name: "frontend", color: "1d76db", description: "Frontend related" },
        ],
      },
      comments: {
        nodes: [
          {
            id: "IC_kwDOAAAAAAABC124",
            body: "I can reproduce this on Chrome.",
            author: { login: "collaborator1" },
            createdAt: "2025-01-16T08:00:00Z",
          },
          {
            id: "IC_kwDOAAAAAAABC125",
            body: "Looking into it now.",
            author: { login: "testuser" },
            createdAt: "2025-01-17T09:00:00Z",
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "Y3Vyc29yOnYyOpHOA1c",
        },
      },
      timelineItems: {
        nodes: [
          {
            __typename: "LabeledEvent",
            id: "LE_kwDOAAAAAAABC126",
            createdAt: "2025-01-15T11:00:00Z",
            actor: { login: "maintainer1" },
            label: { name: "bug", color: "d73a4a" },
          },
          {
            __typename: "CrossReferencedEvent",
            id: "CRE_kwDOAAAAAAABC127",
            createdAt: "2025-01-16T10:00:00Z",
            actor: { login: "testuser" },
            source: {
              __typename: "PullRequest",
              number: 43,
              title: "Fix login button padding",
              state: "OPEN",
              repository: {
                owner: { login: "owner" },
                name: "repo",
              },
            },
          },
          {
            __typename: "AssignedEvent",
            id: "AE_kwDOAAAAAAABC128",
            createdAt: "2025-01-16T10:30:00Z",
            actor: { login: "maintainer1" },
            user: { login: "testuser" },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "dGltZWxpbmU6Mg",
        },
      },
    },
  },
};

/** Fixture: Issue with no timeline events or comments */
export const ISSUE_MINIMAL_RESPONSE: any = {
  repository: {
    issue: {
      id: "I_kwDOAAAAAAABC999",
      number: 99,
      title: "Simple typo in readme",
      body: "Fix a small typo.",
      state: "CLOSED",
      url: "https://github.com/owner/repo/issues/99",
      createdAt: "2025-02-01T08:00:00Z",
      updatedAt: "2025-02-02T09:00:00Z",
      closedAt: "2025-02-02T09:00:00Z",
      author: {
        login: "contributor1",
      },
      labels: {
        nodes: [],
      },
      comments: {
        nodes: [],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
      timelineItems: {
        nodes: [],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
    },
  },
};

/** Fixture: Issue not found (null issue) */
export const ISSUE_NOT_FOUND_RESPONSE: any = {
  repository: {
    issue: null,
  },
};
