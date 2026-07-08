/**
 * crud.ts — AWX CRUD Endpoint Registry & Dispatch
 *
 * Shared internal module that maps { resource, action } pairs to
 * AWX API endpoints and HTTP methods. Dispatches to the correct
 * endpoint for each resource type (template, project, inventory)
 * and HTTP method (POST, PATCH, DELETE).
 *
 * ## Design
 *
 * - **Registry**: `CRUD_REGISTRY` maps resource type strings to
 *   endpoint entries for each CRUD action (create, update, delete).
 * - **Dispatch**: `executeCrud()` looks up the registry, performs
 *   the HTTP request, and maps the response using the existing
 *   per-type mapper functions (mapTemplate, mapProject, mapInventory).
 * - **Error handling**: Unknown types/actions throw with a clear
 *   message. Non-2xx API responses throw with status and body details.
 *   Abort errors propagate through.
 *
 * ## Adding a new CRUD resource
 *
 * 1. Define a contract in `contracts/<resource>-detail.ts`
 * 2. Write a mapper in `mappers/map-<resource>.ts`
 * 3. Register it in `CRUD_REGISTRY` below
 * 4. Optionally add the type to `CrudResourceType`
 *
 * ## Usage
 *
 * ```ts
 * const result = await executeCrud(client, "template", "create", undefined, body);
 * // → { action: "created", resource_type: "template", id: 8, data: {...} }
 *
 * const result = await executeCrud(client, "project", "update", 5, body);
 * // → { action: "updated", resource_type: "project", id: 5, data: {...} }
 *
 * const result = await executeCrud(client, "inventory", "delete", 12);
 * // → { action: "deleted", resource_type: "inventory", id: 12, data: null }
 * ```
 */
import type { AwxClient } from "./client.js";
import { mapTemplate } from "./mappers/map-template.js";
import { mapProject } from "./mappers/map-project.js";
import { mapInventory } from "./mappers/map-inventory.js";
import { mapWorkflowTemplate } from "./mappers/map-workflow-template.js";

// ─── Types ─────────────────────────────────────────────────────

/**
 * Supported resource type keys for CRUD operations.
 * Extend this when adding new resource types.
 */
export type CrudResourceType = "template" | "project" | "inventory" | "workflow_template";

/**
 * Supported CRUD action keys.
 */
export type CrudAction = "create" | "update" | "delete";

/**
 * A single endpoint entry in the CRUD registry.
 */
export interface CrudEndpoint {
  /** AWX API path. May contain `{id}` placeholder for update/delete */
  path: string;
  /** HTTP method */
  method: "POST" | "PATCH" | "DELETE";
  /** Whether the path requires `{id}` to be substituted */
  requiresId: boolean;
}

/**
 * Entry in the CRUD resource registry.
 */
export interface CrudEntry<T = unknown> {
  /** Endpoints for each CRUD action */
  endpoint: Record<CrudAction, CrudEndpoint>;
  /** Mapper function: raw JSON → typed output */
  mapper: (raw: unknown) => T;
}

// ─── Registry ──────────────────────────────────────────────────

/**
 * Resource→action→endpoint+mapper registry.
 *
 * Each entry maps a resource type string to a set of three endpoints
 * (create, update, delete) and the per-type mapper function.
 * Mapper functions are reused from `get-resource.ts`'s registry.
 */
export const CRUD_REGISTRY: Record<CrudResourceType, CrudEntry> = {
  template: {
    endpoint: {
      create: { path: "/api/v2/job_templates/", method: "POST", requiresId: false },
      update: { path: "/api/v2/job_templates/{id}/", method: "PATCH", requiresId: true },
      delete: { path: "/api/v2/job_templates/{id}/", method: "DELETE", requiresId: true },
    },
    mapper: mapTemplate,
  },
  project: {
    endpoint: {
      create: { path: "/api/v2/projects/", method: "POST", requiresId: false },
      update: { path: "/api/v2/projects/{id}/", method: "PATCH", requiresId: true },
      delete: { path: "/api/v2/projects/{id}/", method: "DELETE", requiresId: true },
    },
    mapper: mapProject,
  },
  inventory: {
    endpoint: {
      create: { path: "/api/v2/inventories/", method: "POST", requiresId: false },
      update: { path: "/api/v2/inventories/{id}/", method: "PATCH", requiresId: true },
      delete: { path: "/api/v2/inventories/{id}/", method: "DELETE", requiresId: true },
    },
    mapper: mapInventory,
  },
  workflow_template: {
    endpoint: {
      create: { path: "/api/v2/workflow_job_templates/", method: "POST", requiresId: false },
      update: { path: "/api/v2/workflow_job_templates/{id}/", method: "PATCH", requiresId: true },
      delete: { path: "/api/v2/workflow_job_templates/{id}/", method: "DELETE", requiresId: true },
    },
    mapper: mapWorkflowTemplate,
  },
};

