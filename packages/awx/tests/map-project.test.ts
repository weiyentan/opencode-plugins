/**
 * MapProject Unit Tests
 *
 * Tests for the mapProject() pure function: validates that raw AWX API
 * project responses are correctly transformed into the ProjectDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapProject } from "../src/mappers/map-project.js";
import type { ProjectDetailOutput } from "../src/contracts/project-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX project API fixture */
function loadRawProjectFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_project.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mapProject()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const raw = loadRawProjectFixture();
    const result = mapProject(raw);

    expect(result.data.id).toBe(5);
    expect(result.data.name).toBe("Web Stack Deploy");
    expect(result.data.description).toBe("Ansible playbooks for deploying the web application stack");
    expect(result.data.scm_type).toBe("git");
    expect(result.data.scm_url).toBe("https://github.com/example/web-stack-deploy.git");
    expect(result.data.scm_branch).toBe("main");
    expect(result.data.status).toBe("successful");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved names from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves related resource names from summary_fields", () => {
    const raw = loadRawProjectFixture();
    const result = mapProject(raw);

    expect(result.data.organization_name).toBe("Default");
    expect(result.data.created_by).toBe("admin");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Derived flags from status field
     ══════════════════════════════════════════════════════════════ */

  it("computes derived is_successful and is_failed flags", () => {
    const raw = loadRawProjectFixture();
    const result = mapProject(raw);

    expect(result.data.is_successful).toBe(true);
    expect(result.data.is_failed).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Failed status produces correct derived flags
     ══════════════════════════════════════════════════════════════ */

  it("sets is_failed when status is 'failed'", () => {
    const raw: Record<string, unknown> = {
      ...loadRawProjectFixture(),
      status: "failed",
    };

    const result = mapProject(raw);

    expect(result.data.is_successful).toBe(false);
    expect(result.data.is_failed).toBe(true);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Never-updated project (status and last_updated)
     ══════════════════════════════════════════════════════════════ */

  it("handles never-updated project status and null last_updated", () => {
    const raw: Record<string, unknown> = {
      ...loadRawProjectFixture(),
      status: "never updated",
      last_updated: null,
    };

    const result = mapProject(raw);

    expect(result.data.status).toBe("never updated");
    expect(result.data.last_updated).toBeNull();
    expect(result.data.is_successful).toBe(false);
    expect(result.data.is_failed).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 6: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const raw = loadRawProjectFixture();
    const result = mapProject(raw);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("project");
    expect(result.id).toBe(5);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 7: Missing summary_fields (robustness)
     ══════════════════════════════════════════════════════════════ */

  it("handles missing summary_fields gracefully with empty defaults", () => {
    const raw: Record<string, unknown> = {
      id: 99,
      name: "Minimal Project",
      description: "",
      scm_type: "",
      scm_url: "",
      scm_branch: "",
      status: "never updated",
      last_updated: null,
      created: "2025-01-01T00:00:00Z",
      modified: "2025-01-01T00:00:00Z",
    };

    const result = mapProject(raw);

    expect(result.data.organization_name).toBe("");
    expect(result.data.created_by).toBe("");
    expect(result.data.warnings).toEqual([]);
    expect(result.data.errors).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 8: Empty description field
     ══════════════════════════════════════════════════════════════ */

  it("handles empty description field gracefully", () => {
    const raw = {
      ...loadRawProjectFixture(),
      description: "",
    };

    const result = mapProject(raw);

    expect(result.data.description).toBe("");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 9: Missing scm fields (manual project without SCM)
     ══════════════════════════════════════════════════════════════ */

  it("handles missing scm fields with empty strings", () => {
    const raw: Record<string, unknown> = {
      id: 10,
      name: "Manual Project",
      description: "A manual project without SCM",
      scm_type: "",
      scm_url: "",
      scm_branch: "",
      status: "ok",
      last_updated: "2025-06-01T12:00:00Z",
      created: "2025-01-01T00:00:00Z",
      modified: "2025-06-01T12:00:00Z",
      summary_fields: {
        organization: { id: 1, name: "Default" },
        created_by: { id: 1, username: "admin" },
      },
    };

    const result = mapProject(raw);

    expect(result.data.scm_type).toBe("");
    expect(result.data.scm_url).toBe("");
    expect(result.data.scm_branch).toBe("");
    expect(result.data.is_successful).toBe(false);
    expect(result.data.is_failed).toBe(false);
  });
});
