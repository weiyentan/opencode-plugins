/**
 * MapInstanceGroup Unit Tests
 *
 * Tests for the mapInstanceGroup() pure function: validates that raw AWX API
 * instance group responses are correctly transformed into the
 * InstanceGroupDetailOutput contract format.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { mapInstanceGroup } from "../src/mappers/map-instance-group.js";
import type { InstanceGroupDetailOutput } from "../src/contracts/instance-group-detail.js";

/** Raw AWX instance group API response fixture */
const MOCK_RAW_INSTANCE_GROUP: Record<string, unknown> = {
  id: 3,
  name: "control-plane",
  description: "AWX control plane instances",
  created: "2025-01-01T00:00:00Z",
  modified: "2025-06-01T12:00:00Z",
};

describe("mapInstanceGroup()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const result = mapInstanceGroup(MOCK_RAW_INSTANCE_GROUP);

    expect(result.data.id).toBe(3);
    expect(result.data.name).toBe("control-plane");
    expect(result.data.description).toBe("AWX control plane instances");
    expect(result.data.created).toBe("2025-01-01T00:00:00Z");
    expect(result.data.modified).toBe("2025-06-01T12:00:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const result = mapInstanceGroup(MOCK_RAW_INSTANCE_GROUP);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("instance-group");
    expect(result.id).toBe(3);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Handles null/missing id by throwing
     ══════════════════════════════════════════════════════════════ */

  it("throws when raw response has no id", () => {
    expect(() => mapInstanceGroup({ name: "bad" })).toThrow();
  });

  it("throws when raw response is null", () => {
    expect(() => mapInstanceGroup(null)).toThrow();
  });
});
