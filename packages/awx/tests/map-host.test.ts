/**
 * MapHost Unit Tests
 *
 * Tests for the mapHost() pure function: validates that raw AWX API
 * host responses are correctly transformed into the HostDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { mapHost } from "../src/mappers/map-host.js";
import type { HostDetailOutput } from "../src/contracts/host-detail.js";

/** Raw AWX host API response fixture */
const MOCK_RAW_HOST: Record<string, unknown> = {
  id: 42,
  name: "web-01.example.com",
  description: "Primary web server",
  variables: "---\nansible_user: admin\n",
  created: "2025-01-15T08:30:00Z",
  modified: "2025-06-20T12:00:00Z",
  summary_fields: {
    inventory: { id: 5, name: "Production Servers" },
  },
};

describe("mapHost()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const result = mapHost(MOCK_RAW_HOST);

    expect(result.data.id).toBe(42);
    expect(result.data.name).toBe("web-01.example.com");
    expect(result.data.description).toBe("Primary web server");
    expect(result.data.created).toBe("2025-01-15T08:30:00Z");
    expect(result.data.modified).toBe("2025-06-20T12:00:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved inventory name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves inventory name from summary_fields", () => {
    const result = mapHost(MOCK_RAW_HOST);

    expect(result.data.inventory_name).toBe("Production Servers");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Variables field
     ══════════════════════════════════════════════════════════════ */

  it("maps variables string from the raw response", () => {
    const result = mapHost(MOCK_RAW_HOST);

    expect(result.data.variables).toBe("---\nansible_user: admin\n");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const result = mapHost(MOCK_RAW_HOST);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("host");
    expect(result.id).toBe(42);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Handles missing summary_fields gracefully
     ══════════════════════════════════════════════════════════════ */

  it("returns empty inventory_name when summary_fields is missing", () => {
    const raw: Record<string, unknown> = {
      id: 99,
      name: "standalone-host",
      description: "",
      variables: "",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
    };

    const result = mapHost(raw);

    expect(result.data.inventory_name).toBe("");
  });
});
