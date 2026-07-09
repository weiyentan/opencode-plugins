/**
 * MapLabel Unit Tests
 *
 * Tests for the mapLabel() pure function: validates that raw AWX API
 * label responses are correctly transformed into the LabelDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { mapLabel } from "../src/mappers/map-label.js";
import type { LabelDetailOutput } from "../src/contracts/label-detail.js";

/** Raw AWX label API response fixture */
const MOCK_RAW_LABEL: Record<string, unknown> = {
  id: 7,
  name: "production",
  description: "Production environment label",
  created: "2025-03-01T09:00:00Z",
  modified: "2025-06-10T11:00:00Z",
  summary_fields: {
    organization: { id: 1, name: "Default" },
  },
};

describe("mapLabel()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const result = mapLabel(MOCK_RAW_LABEL);

    expect(result.data.id).toBe(7);
    expect(result.data.name).toBe("production");
    expect(result.data.description).toBe("Production environment label");
    expect(result.data.created).toBe("2025-03-01T09:00:00Z");
    expect(result.data.modified).toBe("2025-06-10T11:00:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved organization name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves organization name from summary_fields", () => {
    const result = mapLabel(MOCK_RAW_LABEL);

    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const result = mapLabel(MOCK_RAW_LABEL);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("label");
    expect(result.id).toBe(7);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Handles missing summary_fields gracefully
     ══════════════════════════════════════════════════════════════ */

  it("returns empty organization_name when summary_fields is missing", () => {
    const raw: Record<string, unknown> = {
      id: 99,
      name: "orphan-label",
      description: "",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
    };

    const result = mapLabel(raw);

    expect(result.data.organization_name).toBe("");
  });
});
