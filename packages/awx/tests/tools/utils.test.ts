/**
 * Utils Unit Tests
 *
 * Tests for pure utility functions: formatErrorResponse and wrapMutationResult.
 *
 * These functions have no side effects and require no mocking — each test
 * simply calls the function with known inputs and verifies the output.
 */
import { describe, it, expect } from "vitest";
import { formatErrorResponse, wrapMutationResult } from "../../src/utils.js";

// ═══════════════════════════════════════════════════════════════════
// formatErrorResponse
// ═══════════════════════════════════════════════════════════════════

describe("formatErrorResponse", () => {
  it('returns "not found" message for 404', () => {
    const msg = formatErrorResponse(42, 404);
    expect(msg).toBe(
      "Project 42 not found. Verify the project ID and try again.",
    );
  });

  it('returns "not authorized" message for 401', () => {
    const msg = formatErrorResponse(7, 401);
    expect(msg).toBe(
      "Not authorized to sync project 7. Check your Personal Access Token permissions.",
    );
  });

  it('returns "not authorized" message for 403', () => {
    const msg = formatErrorResponse(7, 403);
    expect(msg).toBe(
      "Not authorized to sync project 7. Check your Personal Access Token permissions.",
    );
  });

  it("returns generic HTTP error for other status codes (500)", () => {
    const msg = formatErrorResponse(99, 500);
    expect(msg).toBe(
      "Failed to sync project 99. AWX API returned HTTP 500.",
    );
  });

  it("returns generic HTTP error for other status codes (502)", () => {
    const msg = formatErrorResponse(99, 502);
    expect(msg).toBe(
      "Failed to sync project 99. AWX API returned HTTP 502.",
    );
  });

  it("returns generic HTTP error for other status codes (418)", () => {
    const msg = formatErrorResponse(1, 418);
    expect(msg).toBe(
      "Failed to sync project 1. AWX API returned HTTP 418.",
    );
  });

  it("uses the provided projectId in the message", () => {
    const msg = formatErrorResponse(12345, 404);
    expect(msg).toContain("12345");
  });
});

// ═══════════════════════════════════════════════════════════════════
// wrapMutationResult
// ═══════════════════════════════════════════════════════════════════

describe("wrapMutationResult", () => {
  it("extracts inner data from nested object (data → data → innerData)", () => {
    const innerPayload = { name: "My Template", job_type: "run" };
    const result = wrapMutationResult({
      action: "created",
      resource_type: "template",
      id: 10,
      data: { data: innerPayload },
    });

    expect(result.data).toEqual(innerPayload);
  });

  it("uses raw result.data when there is no nested data property", () => {
    const rawData = { name: "Simple Project" };
    const result = wrapMutationResult({
      action: "updated",
      resource_type: "project",
      id: 5,
      data: rawData,
    });

    expect(result.data).toEqual(rawData);
  });

  it("returns correct schema_version (1.0)", () => {
    const result = wrapMutationResult({
      action: "deleted",
      resource_type: "inventory",
      id: 1,
      data: null,
    });

    expect(result.schema_version).toBe("1.0");
  });

  it("returns correct action, resource_type, and id", () => {
    const result = wrapMutationResult({
      action: "created",
      resource_type: "template",
      id: 42,
      data: { name: "test" },
    });

    expect(result.action).toBe("created");
    expect(result.resource_type).toBe("template");
    expect(result.id).toBe(42);
  });

  it("returns empty warnings and errors arrays", () => {
    const result = wrapMutationResult({
      action: "updated",
      resource_type: "project",
      id: 3,
      data: { name: "x" },
    });

    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("handles null data gracefully (returns null as innerData)", () => {
    const result = wrapMutationResult({
      action: "deleted",
      resource_type: "inventory",
      id: 7,
      data: null,
    });

    expect(result.data).toBeNull();
  });

  it("handles primitive data values (number) without unwrapping", () => {
    const result = wrapMutationResult({
      action: "created",
      resource_type: "template",
      id: 1,
      data: 42,
    });

    expect(result.data).toBe(42);
  });

  it("handles primitive data values (string) without unwrapping", () => {
    const result = wrapMutationResult({
      action: "created",
      resource_type: "template",
      id: 1,
      data: "plain-string",
    });

    expect(result.data).toBe("plain-string");
  });

  it("does NOT unwrap when data is an object without a data key", () => {
    const obj = { name: "test", type: "run" };
    const result = wrapMutationResult({
      action: "updated",
      resource_type: "project",
      id: 8,
      data: obj,
    });

    // The object has no `data` property, so it should be returned as-is
    expect(result.data).toBe(obj);
  });

  it("deeply nested data key extracts one level only", () => {
    const inner = { value: 1 };
    const result = wrapMutationResult({
      action: "created",
      resource_type: "template",
      id: 20,
      data: { data: { data: inner } },
    });

    // Only one level of unwrapping: { data: { data: inner } } → { data: inner }
    expect(result.data).toEqual({ data: inner });
  });
});
