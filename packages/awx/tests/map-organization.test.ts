/**
 * MapOrganization Unit Tests
 *
 * Tests for the mapOrganization() pure function: validates that raw AWX API
 * organization responses are correctly transformed into the
 * OrganizationDetailOutput contract format, including related resource counts.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { mapOrganization } from "../src/mappers/map-organization.js";
import type { OrganizationDetailOutput } from "../src/contracts/organization-detail.js";

/** Raw AWX organization API response fixture */
const MOCK_RAW_ORGANIZATION: Record<string, unknown> = {
  id: 1,
  name: "Default",
  description: "Default organization",
  created: "2025-01-01T00:00:00Z",
  modified: "2025-06-15T12:00:00Z",
  summary_fields: {
    related: {
      users: { count: 3, results: [] },
      teams: { count: 2, results: [] },
      job_templates: { count: 5, results: [] },
      projects: { count: 3, results: [] },
      inventories: { count: 2, results: [] },
    },
  },
};

describe("mapOrganization()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const result = mapOrganization(MOCK_RAW_ORGANIZATION);

    expect(result.data.id).toBe(1);
    expect(result.data.name).toBe("Default");
    expect(result.data.description).toBe("Default organization");
    expect(result.data.created).toBe("2025-01-01T00:00:00Z");
    expect(result.data.modified).toBe("2025-06-15T12:00:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Related resource counts from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("extracts related resource counts from summary_fields.related", () => {
    const result = mapOrganization(MOCK_RAW_ORGANIZATION);

    expect(result.data.related.users).toBe(3);
    expect(result.data.related.teams).toBe(2);
    expect(result.data.related.job_templates).toBe(5);
    expect(result.data.related.projects).toBe(3);
    expect(result.data.related.inventories).toBe(2);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const result = mapOrganization(MOCK_RAW_ORGANIZATION);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("organization");
    expect(result.id).toBe(1);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Handles missing summary_fields gracefully
     ══════════════════════════════════════════════════════════════ */

  it("returns zero counts when summary_fields.related is missing", () => {
    const raw: Record<string, unknown> = {
      id: 2,
      name: "Empty Org",
      description: "",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
    };

    const result = mapOrganization(raw);

    expect(result.data.related.users).toBe(0);
    expect(result.data.related.teams).toBe(0);
    expect(result.data.related.job_templates).toBe(0);
    expect(result.data.related.projects).toBe(0);
    expect(result.data.related.inventories).toBe(0);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Handles partial related section gracefully
     ══════════════════════════════════════════════════════════════ */

  it("returns zero for missing individual counts in related section", () => {
    const raw: Record<string, unknown> = {
      id: 3,
      name: "Partial Org",
      description: "",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
      summary_fields: {
        related: {
          users: { count: 5, results: [] },
          // teams, job_templates, projects, inventories all missing
        },
      },
    };

    const result = mapOrganization(raw);

    expect(result.data.related.users).toBe(5);
    expect(result.data.related.teams).toBe(0);
    expect(result.data.related.job_templates).toBe(0);
    expect(result.data.related.projects).toBe(0);
    expect(result.data.related.inventories).toBe(0);
  });
});
