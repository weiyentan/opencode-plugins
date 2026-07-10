/**
 * MapUser Unit Tests
 *
 * Tests for the mapUser() pure function: validates that raw AWX API
 * user responses are correctly transformed into the UserDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapUser } from "../src/mappers/map-user.js";
import type { UserDetailOutput } from "../src/contracts/user-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX user API fixture */
function loadRawUserFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_user.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mapUser()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const raw = loadRawUserFixture();
    const result = mapUser(raw);

    expect(result.data.id).toBe(42);
    expect(result.data.username).toBe("jdoe");
    expect(result.data.first_name).toBe("Jane");
    expect(result.data.last_name).toBe("Doe");
    expect(result.data.email).toBe("jane@example.com");
    expect(result.data.is_superuser).toBe(false);
    expect(result.data.is_system_auditor).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved organization name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves organization name from summary_fields", () => {
    const raw = loadRawUserFixture();
    const result = mapUser(raw);

    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Timestamps
     ══════════════════════════════════════════════════════════════ */

  it("maps created and modified timestamps", () => {
    const raw = loadRawUserFixture();
    const result = mapUser(raw);

    expect(result.data.created).toBe("2025-01-15T09:30:00Z");
    expect(result.data.modified).toBe("2025-06-20T14:45:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const raw = loadRawUserFixture();
    const result = mapUser(raw);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("user");
    expect(result.id).toBe(42);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Password is never included in output
     ══════════════════════════════════════════════════════════════ */

  it("does not include password in the mapped output", () => {
    const raw = loadRawUserFixture();
    const result = mapUser(raw);

    expect((result.data as Record<string, unknown>).password).toBeUndefined();
  });
});
