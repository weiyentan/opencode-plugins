/**
 * AWX Notification Template Detail Output Contract — v1.0
 *
 * TypeScript interface defining the structured output for notification
 * template detail requests. Used by `mapNotificationTemplate()` to shape
 * raw AWX API responses into the canonical format.
 *
 * ## Schema Fields
 *
 * - **schema_version**: Always "1.0"
 * - **resource_type**: Always "notification_template"
 * - **id**: The numeric resource ID
 * - **data**: Core notification template data with resolved organization name
 *
 * ## Field Notes
 *
 * - `notification_type` is one of: "email", "slack", "webhook", "pagerduty",
 *   "grafana", "irc", "twilio", "mattermost", "rocketchat".
 * - `notification_configuration` shape depends on the `notification_type`.
 *   Stored as a generic `Record<string, unknown>` — AWX validates server-side.
 * - `organization_name` is resolved from `summary_fields.organization.name`.
 */

// ─── Notification Template Data ──────────────────────────────

export interface NotificationTemplateData {
  id: number;
  name: string;
  description: string;
  /** e.g., "email", "slack", "webhook", "pagerduty" */
  notification_type: string;
  /** Type-dependent configuration object */
  notification_configuration: Record<string, unknown>;
  /** Resolved from summary_fields.organization.name */
  organization_name: string;
  /** ISO 8601 timestamp */
  created: string;
  /** ISO 8601 timestamp */
  modified: string;
}

// ─── Top-level output envelope ───────────────────────────────

export interface NotificationTemplateDetailOutput {
  schema_version: "1.0";
  resource_type: "notification_template";
  id: number;
  data: NotificationTemplateData;
}
