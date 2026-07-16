import { describe, it, expect } from "vitest";
import { projectPathSegment } from "../src/project-path.js";

describe("projectPathSegment", () => {
  it("passes numeric IDs through as-is", () => {
    expect(projectPathSegment(12345)).toBe("12345");
  });

  it("passes numeric string IDs through as-is", () => {
    expect(projectPathSegment("12345")).toBe("12345");
  });

  it("encodes slashes in project paths", () => {
    expect(projectPathSegment("group/subgroup/project")).toBe("group%2Fsubgroup%2Fproject");
  });

  it("does not double-encode already-encoded paths", () => {
    expect(projectPathSegment("group%2Fsubgroup%2Fproject")).toBe("group%2Fsubgroup%2Fproject");
  });

  it("handles single-segment project names", () => {
    expect(projectPathSegment("my-project")).toBe("my-project");
  });

  it("handles empty string", () => {
    expect(projectPathSegment("")).toBe("");
  });

  it("handles project paths with special characters", () => {
    expect(projectPathSegment("group/sub project")).toBe("group%2Fsub%20project");
  });
});
