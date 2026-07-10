/**
 * MapNotificationTemplate Unit Tests
 *
 * Tests for the mapNotificationTemplate() pure function: validates that
 * raw AWX API notification template responses are correctly transformed
 * into the NotificationTemplateDetailOutput contract format.
 *
 * Follows TDD: one behavior at a time, minimal implementation per test.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapNotificationTemplate } from "../src/mappers/map-notification-template.js";
import type { NotificationTemplateDetailOutput } from "../src/contracts/notification-template-detail.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the raw AWX notification template API fixture */
function loadRawNotificationTemplateFixture(): Record<string, unknown> {
  const path = resolve(__dirname, "fixtures", "raw_awx_notification_template.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("mapNotificationTemplate()", () => {
  /* ══════════════════════════════════════════════════════════════
     Cycle 1: Basic field mapping from raw API response
     ══════════════════════════════════════════════════════════════ */

  it("maps core scalar fields from raw AWX API response", () => {
    const raw = loadRawNotificationTemplateFixture();
    const result = mapNotificationTemplate(raw);

    expect(result.data.id).toBe(5);
    expect(result.data.name).toBe("Slack Alerts");
    expect(result.data.description).toBe("Send alerts to #ops channel");
    expect(result.data.notification_type).toBe("slack");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 2: notification_configuration is passed through as-is
     ══════════════════════════════════════════════════════════════ */

  it("passes notification_configuration through as-is", () => {
    const raw = loadRawNotificationTemplateFixture();
    const result = mapNotificationTemplate(raw);

    expect(result.data.notification_configuration).toBeDefined();
    expect(typeof result.data.notification_configuration).toBe("object");
    expect(result.data.notification_configuration.channels).toEqual(["#ops", "#alerts"]);
    expect(result.data.notification_configuration.color).toBe("danger");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 3: Resolved organization name from summary_fields
     ══════════════════════════════════════════════════════════════ */

  it("resolves organization name from summary_fields", () => {
    const raw = loadRawNotificationTemplateFixture();
    const result = mapNotificationTemplate(raw);

    expect(result.data.organization_name).toBe("Default");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 4: Timestamps
     ══════════════════════════════════════════════════════════════ */

  it("maps created and modified timestamps", () => {
    const raw = loadRawNotificationTemplateFixture();
    const result = mapNotificationTemplate(raw);

    expect(result.data.created).toBe("2025-03-10T11:00:00Z");
    expect(result.data.modified).toBe("2025-07-01T16:20:00Z");
  });

  /* ══════════════════════════════════════════════════════════════
     Cycle 5: Output envelope structure
     ══════════════════════════════════════════════════════════════ */

  it("wraps output in the standard resource envelope", () => {
    const raw = loadRawNotificationTemplateFixture();
    const result = mapNotificationTemplate(raw);

    expect(result.schema_version).toBe("1.0");
    expect(result.resource_type).toBe("notification_template");
    expect(result.id).toBe(5);
    expect(result.data).toBeDefined();
    expect(typeof result.data).toBe("object");
  });
});
