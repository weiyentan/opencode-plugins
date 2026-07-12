/**
 * Test fixtures for gitlab.mr.get-full GraphQL responses.
 *
 * These fixtures simulate the shape of the GitLab GraphQL API response
 * for a project merge request query with commits, discussions, pipelines,
 * and approvals.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A full merge request with commits, discussions, pipelines, and approvals */
export const MR_FULL_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    fullPath: "group/project",
    mergeRequest: {
      id: "gid://gitlab/MergeRequest/789",
      iid: "7",
      title: "Fix login button padding",
      description: "Fixes the padding on the login button.",
      state: "opened",
      webUrl: "https://gitlab.com/group/project/-/merge_requests/7",
      createdAt: "2025-01-16T10:00:00Z",
      updatedAt: "2025-01-20T12:00:00Z",
      closedAt: null,
      mergedAt: null,
      mergeStatusEnum: "CAN_BE_MERGED",
      mergeError: null,
      sourceBranch: "fix-login-padding",
      targetBranch: "main",
      diffStatsSummary: {
        additions: 15,
        deletions: 3,
        fileCount: 2,
      },
      author: { username: "testuser", name: "Test User" },
      labels: {
        nodes: [
          { title: "bug", color: "#d73a4a" },
        ],
      },
      commits: {
        nodes: [
          {
            sha: "abc123def456",
            title: "Fix login button padding",
            message: "Fix login button padding\n\nAdjusted the padding values.",
            authoredDate: "2025-01-16T10:00:00Z",
            author: { name: "Test User", email: "testuser@example.com" },
          },
          {
            sha: "def789abc012",
            title: "Address review feedback",
            message: "Address review feedback",
            authoredDate: "2025-01-17T08:00:00Z",
            author: { name: "Test User", email: "testuser@example.com" },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "Y29tbWl0czo",
        },
      },
      discussions: {
        nodes: [
          {
            id: "gid://gitlab/Discussion/111",
            resolved: true,
            notes: {
              nodes: [
                {
                  id: "gid://gitlab/Note/888",
                  body: "Maybe increase the padding to 12px?",
                  author: { username: "reviewer1" },
                  createdAt: "2025-01-16T14:00:00Z",
                  system: false,
                },
                {
                  id: "gid://gitlab/Note/889",
                  body: "Good catch, updated.",
                  author: { username: "testuser" },
                  createdAt: "2025-01-16T15:00:00Z",
                  system: false,
                },
              ],
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "ZGlzY3Vzc2lvbjox",
        },
      },
      pipelines: {
        nodes: [
          {
            id: "gid://gitlab/Pipeline/555",
            status: "passed",
            ref: "fix-login-padding",
            createdAt: "2025-01-16T11:00:00Z",
            stages: {
              nodes: [
                { name: "build", status: "success" },
                { name: "test", status: "success" },
                { name: "lint", status: "success" },
              ],
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "cGlwZWxpbmU6MQ",
        },
      },
      approvedBy: {
        nodes: [
          { username: "maintainer1", name: "Maintainer One" },
        ],
      },
    },
  },
};

/** Fixture: Merged MR without discussions or pipelines */
export const MR_MERGED_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    fullPath: "group/project",
    mergeRequest: {
      id: "gid://gitlab/MergeRequest/790",
      iid: "8",
      title: "Update documentation",
      description: "Fixes outdated docs.",
      state: "merged",
      webUrl: "https://gitlab.com/group/project/-/merge_requests/8",
      createdAt: "2025-01-10T09:00:00Z",
      updatedAt: "2025-01-12T10:00:00Z",
      closedAt: null,
      mergedAt: "2025-01-12T10:00:00Z",
      mergeStatusEnum: "CAN_BE_MERGED",
      mergeError: null,
      sourceBranch: "update-docs",
      targetBranch: "main",
      diffStatsSummary: {
        additions: 5,
        deletions: 2,
        fileCount: 1,
      },
      author: { username: "contributor1", name: "Contributor One" },
      labels: {
        nodes: [],
      },
      commits: {
        nodes: [
          {
            sha: "commit001",
            title: "Update documentation",
            message: "Update documentation\n\nFixed typos.",
            authoredDate: "2025-01-10T09:00:00Z",
            author: { name: "Contributor One", email: "contributor1@example.com" },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: "Y29tbWl0czo",
        },
      },
      discussions: {
        nodes: [],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
      pipelines: {
        nodes: [],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
      approvedBy: {
        nodes: [],
      },
    },
  },
};

/** Fixture: MR not found */
export const MR_NOT_FOUND_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    fullPath: "group/project",
    mergeRequest: null,
  },
};
