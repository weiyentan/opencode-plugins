/**
 * get-resource.ts — AWX Resource Detail Orchestrator
 *
 * Generalized individual resource detail getter. Maps { type, id } to
 * an AWX API endpoint, fetches the resource, and delegates to a
 * per-type mapper to produce the structured output envelope.
 *
 * ## Design
 *
 * - **Registry**: `RESOURCE_REGISTRY` maps type strings to AWX API
 *   endpoints and mapper functions.
 * - **Dispatch**: `getResource()` looks up the registry, fetches from
 *   AWX, maps the response, and returns a typed output.
 * - **Error handling**: Unknown types throw with a clear message.
 *   Non-2xx API responses throw with status and body details.
 *   Abort errors propagate through.
 *
 * ## Adding a new resource type
 *
 * 1. Define a contract in `contracts/<resource>-detail.ts`
 * 2. Write a mapper in `mappers/map-<resource>.ts`
 * 3. Register it in `RESOURCE_REGISTRY` below
 * 4. Optionally add the type to the Zod schema in `index.ts`
 */
import type { AwxClient } from "./client.js";
import { mapTemplate } from "./mappers/map-template.js";
import { mapProject } from "./mappers/map-project.js";
import { mapInventory } from "./mappers/map-inventory.js";
import { mapUser } from "./mappers/map-user.js";
import { mapTeam } from "./mappers/map-team.js";
import { mapSchedule } from "./mappers/map-schedule.js";
import { mapNotificationTemplate } from "./mappers/map-notification-template.js";
import type { TemplateDetailOutput } from "./contracts/template-detail.js";
import type { ProjectDetailOutput } from "./contracts/project-detail.js";
import type { InventoryDetailOutput } from "./contracts/inventory-detail.js";
import type { UserDetailOutput } from "./contracts/user-detail.js";
import type { TeamDetailOutput } from "./contracts/team-detail.js";
import type { ScheduleDetailOutput } from "./contracts/schedule-detail.js";
import type { NotificationTemplateDetailOutput } from "./contracts/notification-template-detail.js";

/**
 * Union of all supported resource detail output types.
 * Extend this when adding new resource types.
 */
export type ResourceDetailOutput =
  | TemplateDetailOutput
  | ProjectDetailOutput
  | InventoryDetailOutput
  | UserDetailOutput
  | TeamDetailOutput
  | ScheduleDetailOutput
  | NotificationTemplateDetailOutput;

/**
 * Supported resource type keys (used by the tool args Zod schema).
 */
export type ResourceType =
  | "template"
  | "project"
  | "inventory"
  | "user"
  | "team"
  | "schedule"
  | "notification_template";

/**
 * Entry in the resource registry.
 */
interface ResourceEntry<T = unknown> {
  /** AWX API path with `{id}` placeholder */
  path: string;
  /** Pure mapper function: raw JSON → typed output */
  mapper: (raw: unknown) => T;
}

/**
 * Type→endpoint+mapper registry.
 *
 * Each entry maps a resource type string to:
 * - `path`: AWX API endpoint with `{id}` placeholder
 * - `mapper`: pure function that transforms the raw API response
 */
const RESOURCE_REGISTRY: Record<ResourceType, ResourceEntry> = {
  template: {
    path: "/api/v2/job_templates/{id}/",
    mapper: mapTemplate,
  },
  project: {
    path: "/api/v2/projects/{id}/",
    mapper: mapProject,
  },
  inventory: {
    path: "/api/v2/inventories/{id}/",
    mapper: mapInventory,
  },
  user: {
    path: "/api/v2/users/{id}/",
    mapper: mapUser,
  },
  team: {
    path: "/api/v2/teams/{id}/",
    mapper: mapTeam,
  },
  schedule: {
    path: "/api/v2/schedules/{id}/",
    mapper: mapSchedule,
  },
  notification_template: {
    path: "/api/v2/notification_templates/{id}/",
    mapper: mapNotificationTemplate,
  },
};

/**
 * Fetch and map a single AWX resource by type and ID.
 *
 * @param client       The AWX HTTP client
 * @param type         Resource type (e.g., "template")
 * @param id           Numeric resource ID
 * @param abortSignal  Optional AbortSignal for cancellation
 * @returns            Mapped resource output (e.g., TemplateDetailOutput)
 * @throws             If type is unsupported or the API returns an error
 */
export async function getResource(
  client: AwxClient,
  type: ResourceType,
  id: number,
  abortSignal?: AbortSignal,
): Promise<ResourceDetailOutput> {
  const entry = RESOURCE_REGISTRY[type];

  if (!entry) {
    throw new Error(
      `Unsupported resource type: "${type}". Supported types: ${
        Object.keys(RESOURCE_REGISTRY).join(", ")
      }`,
    );
  }

  const path = entry.path.replace("{id}", String(id));

  const response = await client.request(
    "awx-get-resource",
    path,
    undefined,
    abortSignal,
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `AWX API error (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  const raw = (await response.json()) as unknown;
  return entry.mapper(raw) as ResourceDetailOutput;
}
