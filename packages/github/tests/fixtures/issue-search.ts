/**
 * Test fixtures for github_issue_search GraphQL responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: Issue search results */
export const ISSUE_SEARCH_RESPONSE: any = {
  search: {
    issueCount: 42,
    pageInfo: {
      hasNextPage: true,
      endCursor: "Y3Vyc29yOjEw",
    },
    nodes: [
      {
        __typename: "Issue",
        id: "I_kwDOAAAAAAABC400",
        number: 100,
        title: "Memory leak in data processing",
        body: "We've identified a memory leak when processing large datasets.",
        state: "OPEN",
        url: "https://github.com/owner/repo/issues/100",
        createdAt: "2025-02-10T14:00:00Z",
        updatedAt: "2025-02-12T09:00:00Z",
        author: { login: "bugfinder" },
        labels: {
          nodes: [
            { name: "bug", color: "d73a4a" },
            { name: "performance", color: "1d76db" },
          ],
        },
        repository: {
          owner: { login: "owner" },
          name: "repo",
        },
        comments: { totalCount: 5 },
      },
      {
        __typename: "Issue",
        id: "I_kwDOAAAAAAABC401",
        number: 101,
        title: "Wrong import path in module A",
        body: "Module A imports from wrong path.",
        state: "CLOSED",
        url: "https://github.com/other-owner/other-repo/issues/5",
        createdAt: "2025-02-08T10:00:00Z",
        updatedAt: "2025-02-09T15:00:00Z",
        author: { login: "dev1" },
        labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
        repository: {
          owner: { login: "other-owner" },
          name: "other-repo",
        },
        comments: { totalCount: 2 },
      },
    ],
  },
};

/** Fixture: Empty search results */
export const ISSUE_SEARCH_EMPTY_RESPONSE: any = {
  search: {
    issueCount: 0,
    pageInfo: {
      hasNextPage: false,
      endCursor: null,
    },
    nodes: [],
  },
};

/** Fixture: Search with GraphQL error */
export const ISSUE_SEARCH_ERROR_RESPONSE: any = undefined;
