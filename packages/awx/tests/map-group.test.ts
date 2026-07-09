/**
 * MapGroup Unit Tests
 *
 * Tests for the mapGroup() pure function: validates that raw AWX API
 * group responses are correctly transformed into the GroupDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { mapGroup } from "../src/mappers/map-group.js";
import type { GroupDetailOutput } from "../src/contracts/group-detail.js";

/** Raw AWX group API response fixture */
const MOCK_RAW_GROUP: Record<string, unknown> = {
  id: 15,
  name: "web-servers",
  description: "Web server group",
  variables: "---\nhttp_port: 80\n",
  created: "2025-02-10T10:00:00Z",
  modified: "2025-06-15T14:30:00Z",
  summary_fields: {
    inventory: { id: 5, name: "Production Servers" },
  },
};

describe("mapGroup()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const result = mapGroup(MOCK_RAW_GROUP);

    expect(result.data.id).toBe(15);
    expect(result.data.name).toBe("web-servers");
    expect(result.data.description).toBe("Web server group");
    expect(result.data.created).toBe("2025-02-10T10:00:00Z");
    expect(result.data.modified).toBe("2025-06-15T14:30:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved inventory name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves inventory name from summary_fields", () => {
    const result = mapGroup(MOCK_RAW_GROUP);

    expect(result.data.inventory_name).toBe("Production Servers");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Variables field
     ══════════════════════════════════════════════════════════════ */

  it("maps variables string from the raw response", () => {
    const result = mapGroup(MOCK_RAW_GROUP);

    expect(result.data.variables).toBe("---\nhttp_port: 80\n");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const result = mapGroup(MOCK_RAW_GROUP);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("group");
    expect(result.id).toBe(15);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Handles missing summary_fields gracefully
     ══════════════════════════════════════════════════════════════ */

  it("returns empty inventory_name when summary_fields is missing", () => {
    const raw: Record<string, unknown> = {
      id: 99,
      name: "standalone-group",
      description: "",
      variables: "",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
    };

    const result = mapGroup(raw);

    expect(result.data.inventory_name).toBe("");
  });
});
