/**
 * Test fixtures for github_code_search REST API response.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fixture: Code search response */
export const CODE_SEARCH_RESPONSE: any = {
  total_count: 10,
  incomplete_results: false,
  items: [
    {
      name: "index.ts",
      path: "src/index.ts",
      sha: "abc123def456",
      html_url: "https://github.com/owner/repo/blob/main/src/index.ts",
      git_url: "https://api.github.com/repos/owner/repo/git/blobs/abc123def456",
      repository: {
        full_name: "owner/repo",
        html_url: "https://github.com/owner/repo",
      },
      score: 1.0,
      text_matches: [
        {
          fragment: "export function hello() {\n  return 'world';\n}",
          property: "content",
        },
      ],
    },
    {
      name: "utils.ts",
      path: "src/utils.ts",
      sha: "ghi789jkl012",
      html_url: "https://github.com/owner/repo/blob/main/src/utils.ts",
      git_url: "https://api.github.com/repos/owner/repo/git/blobs/ghi789jkl012",
      repository: {
        full_name: "owner/repo",
        html_url: "https://github.com/owner/repo",
      },
      score: 0.9,
      text_matches: [
        {
          fragment: "function greet(name: string) {\n  return `Hello, ${name}`;\n}",
          property: "content",
        },
      ],
    },
  ],
};

/** Fixture: Empty code search response */
export const CODE_SEARCH_EMPTY_RESPONSE: any = {
  total_count: 0,
  incomplete_results: false,
  items: [],
};
