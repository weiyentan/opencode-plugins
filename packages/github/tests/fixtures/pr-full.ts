/**
 * Test fixtures for github.pr.get-full GraphQL responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A standard pull request with commits, reviews, and CI status */
export const PR_FULL_RESPONSE: any = {
  repository: {
    pullRequest: {
      id: "PR_kwDOAAAAAAABC200",
      number: 43,
      title: "Fix login button padding",
      body: "Fixes the padding issue on the login button.",
      state: "OPEN",
      url: "https://github.com/owner/repo/pull/43",
      createdAt: "2025-01-16T09:00:00Z",
      updatedAt: "2025-01-18T11:00:00Z",
      closedAt: null,
      mergedAt: null,
      mergeable: "MERGEABLE",
      merged: false,
      mergedBy: null,
      author: {
        login: "testuser",
      },
      baseRefName: "main",
      headRefName: "fix-login-button",
      headRefOid: "abc123def456",
      additions: 50,
      deletions: 10,
      changedFiles: 3,
      labels: {
        nodes: [
          { name: "bug", color: "d73a4a" },
        ],
      },
      commits: {
        nodes: [
          {
            commit: {
              oid: "abc123def456",
              messageHeadline: "Fix login button padding",
              committedDate: "2025-01-16T09:30:00Z",
              author: {
                user: { login: "testuser" },
                name: "Test User",
              },
            },
          },
          {
            commit: {
              oid: "abc789def012",
              messageHeadline: "Add tests for login button",
              committedDate: "2025-01-16T10:00:00Z",
              author: {
                user: { login: "testuser" },
                name: "Test User",
              },
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "Y29tbWl0czo5",
        },
      },
      reviews: {
        nodes: [
          {
            id: "REVIEW_kwDOAAAAAAABC201",
            body: "Looks good, just one nitpick.",
            state: "CHANGES_REQUESTED",
            author: { login: "reviewer1" },
            createdAt: "2025-01-17T08:00:00Z",
          },
          {
            id: "REVIEW_kwDOAAAAAAABC202",
            body: "LGTM!",
            state: "APPROVED",
            author: { login: "maintainer1" },
            createdAt: "2025-01-18T10:00:00Z",
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "cmV2aWV3czoy",
        },
      },
      reviewThreads: {
        nodes: [
          {
            id: "THREAD_kwDOAAAAAAABC203",
            isResolved: true,
            comments: {
              nodes: [
                {
                  id: "COMMENT_kwDOAAAAAAABC204",
                  body: "Should this be a constant?",
                  author: { login: "reviewer1" },
                  path: "src/button.tsx",
                },
              ],
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "dGhyZWFkczox",
        },
      },
      // CI status via latest commit's status check rollup
      // This is in a separate query in the real implementation
      // but included here for fixture completeness
    },
  },
};

/** Latest commits status check rollup (separate query) */
export const PR_STATUS_ROLLUP: any = {
  repository: {
    pullRequest: {
      id: "PR_kwDOAAAAAAABC200",
      commits: {
        nodes: [
          {
            commit: {
              oid: "abc789def012",
              statusCheckRollup: {
                state: "SUCCESS",
                contexts: {
                  nodes: [
                    {
                      __typename: "CheckRun",
                      name: "CI / test",
                      status: "COMPLETED",
                      conclusion: "SUCCESS",
                    },
                    {
                      __typename: "CheckRun",
                      name: "Lint",
                      status: "COMPLETED",
                      conclusion: "SUCCESS",
                    },
                    {
                      __typename: "StatusContext",
                      context: "continuous-integration/jenkins",
                      state: "SUCCESS",
                      description: "Build passed",
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  },
};

/** Fixture: Merged PR without reviews */
export const PR_MERGED_RESPONSE: any = {
  repository: {
    pullRequest: {
      id: "PR_kwDOAAAAAAABC300",
      number: 44,
      title: "Update dependencies",
      body: "Bump lodash to latest.",
      state: "MERGED",
      url: "https://github.com/owner/repo/pull/44",
      createdAt: "2025-01-10T08:00:00Z",
      updatedAt: "2025-01-11T12:00:00Z",
      closedAt: "2025-01-11T12:00:00Z",
      mergedAt: "2025-01-11T12:00:00Z",
      mergeable: "MERGEABLE",
      merged: true,
      mergedBy: { login: "maintainer1" },
      author: {
        login: "dependabot",
      },
      baseRefName: "main",
      headRefName: "deps/lodash",
      headRefOid: "def456abc789",
      additions: 2,
      deletions: 2,
      changedFiles: 1,
      labels: { nodes: [{ name: "dependencies", color: "0366d6" }] },
      commits: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      reviews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    },
  },
};

/** Fixture: PR not found */
export const PR_NOT_FOUND_RESPONSE: any = {
  repository: {
    pullRequest: null,
  },
};
