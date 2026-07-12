/**
 * Test fixtures for gitlab.project.get-full GraphQL responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A full project response with README, file tree, and languages */
export const PROJECT_FULL_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    name: "my-project",
    fullPath: "group/my-project",
    description: "A sample project for testing",
    webUrl: "https://gitlab.com/group/my-project",
    avatarUrl: null,
    createdAt: "2024-06-01T00:00:00Z",
    updatedAt: "2025-02-15T12:00:00Z",
    lastActivityAt: "2025-02-15T12:00:00Z",
    starCount: 150,
    forksCount: 25,
    openIssuesCount: 5,
    visibility: "public",
    languages: [
      { name: "TypeScript", share: 0.65 },
      { name: "JavaScript", share: 0.25 },
      { name: "CSS", share: 0.10 },
    ],
    repository: {
      rootRef: "main",
      tree: {
        blobs: {
          nodes: [
            { name: "src", type: "tree" },
            { name: "README.md", type: "blob" },
            { name: "package.json", type: "blob" },
            { name: "tsconfig.json", type: "blob" },
          ],
        },
      },
      blobs: {
        nodes: [
          {
            name: "README.md",
            rawTextBlob: "# My Project\n\nThis is a sample project.\n\n## Getting Started\n\n```bash\nnpm install\nnpm run dev\n```",
          },
        ],
      },
    },
  },
};

/** Fixture: Project without README */
export const PROJECT_NO_README_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/456",
    name: "empty-repo",
    fullPath: "group/empty-repo",
    description: "An empty project with no readme",
    webUrl: "https://gitlab.com/group/empty-repo",
    avatarUrl: null,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    lastActivityAt: "2025-01-01T00:00:00Z",
    starCount: 0,
    forksCount: 0,
    openIssuesCount: 0,
    visibility: "private",
    languages: [],
    repository: {
      rootRef: "main",
      tree: {
        blobs: {
          nodes: [],
        },
      },
      blobs: {
        nodes: [],
      },
    },
  },
};

/** Fixture: Project not found */
export const PROJECT_NOT_FOUND_RESPONSE: any = {
  project: null,
};
