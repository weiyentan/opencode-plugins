/**
 * MapExecutionEnvironment Unit Tests
 *
 * Tests for the mapExecutionEnvironment() pure function: validates that raw
 * AWX API execution environment responses are correctly transformed into the
 * ExecutionEnvironmentDetailOutput contract format, including name resolution
 * from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { mapExecutionEnvironment } from "../src/mappers/map-execution-environment.js";
import type { ExecutionEnvironmentDetailOutput } from "../src/contracts/execution-environment-detail.js";

/** Raw AWX execution environment API response fixture */
const MOCK_RAW_EE: Record<string, unknown> = {
  id: 2,
  name: "AWX EE 2.4",
  description: "Default AWX execution environment",
  image: "quay.io/ansible/awx-ee:latest",
  created: "2025-01-01T00:00:00Z",
  modified: "2025-06-15T08:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

describe("mapExecutionEnvironment()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const result = mapExecutionEnvironment(MOCK_RAW_EE);

    expect(result.data.id).toBe(2);
    expect(result.data.name).toBe("AWX EE 2.4");
    expect(result.data.description).toBe("Default AWX execution environment");
    expect(result.data.image).toBe("quay.io/ansible/awx-ee:latest");
    expect(result.data.created).toBe("2025-01-01T00:00:00Z");
    expect(result.data.modified).toBe("2025-06-15T08:00:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved organization name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves organization name from summary_fields", () => {
    const result = mapExecutionEnvironment(MOCK_RAW_EE);

    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const result = mapExecutionEnvironment(MOCK_RAW_EE);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("execution-environment");
    expect(result.id).toBe(2);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Handles missing summary_fields gracefully
     ══════════════════════════════════════════════════════════════ */

  it("returns empty organization_name when summary_fields is missing", () => {
    const raw: Record<string, unknown> = {
      id: 99,
      name: "orphan-ee",
      description: "",
      image: "quay.io/ansible/awx-ee:latest",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
    };

    const result = mapExecutionEnvironment(raw);

    expect(result.data.organization_name).toBe("");
  });
});
