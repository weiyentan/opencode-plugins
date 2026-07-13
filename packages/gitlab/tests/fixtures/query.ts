/**
 * Test fixtures for gitlab.query GraphQL responses.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: A simple viewer query response */
export const VIEWER_QUERY_RESPONSE: any = {
  currentUser: {
    id: "gid://gitlab/User/1",
    username: "testuser",
    name: "Test User",
    avatarUrl: "https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png",
  },
};

/** Fixture: A project query response */
export const PROJECT_QUERY_RESPONSE: any = {
  project: {
    id: "gid://gitlab/Project/123",
    name: "my-project",
    fullPath: "group/my-project",
    description: "A sample project",
    webUrl: "https://gitlab.com/group/my-project",
  },
};
