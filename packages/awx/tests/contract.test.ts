/**
 * Contract Tests — JobDetailOutput snapshot validation
 *
 * Validates that each pre-baked fixture JSON file matches the
 * v1.0 JobDetailOutput contract shape.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { JobDetailOutput } from "../src/contracts/job-detail.js";

/** Resolve a fixture file path relative to the tests/fixtures/ directory */
function fixturePath(name: string): string {
  return resolve(__dirname, "fixtures", name);
}

/** Load and parse a fixture JSON file */
function loadFixture(name: string): unknown {
  const raw = readFileSync(fixturePath(name), "utf-8");
  return JSON.parse(raw) as unknown;
}

/** Assert that a value is a valid JobDetailOutput */
function expectValidContract(data: unknown, overrides?: Partial<JobDetailOutput>): asserts data is JobDetailOutput {
  const d = data as Record<string, unknown>;
  expect(d).toHaveProperty("schema_version", overrides?.schema_version ?? "1.0");
  expect(d).toHaveProperty("job");
  expect(d).toHaveProperty("related");
  expect(d).toHaveProperty("host_status_counts");
  expect(d).toHaveProperty("derived");
  expect(Array.isArray(d.warnings)).toBe(true);
  expect(Array.isArray(d.errors)).toBe(true);
}

describe("JobDetailOutput Contract — Snapshot Validation", () => {
  it("validates the success fixture against the v1.0 contract", () => {
    const data = loadFixture("awx_job_success.json");
    expectValidContract(data);

    const parsed = data as JobDetailOutput;
    expect(parsed.schema_version).toBe("1.0");
    expect(parsed.derived.is_successful).toBe(true);
    expect(parsed.derived.is_failed).toBe(false);
    expect(parsed.derived.has_unreachable_hosts).toBe(false);
  });

  it("validates the partial fixture against the v1.0 contract", () => {
    const data = loadFixture("awx_job_partial.json");
    expectValidContract(data);

    const parsed = data as JobDetailOutput;
    expect(parsed.host_status_counts.unreachable).toBeGreaterThanOrEqual(1);
    expect(parsed.derived.has_unreachable_hosts).toBe(true);
    expect(parsed.derived.is_failed).toBe(false);
  });

  it("validates the failure fixture against the v1.0 contract", () => {
    const data = loadFixture("awx_job_failure.json");
    expectValidContract(data);

    const parsed = data as JobDetailOutput;
    expect(parsed.derived.is_failed).toBe(true);
    expect(parsed.derived.is_successful).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("loads and validates all three fixtures without throwing", () => {
    expect(() => loadFixture("awx_job_success.json")).not.toThrow();
    expect(() => loadFixture("awx_job_partial.json")).not.toThrow();
    expect(() => loadFixture("awx_job_failure.json")).not.toThrow();
  });
});
