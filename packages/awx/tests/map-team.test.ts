/**
 * MapTeam Unit Tests
 *
 * Tests for the mapTeam() pure function: validates that raw AWX API
 * team responses are correctly transformed into the TeamDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapTeam } from "../src/mappers/map-team.js";
import type { TeamDetailOutput } from "../src/contracts/team-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX team API fixture */
function loadRawTeamFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_team.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mapTeam()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const raw = loadRawTeamFixture();
    const result = mapTeam(raw);

    expect(result.data.id).toBe(15);
    expect(result.data.name).toBe("Platform Engineers");
    expect(result.data.description).toBe("Platform engineering team");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved organization name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves organization name from summary_fields", () => {
    const raw = loadRawTeamFixture();
    const result = mapTeam(raw);

    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Timestamps
     ══════════════════════════════════════════════════════════════ */

  it("maps created and modified timestamps", () => {
    const raw = loadRawTeamFixture();
    const result = mapTeam(raw);

    expect(result.data.created).toBe("2025-02-01T10:00:00Z");
    expect(result.data.modified).toBe("2025-06-15T12:30:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const raw = loadRawTeamFixture();
    const result = mapTeam(raw);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("team");
    expect(result.id).toBe(15);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });
});
