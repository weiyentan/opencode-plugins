/**
 * map-notification-template.ts — AWX Notification Template Detail Mapper
 *
 * Pure function that transforms a raw AWX API notification template
 * response (from GET /api/v2/notification_templates/<id>/) into the
 * structured NotificationTemplateDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Organization name**: Extracts from
 *   `summary_fields.organization.name`.
 * - **notification_configuration**: Passed through as-is; the shape
 *   depends on `notification_type` (email, slack, webhook, etc.).
 *   AWX validates this server-side.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/notification_templates/5/");
 * const raw = await response.json();
 * const output = mapNotificationTemplate(raw);
 * ```
 */
import type { NotificationTemplateDetailOutput, NotificationTemplateData } from "../contracts/notification-template-detail.js";

/**
 * Raw AWX API notification template response shape (the subset we care about).
 */
interface RawAwxNotificationTemplate {
  id: number;
  name: string;
  description: string;
  notification_type: string;
  notification_configuration: Record<string, unknown>;
  created: string;
  modified: string;
  summary_fields?: {
    organization?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API notification template response into the
 * NotificationTemplateDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/notification_templates/<id>/
 * @returns    A NotificationTemplateDetailOutput matching the v1.0 contract
 */
export function mapNotificationTemplate(raw: unknown): NotificationTemplateDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapNotificationTemplate: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const nt = raw as RawAwxNotificationTemplate;
  const sf = nt.summary_fields ?? {};

  const data: NotificationTemplateData = {
    id: nt.id ?? 0,
    name: nt.name ?? "",
    description: nt.description ?? "",
    notification_type: nt.notification_type ?? "",
    notification_configuration: nt.notification_configuration ?? {},
    organization_name: sf.organization?.name ?? "",
    created: nt.created ?? "",
    modified: nt.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "notification_template",
    id: nt.id ?? 0,
    data,
  };
}
