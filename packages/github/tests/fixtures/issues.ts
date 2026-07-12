/**
 * Test fixtures for REST-based issue tools (github.issue.*).
 *
 * These fixtures simulate the shape of the GitHub REST API response
 * for issues endpoints (list, get, create, update, comment).
 *
 * GitHub REST API returns snake_case fields.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: List of open issues (standard paginated response) */
export const ISSUE_LIST_RESPONSE: any[] = [
  {
    url: "https://api.github.com/repos/owner/repo/issues/42",
    html_url: "https://github.com/owner/repo/issues/42",
    number: 42,
    title: "Fix the login button styling",
    state: "open",
    body: "The login button on the homepage has incorrect padding.",
    user: { login: "testuser", id: 1001 },
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "frontend", color: "1d76db" },
    ],
    assignees: [{ login: "testuser", id: 1001 }],
    comments: 2,
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-20T14:30:00Z",
    closed_at: null,
    pull_request: null,
  },
  {
    url: "https://api.github.com/repos/owner/repo/issues/43",
    html_url: "https://github.com/owner/repo/issues/43",
    number: 43,
    title: "Add dark mode support",
    state: "open",
    body: "We should support dark mode for better accessibility.",
    user: { login: "collaborator1", id: 1002 },
    labels: [
      { name: "enhancement", color: "a2eeef" },
    ],
    assignees: [],
    comments: 0,
    created_at: "2025-02-01T08:00:00Z",
    updated_at: "2025-02-01T08:00:00Z",
    closed_at: null,
    pull_request: null,
  },
];

/** Fixture: Single open issue */
export const ISSUE_GET_RESPONSE: any = {
  url: "https://api.github.com/repos/owner/repo/issues/42",
  html_url: "https://github.com/owner/repo/issues/42",
  number: 42,
  title: "Fix the login button styling",
  state: "open",
  body: "The login button on the homepage has incorrect padding.",
  user: { login: "testuser", id: 1001 },
  labels: [
    { name: "bug", color: "d73a4a" },
    { name: "frontend", color: "1d76db" },
  ],
  assignees: [{ login: "testuser", id: 1001 }],
  comments: 2,
  created_at: "2025-01-15T10:00:00Z",
  updated_at: "2025-01-20T14:30:00Z",
  closed_at: null,
  pull_request: null,
};

/** Fixture: Closed issue */
export const ISSUE_CLOSED_RESPONSE: any = {
  url: "https://api.github.com/repos/owner/repo/issues/99",
  html_url: "https://github.com/owner/repo/issues/99",
  number: 99,
  title: "Simple typo in readme",
  state: "closed",
  body: "Fix a small typo.",
  user: { login: "contributor1", id: 1003 },
  labels: [],
  assignees: [],
  comments: 0,
  created_at: "2025-02-01T08:00:00Z",
  updated_at: "2025-02-02T09:00:00Z",
  closed_at: "2025-02-02T09:00:00Z",
  pull_request: null,
};

/** Fixture: Response for creating an issue */
export const ISSUE_CREATE_RESPONSE: any = {
  url: "https://api.github.com/repos/owner/repo/issues/101",
  html_url: "https://github.com/owner/repo/issues/101",
  number: 101,
  title: "New bug report",
  state: "open",
  body: "Description of the bug.",
  user: { login: "testuser", id: 1001 },
  labels: [{ name: "bug", color: "d73a4a" }],
  assignees: [],
  comments: 0,
  created_at: "2025-03-01T12:00:00Z",
  updated_at: "2025-03-01T12:00:00Z",
  closed_at: null,
  pull_request: null,
};

/** Fixture: Response for updating an issue (state changed to closed) */
export const ISSUE_UPDATE_RESPONSE: any = {
  url: "https://api.github.com/repos/owner/repo/issues/42",
  html_url: "https://github.com/owner/repo/issues/42",
  number: 42,
  title: "Fix the login button styling",
  state: "closed",
  body: "The login button on the homepage has incorrect padding.",
  user: { login: "testuser", id: 1001 },
  labels: [
    { name: "bug", color: "d73a4a" },
    { name: "frontend", color: "1d76db" },
  ],
  assignees: [],
  comments: 2,
  created_at: "2025-01-15T10:00:00Z",
  updated_at: "2025-03-02T14:00:00Z",
  closed_at: "2025-03-02T14:00:00Z",
  pull_request: null,
};

/** Fixture: Response for adding a comment */
export const ISSUE_COMMENT_RESPONSE: any = {
  id: 5678,
  url: "https://api.github.com/repos/owner/repo/issues/comments/5678",
  html_url: "https://github.com/owner/repo/issues/42#issuecomment-5678",
  body: "I am looking into this issue.",
  user: { login: "testuser", id: 1001 },
  created_at: "2025-03-01T13:00:00Z",
  updated_at: "2025-03-01T13:00:00Z",
};

/** Fixture: Empty list response */
export const ISSUE_LIST_EMPTY_RESPONSE: any[] = [];

/** Fixture: Error response with validation errors (422) */
export const ISSUE_VALIDATION_ERROR_RESPONSE: any = {
  message: "Validation Failed",
  errors: [
    { resource: "Issue", code: "missing_field", field: "title" },
  ],
  documentation_url:
    "https://docs.github.com/rest/issues/issues#create-an-issue",
};

/** Fixture: Error response for not found (404 style) – not a real GitHub response body for 404 */
export const ISSUE_NOT_FOUND_BODY: any = {
  message: "Not Found",
  documentation_url:
    "https://docs.github.com/rest/issues/issues#get-an-issue",
};
