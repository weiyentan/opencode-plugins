/**
 * tools/crud.ts — CRUD tool factory for AWX resources
 *
 * Extracted from index.ts. Provides createCrudTools() factory that
 * returns all 9 CRUD tool registrations (create/update/delete for
 * project, template, inventory).
 *
 * Each tool:
 * 1. Resolves the AWX client via getAwxClient()
 * 2. Delegates to executeCrud() for HTTP dispatch
 * 3. Wraps the result via wrapMutationResult() into ResourceMutationOutput
 * 4. Returns formatted output and metadata
 */

import { tool } from "@opencode-ai/plugin";
const z = tool.schema;
import type { AwxClient } from "../client.js";
import { executeCrud } from "../crud.js";
import { wrapMutationResult } from "../utils.js";

/**
 * Factory that creates all 9 CRUD tool registrations.
 *
 * @param getAwxClient - Resolver that returns a cached AwxClient instance
 * @returns Object mapping tool names to tool registration objects
 */
export function createCrudTools(
  getAwxClient: () => Promise<AwxClient>,
): Record<string, ReturnType<typeof tool>> {
  return {
    /**
     * Create a new AWX project.
     *
     * Creates a project in AWX with the specified name and organization.
     * The organization_id must be a resolved numeric ID (not a name).
     * Optionally configure SCM type, URL, and description.
     * Delegates to crud.ts for the HTTP dispatch and mapProject for the response.
     * Returns the created project detail in the standard mutation envelope.
     */
    "awx-create-project": tool({
      description: [
        "Create a new AWX project with the specified name and organization.",
        "The organization_id must be a resolved numeric ID (not a name).",
        "Optionally configure SCM type with optional SCM source (git, svn, archive, insights, or manual), SCM URL, and description.",
        "Returns the created project detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string().min(1)
          .describe("Project name"),
        organization_id: z
          .number()
          .int()
          .positive()
          .describe("Resolved organization ID"),
        scm_type: z
          .enum(["", "git", "svn", "archive", "insights"])
          .optional()
          .describe("SCM type (git, svn, archive, insights, or empty for manual)"),
        scm_url: z
          .string()
          .optional()
          .describe("SCM URL (required if scm_type=git)"),
        description: z
          .string()
          .optional()
          .describe("Project description"),
      },
      async execute(args, context) {
        // Respect the abort signal
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient: AwxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: message };
        }

        try {
          const body: Record<string, unknown> = {
            name: args.name,
            organization: args.organization_id,
          };
          if (args.scm_type !== undefined) body.scm_type = args.scm_type;
          if (args.scm_url !== undefined) body.scm_url = args.scm_url;
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "project",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          const projectName = mutationOutput.data
            ? (mutationOutput.data as Record<string, unknown>).name as string ?? ""
            : "";
          return {
            output: `Project ${result.id} created successfully. Name: ${projectName}`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create project: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "project",
              id: 0,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    /**
     * Create a new AWX job template.
     *
     * Accepts template fields including name, job_type, project_id,
     * inventory_id, and playbook. The agent provides resolved IDs
     * (no internal name-to-ID resolution). Delegates to the shared
     * CRUD registry which maps to POST /api/v2/job_templates/.
     * Returns the created template detail wrapped in the standard
     * ResourceMutationOutput envelope.
     */
    "awx-create-template": tool({
      description: [
        "Create a new AWX job template. Accepts template fields",
        "including name, job_type, project_id, inventory_id,",
        "and playbook. Provide resolved IDs (not names).",
        "Returns the created template detail in the standard",
        "ResourceMutationOutput envelope.",
      ].join(" "),
      args: {
        name: z.string().min(1).describe("Template name"),
        job_type: z.enum(["run", "check", "scan"]).describe("Template job type"),
        project_id: z.number().int().positive().describe("Resolved AWX project ID"),
        inventory_id: z.number().int().positive().describe("Resolved AWX inventory ID"),
        playbook: z.string().min(1).describe("Playbook filename (e.g., site.yml)"),
        description: z.string().optional().describe("Optional template description"),
      },
      async execute(args, context) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient: AwxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: message };
        }

        try {
          const body: Record<string, unknown> = {
            name: args.name,
            job_type: args.job_type,
            project: args.project_id,
            inventory: args.inventory_id,
            playbook: args.playbook,
          };
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const crudResult = await executeCrud(
            awxClient,
            "template",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(crudResult);
          return {
            output: `Template ${crudResult.id} created.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `awx-create-template error: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "template",
              id: 0,
              data: null,
              warnings: [],
              errors: [message],
            },
          };
        }
      },
    }),

    /**
     * Create a new AWX inventory.
     *
     * Creates an inventory resource in AWX via POST /api/v2/inventories/.
     * Requires name and organization_id. The organization_id must be a
     * pre-resolved AWX organization ID (no internal name-to-ID resolution).
     * Optional description field is supported.
     *
     * Returns a ResourceMutationOutput envelope containing the created
     * inventory detail (mapped via mapInventory).
     */
    "awx-create-inventory": tool({
      description: [
        "Create a new AWX inventory.",
        "Requires name and organization_id (resolved organization ID).",
        "Optional description is supported.",
        "Returns created inventory detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string()
          .min(1)
          .describe("The name of the new inventory."),
        organization_id: z
          .number()
          .int()
          .positive()
          .describe("The resolved AWX organization ID to assign this inventory to."),
        description: z
          .string()
          .optional()
          .describe("Optional description for the inventory."),
      },
      async execute(args, context) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: message,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "inventory",
              id: 0,
              data: null,
              warnings: [],
              errors: [message],
            },
          };
        }

        try {
          const body: Record<string, unknown> = {
            name: args.name,
            organization: args.organization_id,
          };
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const result = await executeCrud(
            awxClient,
            "inventory",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Inventory "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create inventory: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "inventory",
              id: 0,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    /**
     * Update an existing AWX project.
     *
     * Modifies an existing project by PATCHing the specified fields.
     * Only provided fields are updated (partial update semantics).
     * The organization_id must be a resolved numeric ID (not a name).
     * Delegates to crud.ts for the HTTP dispatch and mapProject for the response.
     * Returns the updated project detail in the standard mutation envelope.
     */
    "awx-update-project": tool({
      description: [
        "Update an existing AWX project by ID. Partial update — only",
        "provided fields are modified. Supports updating name,",
        "organization_id, scm_type (git, svn, archive, insights, or manual), scm_url, and description.",
        "Returns the updated project detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the AWX project to update."),
        name: z
          .string()
          .optional()
          .describe("New project name"),
        organization_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Resolved organization ID"),
        scm_type: z
          .enum(["", "git", "svn", "archive", "insights"])
          .optional()
          .describe("SCM type (git, svn, archive, insights, or empty for manual)"),
        scm_url: z
          .string()
          .optional()
          .describe("SCM URL"),
        description: z
          .string()
          .optional()
          .describe("Project description"),
      },
      async execute(args, context) {
        // Respect the abort signal
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient: AwxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: message };
        }

        try {
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.organization_id !== undefined) body.organization = args.organization_id;
          if (args.scm_type !== undefined) body.scm_type = args.scm_type;
          if (args.scm_url !== undefined) body.scm_url = args.scm_url;
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "project",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Project ${result.id} updated successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update project ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "project",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    /**
     * Update an existing AWX job template.
     *
     * Accepts partial template fields (only the fields to change).
     * The id parameter is required to identify the template.
     * Delegates to the shared CRUD registry which maps to
     * PATCH /api/v2/job_templates/{id}/.
     * Returns the updated template detail in the standard
     * ResourceMutationOutput envelope.
     */
    "awx-update-template": tool({
      description: [
        "Update an existing AWX job template. Accepts partial",
        "template fields. The id parameter identifies the template.",
        "Provide resolved IDs (project_id, inventory_id) for any",
        "lookup fields being changed. Returns the updated template",
        "detail in the standard ResourceMutationOutput envelope.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the template to update"),
        name: z.string().min(1).optional().describe("Template name"),
        job_type: z.enum(["run", "check", "scan"]).optional().describe("Template job type"),
        project_id: z.number().int().positive().optional().describe("Resolved AWX project ID"),
        inventory_id: z.number().int().positive().optional().describe("Resolved AWX inventory ID"),
        playbook: z.string().min(1).optional().describe("Playbook filename (e.g., site.yml)"),
        description: z.string().optional().describe("Optional template description"),
      },
      async execute(args, context) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient: AwxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: message };
        }

        try {
          // Build body from only the fields that were provided (excluding id)
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.job_type !== undefined) body.job_type = args.job_type;
          if (args.project_id !== undefined) body.project = args.project_id;
          if (args.inventory_id !== undefined) body.inventory = args.inventory_id;
          if (args.playbook !== undefined) body.playbook = args.playbook;
          if (args.description !== undefined) body.description = args.description;

          const crudResult = await executeCrud(
            awxClient,
            "template",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(crudResult);
          return {
            output: `Template ${crudResult.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `awx-update-template error: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "template",
              id: args.id ?? 0,
              data: null,
              warnings: [],
              errors: [message],
            },
          };
        }
      },
    }),

    /**
     * Update an existing AWX inventory.
     *
     * Modifies an inventory resource in AWX via PATCH /api/v2/inventories/<id>/.
     * Requires the inventory ID; name, description, and organization_id
     * are optional partial-update fields.
     *
     * Returns a ResourceMutationOutput envelope containing the updated
     * inventory detail (mapped via mapInventory).
     */
    "awx-update-inventory": tool({
      description: [
        "Update an existing AWX inventory by ID.",
        "Accepts partial fields (name, description, organization_id).",
        "Returns updated inventory detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the inventory to update."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("New name for the inventory."),
        description: z
          .string()
          .optional()
          .describe("New description for the inventory."),
        organization_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New resolved organization ID for the inventory."),
      },
      async execute(args, context) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: message,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "inventory",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            },
          };
        }

        try {
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) {
            body.name = args.name;
          }
          if (args.description !== undefined) {
            body.description = args.description;
          }
          if (args.organization_id !== undefined) {
            body.organization = args.organization_id;
          }

          const result = await executeCrud(
            awxClient,
            "inventory",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Inventory ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update inventory ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "inventory",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    /**
     * Delete an AWX project.
     *
     * Deletes a project by ID from AWX. This action is irreversible.
     * The project must exist and the user must have sufficient permissions.
     * Delegates to crud.ts for the HTTP dispatch.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-project": tool({
      description: [
        "Delete an AWX project by ID. This action is irreversible.",
        "The project must exist and the user must have sufficient",
        "permissions to delete it. Returns the standard mutation",
        "envelope with data: null on success.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the AWX project to delete."),
      },
      async execute(args, context) {
        // Respect the abort signal
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient: AwxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: message };
        }

        try {
          const result = await executeCrud(
            awxClient,
            "project",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Project ${result.id} deleted successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete project ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "project",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    /**
     * Delete an AWX job template.
     *
     * Accepts a template id and removes it from AWX.
     * Delegates to the shared CRUD registry which maps to
     * DELETE /api/v2/job_templates/{id}/.
     * Returns the standard ResourceMutationOutput envelope with
     * action "deleted" and data set to null.
     */
    "awx-delete-template": tool({
      description: [
        "Delete an AWX job template by ID. Delegates to the",
        "shared CRUD registry which maps to",
        "DELETE /api/v2/job_templates/{id}/.",
        "Returns the standard ResourceMutationOutput envelope",
        "with action 'deleted' and data set to null.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the template to delete"),
      },
      async execute(args, context) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient: AwxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { output: message };
        }

        try {
          const crudResult = await executeCrud(
            awxClient,
            "template",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(crudResult);
          return {
            output: `Template ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `awx-delete-template error: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "template",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            },
          };
        }
      },
    }),

    /**
     * Delete an AWX inventory.
     *
     * Removes an inventory resource from AWX via DELETE /api/v2/inventories/<id>/.
     * Requires the inventory ID. Returns a ResourceMutationOutput envelope
     * with data set to null.
     */
    "awx-delete-inventory": tool({
      description: [
        "Delete an AWX inventory by ID.",
        "Removes the inventory from AWX via DELETE /api/v2/inventories/<id>/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the inventory to delete."),
      },
      async execute(args, context) {
        if (context.abort?.aborted) {
          return { output: "Request was aborted." };
        }

        let awxClient;
        try {
          awxClient = await getAwxClient();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: message,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "inventory",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            },
          };
        }

        try {
          const result = await executeCrud(
            awxClient,
            "inventory",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Inventory ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete inventory ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "inventory",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),
  };
}
