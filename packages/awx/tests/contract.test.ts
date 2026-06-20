/**
 * Contract Tests — JobDetailOutput snapshot validation
 *
 * Validates that each pre-baked fixture JSON file matches the
 * v1.0 JobDetailOutput schema. Uses a snapshot approach:
 * fixtures are checked into the repo and validated against
 * the TypeScript contract types via zod runtime parsing.
 *
 * No live Python subprocess — CI-safe by design.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { JobDetailOutputSchema } from "../src/contracts/job-detail.js";

/** Resolve a fixture file path relative to the tests/fixtures/ directory */
function fixturePath(name: string): string {
  return resolve(__dirname, "fixtures", name);
}

/** Load and parse a fixture JSON file */
function loadFixture(name: string): unknown {
  const raw = readFileSync(fixturePath(name), "utf-8");
  return JSON.parse(raw) as unknown;
}

describe("JobDetailOutput Contract — Snapshot Validation", () => {
  it("validates the success fixture against the v1.0 schema", () => {
    const data = loadFixture("awx_job_success.json");
    const result = JobDetailOutputSchema.safeParse(data);

    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data;
      // Verify top-level structure
      expect(parsed.schema_version).toBe("1.0");
      expect(parsed.job).toBeDefined();
      expect(parsed.related).toBeDefined();
      expect(parsed.host_status_counts).toBeDefined();
      expect(parsed.derived).toBeDefined();
      expect(Array.isArray(parsed.warnings)).toBe(true);
      expect(Array.isArray(parsed.errors)).toBe(true);
      // Derived flags should be correct for a successful job
      expect(parsed.derived.is_successful).toBe(true);
      expect(parsed.derived.is_failed).toBe(false);
      expect(parsed.derived.has_unreachable_hosts).toBe(false);
    }
  });

  it("validates the partial fixture against the v1.0 schema", () => {
    const data = loadFixture("awx_job_partial.json");
    const result = JobDetailOutputSchema.safeParse(data);

    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data;
      // A partial job has some unreachable hosts but still passes schema
      expect(parsed.host_status_counts.unreachable).toBeGreaterThanOrEqual(1);
      expect(parsed.derived.has_unreachable_hosts).toBe(true);
      expect(parsed.derived.is_failed).toBe(false);
    }
  });

  it("validates the failure fixture against the v1.0 schema", () => {
    const data = loadFixture("awx_job_failure.json");
    const result = JobDetailOutputSchema.safeParse(data);

    expect(result.success).toBe(true);
    if (result.success) {
      const parsed = result.data;
      expect(parsed.derived.is_failed).toBe(true);
      expect(parsed.derived.is_successful).toBe(false);
      expect(parsed.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects a malformed payload missing required fields", () => {
    const result = JobDetailOutputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a payload with wrong schema_version", () => {
    const result = JobDetailOutputSchema.safeParse({
      schema_version: "2.0",
    });
    expect(result.success).toBe(false);
  });
});
