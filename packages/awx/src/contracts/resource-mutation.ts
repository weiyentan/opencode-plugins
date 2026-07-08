/**
 * AWX Resource Mutation Output Contract — v1.0
 *
 * Generic output envelope for all resource mutation tools
 * (create, update, delete). Provides a consistent shape for
 * template, project, and inventory mutations.
 *
 * ## Fields
 *
 * - **schema_version**: Always "1.0"
 * - **action**: The mutation action performed (created, updated, deleted)
 * - **resource_type**: The type of resource mutated (template, project, inventory)
 * - **id**: The numeric ID of the mutated resource
 * - **data**: Full resource detail for create/update (via mapTemplate/mapProject/mapInventory);
 *   null for delete operations
 * - **warnings**: Non-fatal warnings from the operation (optional)
 * - **errors**: Fatal errors from the operation (optional)
 */
import { z } from "zod";

// ─── Zod schemas for runtime validation ────────────────────────

/** Supported mutation action values */
export const ResourceMutationActionSchema = z.enum(["created", "updated", "deleted"]);

/** Supported resource types for mutation */
export const ResourceMutationResourceTypeSchema = z.enum(["template", "project", "inventory", "workflow_template"]);

/** Full mutation output envelope schema */
export const ResourceMutationOutputSchema = z.object({
  /** Contract version — always "1.0" */
  schema_version: z.literal("1.0"),
  /** The mutation action performed */
  action: ResourceMutationActionSchema,
  /** The type of resource mutated */
  resource_type: ResourceMutationResourceTypeSchema,
  /** The numeric ID of the mutated resource */
  id: z.number(),
  /**
   * Full resource detail for create/update operations
   * (mapped via the per-type mapper).
   * Set to null for delete operations.
   */
  data: z.any().nullable(),
  /** Non-fatal warnings from the operation */
  warnings: z.array(z.string()).optional(),
  /** Fatal errors from the operation */
  errors: z.array(z.string()).optional(),
});

// ─── Inferred TypeScript types ──────────────────────────────────

/** Runtime-inferred mutation action type */
export type ResourceMutationAction = z.output<typeof ResourceMutationActionSchema>;

/** Runtime-inferred resource type for mutations */
export type ResourceMutationResourceType = z.output<typeof ResourceMutationResourceTypeSchema>;

/** Runtime-inferred full mutation output type */
export type ResourceMutationOutput = z.output<typeof ResourceMutationOutputSchema>;
