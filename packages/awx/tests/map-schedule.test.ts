/**
 * MapSchedule Unit Tests
 *
 * Tests for the mapSchedule() pure function: validates that raw AWX API
 * schedule responses are correctly transformed into the ScheduleDetailOutput
 * contract format, including resolved names from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapSchedule } from "../src/mappers/map-schedule.js";
import type { ScheduleDetailOutput } from "../src/contracts/schedule-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX schedule API fixture */
function loadRawScheduleFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_schedule.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mapSchedule()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const raw = loadRawScheduleFixture();
    const result = mapSchedule(raw);

    expect(result.data.id).toBe(8);
    expect(result.data.name).toBe("Daily Deploy");
    expect(result.data.description).toBe("Daily production deploy");
    expect(result.data.rrule).toBe("DTSTART:20250101T000000Z RRULE:FREQ=DAILY;INTERVAL=1");
    expect(result.data.next_run).toBe("2025-07-11T00:00:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved unified_job_template name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves unified_job_template name from summary_fields", () => {
    const raw = loadRawScheduleFixture();
    const result = mapSchedule(raw);

    expect(result.data.unified_job_template_name).toBe("Deploy Web Stack - Production");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Resolved organization name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves organization name from summary_fields", () => {
    const raw = loadRawScheduleFixture();
    const result = mapSchedule(raw);

    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Timestamps
     ══════════════════════════════════════════════════════════════ */

  it("maps created and modified timestamps", () => {
    const raw = loadRawScheduleFixture();
    const result = mapSchedule(raw);

    expect(result.data.created).toBe("2025-01-01T00:00:00Z");
    expect(result.data.modified).toBe("2025-06-30T08:00:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const raw = loadRawScheduleFixture();
    const result = mapSchedule(raw);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("schedule");
    expect(result.id).toBe(8);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Nullish fallback for absent summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("falls back gracefully when summary_fields are absent", () => {
    const raw = {
      id: 99,
      name: "Minimal Schedule",
      description: "",
      rrule: "DTSTART:20250101T000000Z RRULE:FREQ=WEEKLY",
      next_run: null,
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
    };

    const result = mapSchedule(raw);

    expect(result.data.unified_job_template_name).toBe("");
    expect(result.data.organization_name).toBe("");
    expect(result.data.next_run).toBeNull();
  });
});
