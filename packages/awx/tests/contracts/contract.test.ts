/**
 * Contract Compatibility Tests
 *
 * Validates that the TypeScript JobDetailOutput interface matches the
 * canonical v1.0 contract format defined by awx_job_detail.py.
 *
 * The Python script scripts/generate-snapshots.py processes raw AWX API
 * responses (tests/fixtures/) into snapshot JSON files stored at
 * tests/contracts/__snapshots__/. These snapshots are the ground truth.
 *
 * This test suite:
 * 1. Loads each snapshot
 * 2. Validates it conforms to the JobDetailOutput type
 * 3. Verifies derived fields are computed correctly
 * 4. Ensures the snapshot structure matches field-by-field
 *
 * To regenerate snapshots after fixture changes:
 *   python3 scripts/generate-snapshots.py
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Import the contract type for validation
import type { JobDetailOutput } from "../../src/contracts/job-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const snapshotsDir = resolve(__dirname, "__snapshots__");

/** Load a snapshot JSON file */
function loadSnapshot(name: string): JobDetailOutput {
  const path = resolve(snapshotsDir, name);
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as JobDetailOutput;
}

describe("JobDetailOutput Contract", () => {
  describe("awx_job_success snapshot", () => {
    const data = loadSnapshot("awx_job_success.json");

    it("has schema_version 1.0", () => {
      expect(data.schema_version).toBe("1.0");
    });

    it("has complete job core metadata", () => {
      expect(data.job.id).toBe(42);
      expect(data.job.name).toBe("Deploy Web App - Production");
      expect(data.job.status).toBe("successful");
      expect(data.job.failed).toBe(false);
      expect(data.job.job_type).toBe("run");
      expect(data.job.playbook).toBe("deploy.yml");
      expect(data.job.created).toBeTruthy();
      expect(data.job.started).toBeTruthy();
      expect(data.job.finished).toBeTruthy();
      expect(data.job.elapsed).toBeGreaterThan(0);
      expect(data.job.execution_node).toBeTruthy();
      expect(data.job.controller_node).toBeTruthy();
      expect(data.job.scm_branch).toBe("main");
      expect(data.job.verbosity).toBe(1);
      expect(data.job.forks).toBe(5);
      expect(data.job.limit).toBe("");
    });

    it("has related field with resolved names (not URLs)", () => {
      expect(data.related.inventory_name).toBe("Production Inventory");
      expect(data.related.project_name).toBe("Web App Deploy");
      expect(data.related.job_template_name).toBe("Deploy Web App");
      expect(data.related.instance_group_name).toBe("default");
      expect(data.related.created_by).toBe("ansible-bot");
    });

    it("has credential_names as string array", () => {
      expect(Array.isArray(data.related.credential_names)).toBe(true);
      expect(data.related.credential_names).toHaveLength(2);
      expect(data.related.credential_names).toContain("Production SSH Key");
    });

    it("has label_names as string array", () => {
      expect(Array.isArray(data.related.label_names)).toBe(true);
      expect(data.related.label_names).toHaveLength(2);
      expect(data.related.label_names).toContain("production");
    });

    it("has host_status_counts (not host_summary)", () => {
      expect(data.host_status_counts).toBeDefined();
      expect(data.host_status_counts.ok).toBe(12);
      expect(data.host_status_counts.failed).toBe(0);
      expect(data.host_status_counts.skipped).toBe(3);
      expect(data.host_status_counts.changed).toBe(8);
      expect(data.host_status_counts.unreachable).toBe(0);
    });

    it("has derived boolean flags (not extra_vars_summary)", () => {
      expect(data.derived.is_successful).toBe(true);
      expect(data.derived.is_failed).toBe(false);
      expect(data.derived.has_unreachable_hosts).toBe(false);
    });

    it("has warnings and errors as arrays", () => {
      expect(Array.isArray(data.warnings)).toBe(true);
      expect(Array.isArray(data.errors)).toBe(true);
    });
  });

  describe("awx_job_partial snapshot", () => {
    const data = loadSnapshot("awx_job_partial.json");

    it("represents a running job (started but not finished)", () => {
      expect(data.job.status).toBe("running");
      expect(data.job.failed).toBe(false);
      expect(data.job.started).toBeTruthy();
      expect(data.job.finished).toBeNull();
      expect(data.job.elapsed).toBeNull();
    });

    it("derived flags are both false for running job", () => {
      expect(data.derived.is_successful).toBe(false);
      expect(data.derived.is_failed).toBe(false);
      expect(data.derived.has_unreachable_hosts).toBe(false);
    });

    it("handles null forks", () => {
      expect(data.job.forks).toBeNull();
    });
  });

  describe("awx_job_failure snapshot", () => {
    const data = loadSnapshot("awx_job_failure.json");

    it("represents a failed job", () => {
      expect(data.job.status).toBe("failed");
      expect(data.job.failed).toBe(true);
      expect(data.job.finished).toBeTruthy();
    });

    it("has correct derived flags for failure", () => {
      expect(data.derived.is_successful).toBe(false);
      expect(data.derived.is_failed).toBe(true);
      expect(data.derived.has_unreachable_hosts).toBe(true);
    });

    it("has unreachable hosts in host_status_counts", () => {
      expect(data.host_status_counts.unreachable).toBeGreaterThan(0);
      expect(data.host_status_counts.failed).toBe(2);
    });

    it("has a warning from job_explanation", () => {
      expect(data.warnings).toHaveLength(1);
      expect(data.warnings[0]).toContain("failed on host");
    });
  });

  describe("Structural contract checks", () => {
    const allSnapshots = [
      loadSnapshot("awx_job_success.json"),
      loadSnapshot("awx_job_partial.json"),
      loadSnapshot("awx_job_failure.json"),
    ];

    it("all snapshots have required top-level keys", () => {
      const required = [
        "schema_version",
        "job",
        "related",
        "host_status_counts",
        "derived",
        "warnings",
        "errors",
      ];
      for (const snapshot of allSnapshots) {
        for (const key of required) {
          expect(snapshot).toHaveProperty(key);
        }
      }
    });

    it("all snapshots have all job sub-fields", () => {
      const required = [
        "id", "name", "status", "failed", "job_type",
        "playbook", "created", "execution_node", "controller_node",
        "scm_branch", "verbosity", "limit",
      ];
      for (const snapshot of allSnapshots) {
        for (const key of required) {
          expect(snapshot.job).toHaveProperty(key);
        }
      }
    });

    it("all snapshots have all related sub-fields", () => {
      const required = [
        "inventory_name", "project_name", "job_template_name",
        "instance_group_name", "created_by", "credential_names", "label_names",
      ];
      for (const snapshot of allSnapshots) {
        for (const key of required) {
          expect(snapshot.related).toHaveProperty(key);
        }
      }
    });

    it("all snapshots have all host_status_counts sub-fields", () => {
      const required = ["ok", "failed", "skipped", "changed", "unreachable"];
      for (const snapshot of allSnapshots) {
        for (const key of required) {
          expect(snapshot.host_status_counts).toHaveProperty(key);
        }
      }
    });

    it("all snapshots have all derived sub-fields", () => {
      const required = ["is_successful", "is_failed", "has_unreachable_hosts"];
      for (const snapshot of allSnapshots) {
        for (const key of required) {
          expect(snapshot.derived).toHaveProperty(key);
        }
      }
    });

    it("schema_version is always '1.0'", () => {
      for (const snapshot of allSnapshots) {
        expect(snapshot.schema_version).toBe("1.0");
      }
    });

    it("no snapshot uses deprecated host_summary field", () => {
      for (const snapshot of allSnapshots) {
        expect((snapshot as Record<string, unknown>).host_summary).toBeUndefined();
      }
    });

    it("no snapshot uses deprecated extra_vars_summary field", () => {
      for (const snapshot of allSnapshots) {
        expect((snapshot as Record<string, unknown>).extra_vars_summary).toBeUndefined();
      }
    });

    it("warnings and errors are always arrays", () => {
      for (const snapshot of allSnapshots) {
        expect(Array.isArray(snapshot.warnings)).toBe(true);
        expect(Array.isArray(snapshot.errors)).toBe(true);
      }
    });
  });
});
