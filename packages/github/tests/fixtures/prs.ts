/**
 * Test fixtures for github.pr.* REST API responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: List PRs response */
export const PR_LIST_RESPONSE: any[] = [
  {
    number: 43,
    title: "Fix login button padding",
    state: "open",
    draft: false,
    user: { login: "testuser" },
    head: { label: "testuser:fix-login-button", ref: "fix-login-button", sha: "abc123def456" },
    base: { label: "owner:main", ref: "main", sha: "def456abc789" },
    created_at: "2025-01-16T09:00:00Z",
    updated_at: "2025-01-18T11:00:00Z",
    closed_at: null,
    merged_at: null,
    labels: [{ name: "bug", color: "d73a4a" }],
    html_url: "https://github.com/owner/repo/pull/43",
  },
  {
    number: 42,
    title: "Add new feature X",
    state: "open",
    draft: true,
    user: { login: "collaborator1" },
    head: { label: "collaborator1:feature-x", ref: "feature-x", sha: "ghi789jkl012" },
    base: { label: "owner:main", ref: "main", sha: "def456abc789" },
    created_at: "2025-01-15T14:00:00Z",
    updated_at: "2025-01-17T09:00:00Z",
    closed_at: null,
    merged_at: null,
    labels: [{ name: "enhancement", color: "a2eeef" }],
    html_url: "https://github.com/owner/repo/pull/42",
  },
];

/** Fixture: Single PR response */
export const PR_GET_RESPONSE: any = {
  number: 43,
  title: "Fix login button padding",
  body: "Fixes the padding issue on the login button.",
  state: "open",
  draft: false,
  user: { login: "testuser", id: 1, avatar_url: "https://avatars.githubusercontent.com/u/1" },
  assignees: [{ login: "reviewer1", id: 2 }],
  requested_reviewers: [{ login: "maintainer1", id: 3 }],
  labels: [
    { name: "bug", color: "d73a4a" },
    { name: "frontend", color: "bfdadc" },
  ],
  head: {
    label: "testuser:fix-login-button",
    ref: "fix-login-button",
    sha: "abc123def456",
    repo: { full_name: "testuser/repo" },
  },
  base: {
    label: "owner:main",
    ref: "main",
    sha: "def456abc789",
    repo: { full_name: "owner/repo" },
  },
  created_at: "2025-01-16T09:00:00Z",
  updated_at: "2025-01-18T11:00:00Z",
  closed_at: null,
  merged_at: null,
  merge_commit_sha: null,
  commits: 2,
  additions: 50,
  deletions: 10,
  changed_files: 3,
  html_url: "https://github.com/owner/repo/pull/43",
};

/** Fixture: PR commits response */
export const PR_COMMITS_RESPONSE: any[] = [
  {
    sha: "abc123def456",
    commit: {
      message: "Fix login button padding\n\nUpdated CSS padding values.",
      author: { name: "Test User", date: "2025-01-16T09:30:00Z" },
    },
    author: { login: "testuser" },
  },
  {
    sha: "abc789def012",
    commit: {
      message: "Add tests for login button",
      author: { name: "Test User", date: "2025-01-16T10:00:00Z" },
    },
    author: { login: "testuser" },
  },
];

/** Fixture: PR files response */
export const PR_FILES_RESPONSE: any[] = [
  {
    filename: "src/button.tsx",
    status: "modified",
    additions: 30,
    deletions: 5,
    changes: 35,
    patch: "@@ -10,7 +10,12 @@\n .btn {\n-  padding: 8px;\n+  padding: 12px 16px;\n }",
  },
  {
    filename: "src/button.css",
    status: "modified",
    additions: 20,
    deletions: 5,
    changes: 25,
    patch: "@@ -5,7 +5,10 @@\n .login-btn {\n+  margin: 4px;\n }",
  },
];

/** Fixture: PR created response */
export const PR_CREATE_RESPONSE: any = {
  number: 45,
  title: "New feature",
  state: "open",
  draft: false,
  user: { login: "testuser" },
  head: { label: "testuser:feature-branch", ref: "feature-branch" },
  base: { label: "owner:main", ref: "main" },
  created_at: "2025-02-01T12:00:00Z",
  html_url: "https://github.com/owner/repo/pull/45",
};

/** Fixture: PR merged response */
export const PR_MERGE_RESPONSE: any = {
  merged: true,
  message: "Pull Request successfully merged",
  sha: "abc123def456",
};

/** Fixture: PR not found response */
export const PRS_NOT_FOUND_RESPONSE: any = {
  message: "Not Found",
  documentation_url: "https://docs.github.com/rest/pulls/pulls#get-a-pull-request",
};
