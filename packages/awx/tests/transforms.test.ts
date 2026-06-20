import { describe, it, expect } from "vitest";
import { normalizeScmUrl, inferGitBranch, validateRequiredVars } from "../src/transforms";

// ============================================================================
// normalizeScmUrl — SSH to HTTPS URL conversion
// ============================================================================

describe("normalizeScmUrl", () => {
  describe("SSH → HTTPS conversion", () => {
    it("converts GitHub SSH URL to HTTPS", () => {
      expect(normalizeScmUrl("git@github.com:org/repo.git")).toBe(
        "https://github.com/org/repo"
      );
    });

    it("converts GitLab SSH URL with subgroup to HTTPS", () => {
      expect(normalizeScmUrl("git@gitlab.com:group/subgroup/repo.git")).toBe(
        "https://gitlab.com/group/subgroup/repo"
      );
    });

    it("converts Bitbucket SSH URL to HTTPS", () => {
      expect(normalizeScmUrl("git@bitbucket.org:team/project.git")).toBe(
        "https://bitbucket.org/team/project"
      );
    });

    it("converts SSH URL without .git suffix", () => {
      expect(normalizeScmUrl("git@github.com:org/repo")).toBe(
        "https://github.com/org/repo"
      );
    });

    it("converts SSH URL with numeric path segment", () => {
      // In SCP syntax, everything after the first colon is the path
      expect(normalizeScmUrl("git@git.example.com:2222/org/repo.git")).toBe(
        "https://git.example.com/2222/org/repo"
      );
    });
  });

  describe("already-HTTPS passthrough", () => {
    it("returns already-HTTPS URL unchanged", () => {
      const url = "https://github.com/org/repo.git";
      expect(normalizeScmUrl(url)).toBe(url);
    });

    it("returns HTTPS URL without .git unchanged", () => {
      const url = "https://gitlab.com/group/repo";
      expect(normalizeScmUrl(url)).toBe(url);
    });
  });

  describe("non-SSH URLs passthrough", () => {
    it("returns HTTP URL unchanged", () => {
      const url = "http://example.com/repo.git";
      expect(normalizeScmUrl(url)).toBe(url);
    });

    it("returns plain string unchanged", () => {
      const url = "not-a-url";
      expect(normalizeScmUrl(url)).toBe(url);
    });

    it("returns file:// URL unchanged", () => {
      const url = "file:///path/to/repo.git";
      expect(normalizeScmUrl(url)).toBe(url);
    });
  });

  describe("edge cases", () => {
    it("returns empty string for null input", () => {
      expect(normalizeScmUrl(null as unknown as string)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(normalizeScmUrl(undefined as unknown as string)).toBe("");
    });

    it("returns empty string for empty string input", () => {
      expect(normalizeScmUrl("")).toBe("");
    });

    it("handles SSH URL with no colon separator gracefully", () => {
      // malformed SSH-like but not actually SSH format
      const input = "git@github.com-repo.git";
      const result = normalizeScmUrl(input);
      // Should return something (not throw); unchanged is acceptable
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// inferGitBranch — extract branch name from ref string
// ============================================================================

describe("inferGitBranch", () => {
  describe("refs/heads extraction", () => {
    it('extracts "main" from refs/heads/main', () => {
      expect(inferGitBranch("refs/heads/main")).toBe("main");
    });

    it('extracts "develop" from refs/heads/develop', () => {
      expect(inferGitBranch("refs/heads/develop")).toBe("develop");
    });

    it("extracts multi-segment branch name", () => {
      expect(inferGitBranch("refs/heads/feature/login-page")).toBe(
        "feature/login-page"
      );
    });

    it("extracts deeply nested branch name", () => {
      expect(inferGitBranch("refs/heads/fix/urgent/critical-bug")).toBe(
        "fix/urgent/critical-bug"
      );
    });
  });

  describe("refs/tags extraction", () => {
    it('extracts "v1.0" from refs/tags/v1.0', () => {
      expect(inferGitBranch("refs/tags/v1.0")).toBe("v1.0");
    });

    it("extracts multi-segment tag name", () => {
      expect(inferGitBranch("refs/tags/release/v2.3.1")).toBe(
        "release/v2.3.1"
      );
    });
  });

  describe("raw branch names (no ref prefix)", () => {
    it('returns "main" unchanged when given raw branch name', () => {
      expect(inferGitBranch("main")).toBe("main");
    });

    it('returns "feature/foo" unchanged when given raw branch name', () => {
      expect(inferGitBranch("feature/foo")).toBe("feature/foo");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for null input", () => {
      expect(inferGitBranch(null as unknown as string)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(inferGitBranch(undefined as unknown as string)).toBe("");
    });

    it("returns empty string for empty string input", () => {
      expect(inferGitBranch("")).toBe("");
    });

    it("returns empty string for refs/heads/ with no branch", () => {
      expect(inferGitBranch("refs/heads/")).toBe("");
    });

    it("returns full string for unrecognized ref prefix (refs/remotes/origin/main)", () => {
      // Not heads or tags — pass through the full ref as-is
      expect(inferGitBranch("refs/remotes/origin/main")).toBe(
        "refs/remotes/origin/main"
      );
    });
  });
});

// ============================================================================
// validateRequiredVars — validate required extra vars are present
// ============================================================================

describe("validateRequiredVars", () => {
  describe("detecting missing vars", () => {
    it("returns missing var when one is absent", () => {
      const vars = { name: "test", target: "prod" };
      const result = validateRequiredVars(vars, ["name", "target", "branch"]);
      expect(result).toEqual(["branch"]);
    });

    it("returns all missing vars when multiple are absent", () => {
      const vars = { name: "test" };
      const result = validateRequiredVars(vars, [
        "name",
        "target",
        "branch",
        "repo_url",
      ]);
      expect(result).toEqual(["target", "branch", "repo_url"]);
    });

    it("preserves the order of missing vars from the required list", () => {
      const vars = {};
      const result = validateRequiredVars(vars, ["c", "a", "b"]);
      expect(result).toEqual(["c", "a", "b"]);
    });
  });

  describe("all vars present", () => {
    it("returns empty array when all required vars are present", () => {
      const vars = {
        name: "deploy",
        target: "production",
        branch: "main",
      };
      expect(validateRequiredVars(vars, ["name", "target", "branch"])).toEqual(
        []
      );
    });

    it("returns empty array when vars has extra keys beyond required", () => {
      const vars = { name: "test", extra: "value", another: 42 };
      expect(validateRequiredVars(vars, ["name"])).toEqual([]);
    });
  });

  describe("empty required list", () => {
    it("returns empty array when required list is empty", () => {
      const vars = { name: "test", branch: "main" };
      expect(validateRequiredVars(vars, [])).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("returns all required vars when vars is null", () => {
      const result = validateRequiredVars(
        null as unknown as Record<string, unknown>,
        ["name", "branch"]
      );
      expect(result).toEqual(["name", "branch"]);
    });

    it("returns all required vars when vars is undefined", () => {
      const result = validateRequiredVars(
        undefined as unknown as Record<string, unknown>,
        ["name", "branch"]
      );
      expect(result).toEqual(["name", "branch"]);
    });

    it("returns all required vars when vars is an empty object", () => {
      const result = validateRequiredVars({}, ["name", "branch"]);
      expect(result).toEqual(["name", "branch"]);
    });

    it("treats vars with explicit undefined value as present", () => {
      const vars = { name: undefined };
      // `name` key exists — it's present (even if value is undefined)
      expect(validateRequiredVars(vars, ["name"])).toEqual([]);
    });

    it("treats vars with null value as present", () => {
      const vars = { name: null };
      // `name` key exists — it's present
      expect(validateRequiredVars(vars, ["name"])).toEqual([]);
    });
  });
});
