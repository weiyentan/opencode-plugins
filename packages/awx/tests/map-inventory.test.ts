/**
 * MapInventory Unit Tests
 *
 * Tests for the mapInventory() pure function: validates that raw AWX API
 * inventory responses are correctly transformed into the InventoryDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapInventory } from "../src/mappers/map-inventory.js";
import type { InventoryDetailOutput } from "../src/contracts/inventory-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX inventory API fixture */
function loadRawInventoryFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_inventory.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mapInventory()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const raw = loadRawInventoryFixture();
    const result = mapInventory(raw);

    expect(result.data.id).toBe(12);
    expect(result.data.name).toBe("Production Servers");
    expect(result.data.description).toBe("Production environment inventory with smart grouping");
    expect(result.data.kind).toBe("smart");
    expect(result.data.host_count).toBe(48);
    expect(result.data.total_groups).toBe(6);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved organization name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves organization name from summary_fields", () => {
    const raw = loadRawInventoryFixture();
    const result = mapInventory(raw);

    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Inventory source counts and flags
     ══════════════════════════════════════════════════════════════ */

  it("maps inventory source counts and has_inventory_sources flag", () => {
    const raw = loadRawInventoryFixture();
    const result = mapInventory(raw);

    expect(result.data.has_inventory_sources).toBe(true);
    expect(result.data.total_inventory_sources).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Variables field
     ══════════════════════════════════════════════════════════════ */

  it("maps variables string from the raw response", () => {
    const raw = loadRawInventoryFixture();
    const result = mapInventory(raw);

    expect(result.data.variables).toBe("---\nansible_user: deploy\nansible_python_interpreter: /usr/bin/python3");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const raw = loadRawInventoryFixture();
    const result = mapInventory(raw);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("inventory");
    expect(result.id).toBe(12);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });
});
