/**
 * MapCredential Unit Tests
 *
 * Tests for the mapCredential() pure function: validates that raw AWX API
 * credential responses are correctly transformed into the CredentialDetailOutput
 * contract format, including name resolution from summary_fields.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { mapCredential } from "../src/mappers/map-credential.js";
import type { CredentialDetailOutput } from "../src/contracts/credential-detail.js";

/** Raw AWX credential API response fixture */
const MOCK_RAW_CREDENTIAL: Record<string, unknown> = {
  id: 15,
  name: "Production SSH Key",
  description: "SSH key for production server access",
  credential_type: 1,
  kind: "ssh",
  managed: false,
  organization: 1,
  inputs: {
    username: "deploy",
    password: "$encrypted$",
    ssh_key_data: "$encrypted$",
  },
  summary_fields: {
    credential_type: {
      id: 1,
      name: "Machine",
      description: "Machine / SSH credential type",
    },
    organization: {
      id: 1,
      name: "Default",
      description: "Default organization",
    },
  },
};

describe("mapCredential()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const result = mapCredential(MOCK_RAW_CREDENTIAL);

    expect(result.data.id).toBe(15);
    expect(result.data.name).toBe("Production SSH Key");
    expect(result.data.description).toBe("SSH key for production server access");
    expect(result.data.credential_type_id).toBe(1);
    expect(result.data.kind).toBe("ssh");
    expect(result.data.managed).toBe(false);
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: Resolved names from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves credential_type_name and organization_name from summary_fields", () => {
    const result = mapCredential(MOCK_RAW_CREDENTIAL);

    expect(result.data.credential_type_name).toBe("Machine");
    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Does NOT expose sensitive credential input values
     ══════════════════════════════════════════════════════════════ */

  it("does NOT expose sensitive inputs field in the output", () => {
    const result = mapCredential(MOCK_RAW_CREDENTIAL);

    expect(result.data).not.toHaveProperty("inputs");
    // Ensure the raw inputs data is not accidentally passed through
    expect((result.data as Record<string, unknown>).inputs).toBeUndefined();
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const result = mapCredential(MOCK_RAW_CREDENTIAL);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("credential");
    expect(result.id).toBe(15);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Handles missing summary_fields gracefully
     ══════════════════════════════════════════════════════════════ */

  it("handles missing summary_fields with empty defaults", () => {
    const raw: Record<string, unknown> = {
      id: 99,
      name: "Minimal Credential",
      description: "",
      credential_type: 2,
      kind: "",
      managed: false,
    };

    const result = mapCredential(raw);

    expect(result.data.credential_type_name).toBe("");
    expect(result.data.organization_name).toBe("");
    expect(result.data.summary_fields).toEqual({});
  });
});