// ─── Dispatch ──────────────────────────────────────────────────

/**
 * Output from a CRUD operation before wrapping in the full contract envelope.
 */
export interface CrudResult {
  /** Past-tense action label ("created", "updated", "deleted") */
  action: "created" | "updated" | "deleted";
  /** Resource type that was mutated */
  resource_type: CrudResourceType;
  /** Numeric ID of the mutated resource */
  id: number;
  /**
   * Mapped resource detail for create/update operations
   * (e.g., TemplateDetailOutput, ProjectDetailOutput, InventoryDetailOutput).
   * Set to null for delete operations.
   */
  data: unknown | null;
}

/**
 * Execute a CRUD operation on an AWX resource.
 *
 * Looks up the correct endpoint from the registry, makes the HTTP
 * request via the client, and maps the response using the per-type
 * mapper. Returns a structured result envelope.
 *
 * @param client       The AWX HTTP client
 * @param resource     Resource type ("template", "project", "inventory")
 * @param action       CRUD action ("create", "update", "delete")
 * @param id           Resource ID (required for update/delete)
 * @param body         Request body (typically JSON-serializable payload)
 * @param abortSignal  Optional AbortSignal for cancellation
 * @returns            Structured result: { action, resource_type, id, data }
 * @throws             If type/action is unsupported, a required ID is missing,
 *                     or the API returns an error
 */
export async function executeCrud(
  client: AwxClient,
  resource: CrudResourceType,
  action: CrudAction,
  id?: number,
  body?: Record<string, unknown>,
  abortSignal?: AbortSignal,
): Promise<CrudResult> {
  const entry = CRUD_REGISTRY[resource];

  if (!entry) {
    const supported = Object.keys(CRUD_REGISTRY).join(", ");
    throw new Error(
      `Unsupported resource type: "${resource}". Supported types: ${supported}`,
    );
  }

  const endpoint = entry.endpoint[action];

  if (!endpoint) {
    throw new Error(
      `Unsupported action: "${action}" for resource "${resource}". Supported actions: create, update, delete`,
    );
  }

  // Resolve the path — substitute {id} if required
  let path = endpoint.path;
  if (endpoint.requiresId) {
    if (id === undefined) {
      throw new Error(
        `A resource ID is required for "${action}" on "${resource}"`,
      );
    }
    path = path.replace("{id}", String(id));
  }

  // Build request init
  const init: RequestInit = {
    method: endpoint.method,
    headers: { "Content-Type": "application/json" },
  };

  // Include body for create/update (delete does not send a body)
  if (body && action !== "delete") {
    init.body = JSON.stringify(body);
  }

  // Dispatch the HTTP request
  const response = await client.request(
    `awx-crud-${resource}-${action}`,
    path,
    init,
    abortSignal,
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `AWX API error (${response.status}): ${errorBody || response.statusText}`,
    );
  }

  // Handle delete — no response body to map
  if (action === "delete") {
    if (id === undefined) {
      throw new Error("A resource ID is required for delete");
    }
    return {
      action: "deleted",
      resource_type: resource,
      id,
      data: null,
    };
  }

  // Parse response body for create/update
  const raw = (await response.json()) as Record<string, unknown>;
  const data = entry.mapper(raw);
  const resultId = raw.id as number;

  return {
    action: action === "create" ? "created" : "updated",
    resource_type: resource,
    id: resultId,
    data,
  };
}
