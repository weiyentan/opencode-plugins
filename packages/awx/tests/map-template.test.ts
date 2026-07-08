/**
 * MapTemplate Unit Tests
 *
 * Tests for the mapTemplate() pure function: validates that raw AWX API
 * template responses are correctly transformed into the TemplateDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapTemplate } from "../src/mappers/map-template.js";
import type { TemplateDetailOutput } from "../src/contracts/template-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX template API fixture */
function loadRawTemplateFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_template.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mapTemplate()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const raw = loadRawTemplateFixture();
    const result = mapTemplate(raw);

    expect(result.data.id).toBe(7);
    expect(result.data.name).toBe("Deploy Web Stack — Production");
    expect(result.data.description).toBe("Deploy the web application stack to production servers");
    expect(result.data.job_type).toBe("run");
    expect(result.data.playbook).toBe("deploy-web-stack.yml");
    expect(result.data.verbosity).toBe(2);
    expect(result.data.status).toBe("successful");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved names from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves related resource names from summary_fields", () => {
    const raw = loadRawTemplateFixture();
    const result = mapTemplate(raw);

    expect(result.data.inventory_name).toBe("Production");
    expect(result.data.project_name).toBe("Web Stack Deploy");
    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Boolean launch flags
     ══════════════════════════════════════════════════════════════ */

  it("maps boolean launch-time prompt flags", () => {
    const raw = loadRawTemplateFixture();
    const result = mapTemplate(raw);

    expect(result.data.ask_variables_on_launch).toBe(true);
    expect(result.data.ask_inventory_on_launch).toBe(false);
    expect(result.data.ask_limit_on_launch).toBe(true);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Labels array from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves label names from summary_fields.labels.results", () => {
    const raw = loadRawTemplateFixture();
    const result = mapTemplate(raw);

    expect(result.data.labels).toEqual(["production", "web", "deploy"]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Nullable fields (last_job_run, next_schedule)
     ══════════════════════════════════════════════════════════════ */

  it("maps nullable last_job_run and next_schedule fields", () => {
    const raw = loadRawTemplateFixture();
    const result = mapTemplate(raw);

    expect(result.data.last_job_run).toBe("2025-06-15T14:32:00Z");
    expect(result.data.next_schedule).toBeNull();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const raw = loadRawTemplateFixture();
    const result = mapTemplate(raw);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("template");
    expect(result.id).toBe(7);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Missing summary_fields (robustness)
     ══════════════════════════════════════════════════════════════ */

  it("handles missing summary_fields gracefully with empty defaults", () => {
    const raw: Record<string, unknown> = {
      id: 99,
      name: "Minimal Template",
      description: "",
      job_type: "run",
      playbook: "minimal.yml",
      verbosity: 0,
      ask_variables_on_launch: false,
      ask_inventory_on_launch: false,
      ask_limit_on_launch: false,
      last_job_run: null,
      status: "never updated",
      next_schedule: null,
    };

    const result = mapTemplate(raw);

    expect(result.data.inventory_name).toBe("");
    expect(result.data.project_name).toBe("");
    expect(result.data.organization_name).toBe("");
    expect(result.data.labels).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: Missing labels in summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("handles missing labels results with empty array", () => {
    const raw = {
      ...loadRawTemplateFixture(),
      summary_fields: {
        inventory: { id: 1, name: "Production" },
        project: { id: 3, name: "Web Stack Deploy" },
        organization: { id: 1, name: "Default" },
        labels: {},
      },
    };

    const result = mapTemplate(raw);

    expect(result.data.labels).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 9: Credentials from summary_fields (object-with-results shape)
     ══════════════════════════════════════════════════════════════ */

  it("resolves credentials from summary_fields.credentials.results (object shape)", () => {
    const raw = loadRawTemplateFixture();
    const result = mapTemplate(raw);

    expect(result.data.credentials).toEqual([
      { id: 5, name: "Production SSH", credential_type_id: 1, kind: "ssh" },
      { id: 8, name: "Vault Token", credential_type_id: 4, kind: "vault" },
    ]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 10: Credentials as plain array shape (the bug fix)
     ══════════════════════════════════════════════════════════════ */

  it("resolves credentials when summary_fields.credentials is a plain array", () => {
    const raw: Record<string, unknown> = {
      id: 10,
      name: "Array Creds Template",
      description: "Template with array-shaped credentials",
      job_type: "run",
      playbook: "test.yml",
      verbosity: 0,
      ask_variables_on_launch: false,
      ask_inventory_on_launch: false,
      ask_limit_on_launch: false,
      last_job_run: null,
      status: "never updated",
      next_schedule: null,
      summary_fields: {
        credentials: [
          { id: 1, name: "Machine Cred", credential_type_id: 1, kind: "ssh" },
          { id: 2, name: "Vault Cred", credential_type_id: 4, kind: "vault" },
        ],
      },
    };

    const result = mapTemplate(raw);

    expect(result.data.credentials).toEqual([
      { id: 1, name: "Machine Cred", credential_type_id: 1, kind: "ssh" },
      { id: 2, name: "Vault Cred", credential_type_id: 4, kind: "vault" },
    ]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 11: Missing/null credentials returns empty array
     ══════════════════════════════════════════════════════════════ */

  it("returns empty credentials array when summary_fields.credentials is missing or null", () => {
    // Case 1: no summary_fields at all
    const raw1: Record<string, unknown> = {
      id: 11,
      name: "No Summary",
      description: "",
      job_type: "run",
      playbook: "test.yml",
      verbosity: 0,
      ask_variables_on_launch: false,
      ask_inventory_on_launch: false,
      ask_limit_on_launch: false,
      last_job_run: null,
      status: "never updated",
      next_schedule: null,
    };

    // Case 2: summary_fields exists but credentials is null
    const raw2: Record<string, unknown> = {
      ...raw1,
      id: 12,
      name: "Null Creds",
      summary_fields: { credentials: null },
    };

    // Case 3: summary_fields exists but credentials is missing
    const raw3: Record<string, unknown> = {
      ...raw1,
      id: 13,
      name: "Missing Creds",
      summary_fields: {},
    };

    expect(mapTemplate(raw1).data.credentials).toEqual([]);
    expect(mapTemplate(raw2).data.credentials).toEqual([]);
    expect(mapTemplate(raw3).data.credentials).toEqual([]);
  });
});
