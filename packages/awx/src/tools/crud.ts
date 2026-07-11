/**
 * crud.ts — CRUD tool factories.
 *
 * Combines all 9 CRUD tools (create/update/delete for project/template/inventory)
 * into a single factory function for shared client resolution and
 * mutation-result wrapping.
 */
import { tool } from "@opencode-ai/plugin";

const z = tool.schema;

import type { AwxClient } from "../client.js";
import { executeCrud } from "../crud.js";
import { wrapMutationResult } from "../utils.js";

export function createCrudTools(getAwxClient: () => Promise<AwxClient>) {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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
        extra_vars: z.record(z.string(), z.unknown()).optional().describe("Extra variables for the template (will be serialized to JSON string)"),
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
          if (args.extra_vars !== undefined) body.extra_vars = JSON.stringify(args.extra_vars);

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
          if (err instanceof DOMException && err.name === "AbortError") {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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
          if (err instanceof DOMException && err.name === "AbortError") {
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

    // ═════════════════════════════════════════════════════════════
    // Host CRUD Tools
    // ═════════════════════════════════════════════════════════════

    /**
     * Create a new AWX host.
     *
     * Creates a host in AWX via POST /api/v2/hosts/.
     * Requires name and inventory_id. The inventory_id must be a
     * pre-resolved AWX inventory ID.
     * Optional description field is supported.
     *
     * Returns a ResourceMutationOutput envelope containing the created
     * host detail (mapped via mapHost).
     */
    "awx-create-host": tool({
      description: [
        "Create a new AWX host.",
        "Requires name and inventory_id (resolved inventory ID).",
        "Optional description is supported.",
        "Returns created host detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string()
          .min(1)
          .describe("The name of the new host."),
        inventory_id: z
          .number()
          .int()
          .positive()
          .describe("The resolved AWX inventory ID to assign this host to."),
        description: z
          .string()
          .optional()
          .describe("Optional description for the host."),
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
              resource_type: "host",
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
            inventory: args.inventory_id,
          };
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const result = await executeCrud(
            awxClient,
            "host",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Host "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create host: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "host",
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
     * Update an existing AWX host.
     *
     * Modifies a host in AWX via PATCH /api/v2/hosts/<id>/.
     * Requires the host ID; name, description, and inventory_id
     * are optional partial-update fields.
     *
     * Returns a ResourceMutationOutput envelope containing the updated
     * host detail (mapped via mapHost).
     */
    "awx-update-host": tool({
      description: [
        "Update an existing AWX host by ID.",
        "Accepts partial fields (name, description, inventory_id).",
        "Returns updated host detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the host to update."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("New name for the host."),
        description: z
          .string()
          .optional()
          .describe("New description for the host."),
        inventory_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New resolved inventory ID for the host."),
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
              resource_type: "host",
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
          if (args.inventory_id !== undefined) {
            body.inventory = args.inventory_id;
          }

          const result = await executeCrud(
            awxClient,
            "host",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Host ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update host ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "host",
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
     * Delete an AWX host.
     *
     * Removes a host from AWX via DELETE /api/v2/hosts/<id>/.
     * Requires the host ID. Returns a ResourceMutationOutput envelope
     * with data set to null.
     */
    "awx-delete-host": tool({
      description: [
        "Delete an AWX host by ID.",
        "Removes the host from AWX via DELETE /api/v2/hosts/<id>/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the host to delete."),
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
              resource_type: "host",
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
            "host",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Host ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete host ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "host",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════════
    // Group CRUD Tools
    // ═════════════════════════════════════════════════════════════

    /**
     * Create a new AWX group.
     *
     * Creates a group in AWX via POST /api/v2/groups/.
     * Requires name and inventory_id. The inventory_id must be a
     * pre-resolved AWX inventory ID.
     * Optional description field is supported.
     *
     * Returns a ResourceMutationOutput envelope containing the created
     * group detail (mapped via mapGroup).
     */
    "awx-create-group": tool({
      description: [
        "Create a new AWX group.",
        "Requires name and inventory_id (resolved inventory ID).",
        "Optional description is supported.",
        "Returns created group detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string()
          .min(1)
          .describe("The name of the new group."),
        inventory_id: z
          .number()
          .int()
          .positive()
          .describe("The resolved AWX inventory ID to assign this group to."),
        description: z
          .string()
          .optional()
          .describe("Optional description for the group."),
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
              resource_type: "group",
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
            inventory: args.inventory_id,
          };
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const result = await executeCrud(
            awxClient,
            "group",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Group "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create group: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "group",
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
     * Update an existing AWX group.
     *
     * Modifies a group in AWX via PATCH /api/v2/groups/<id>/.
     * Requires the group ID; name, description, and inventory_id
     * are optional partial-update fields.
     *
     * Returns a ResourceMutationOutput envelope containing the updated
     * group detail (mapped via mapGroup).
     */
    "awx-update-group": tool({
      description: [
        "Update an existing AWX group by ID.",
        "Accepts partial fields (name, description, inventory_id).",
        "Returns updated group detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the group to update."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("New name for the group."),
        description: z
          .string()
          .optional()
          .describe("New description for the group."),
        inventory_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New resolved inventory ID for the group."),
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
              resource_type: "group",
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
          if (args.inventory_id !== undefined) {
            body.inventory = args.inventory_id;
          }

          const result = await executeCrud(
            awxClient,
            "group",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Group ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update group ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "group",
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
     * Delete an AWX group.
     *
     * Removes a group from AWX via DELETE /api/v2/groups/<id>/.
     * Requires the group ID. Returns a ResourceMutationOutput envelope
     * with data set to null.
     */
    "awx-delete-group": tool({
      description: [
        "Delete an AWX group by ID.",
        "Removes the group from AWX via DELETE /api/v2/groups/<id>/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the group to delete."),
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
              resource_type: "group",
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
            "group",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Group ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete group ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "group",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════════
    // Label CRUD Tools
    // ═════════════════════════════════════════════════════════════

    /**
     * Create a new AWX label.
     *
     * Creates a label in AWX via POST /api/v2/labels/.
     * Requires name and organization_id. The organization_id must be a
     * pre-resolved AWX organization ID. Labels are organization-scoped.
     * Optional description field is supported.
     *
     * Returns a ResourceMutationOutput envelope containing the created
     * label detail (mapped via mapLabel).
     */
    "awx-create-label": tool({
      description: [
        "Create a new AWX label.",
        "Requires name and organization_id (resolved organization ID).",
        "Labels are organization-scoped.",
        "Optional description is supported.",
        "Returns created label detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string()
          .min(1)
          .describe("The name of the new label."),
        organization_id: z
          .number()
          .int()
          .positive()
          .describe("The resolved AWX organization ID to assign this label to."),
        description: z
          .string()
          .optional()
          .describe("Optional description for the label."),
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
              resource_type: "label",
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
            "label",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Label "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create label: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "label",
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
     * Update an existing AWX label.
     *
     * Modifies a label in AWX via PATCH /api/v2/labels/<id>/.
     * Requires the label ID; name, organization_id, and description
     * are optional partial-update fields.
     *
     * Returns a ResourceMutationOutput envelope containing the updated
     * label detail (mapped via mapLabel).
     */
    "awx-update-label": tool({
      description: [
        "Update an existing AWX label by ID.",
        "Accepts partial fields (name, organization_id, description).",
        "Returns updated label detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the label to update."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("New name for the label."),
        organization_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New resolved organization ID for the label."),
        description: z
          .string()
          .optional()
          .describe("New description for the label."),
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
              resource_type: "label",
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
          if (args.organization_id !== undefined) {
            body.organization = args.organization_id;
          }
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const result = await executeCrud(
            awxClient,
            "label",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Label ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update label ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "label",
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
     * Delete an AWX label.
     *
     * Removes a label from AWX via DELETE /api/v2/labels/<id>/.
     * Requires the label ID. Returns a ResourceMutationOutput envelope
     * with data set to null.
     */
    "awx-delete-label": tool({
      description: [
        "Delete an AWX label by ID.",
        "Removes the label from AWX via DELETE /api/v2/labels/<id>/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the label to delete."),
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
              resource_type: "label",
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
            "label",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Label ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete label ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "label",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════════
    // Instance Group CRUD Tools
    // ═════════════════════════════════════════════════════════════

    /**
     * Create a new AWX instance group.
     *
     * Creates an instance group in AWX via POST /api/v2/instance_groups/.
     * Requires name. Optional description field is supported.
     *
     * Returns a ResourceMutationOutput envelope containing the created
     * instance group detail (mapped via mapInstanceGroup).
     */
    "awx-create-instance-group": tool({
      description: [
        "Create a new AWX instance group.",
        "Requires name. Optional description is supported.",
        "Returns created instance group detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string()
          .min(1)
          .describe("The name of the new instance group."),
        description: z
          .string()
          .optional()
          .describe("Optional description for the instance group."),
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
              resource_type: "instance-group",
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
          };
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const result = await executeCrud(
            awxClient,
            "instance-group",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Instance Group "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create instance group: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "instance-group",
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
     * Update an existing AWX instance group.
     *
     * Modifies an instance group in AWX via PATCH /api/v2/instance_groups/<id>/.
     * Requires the instance group ID; name and description are optional
     * partial-update fields.
     *
     * Returns a ResourceMutationOutput envelope containing the updated
     * instance group detail (mapped via mapInstanceGroup).
     */
    "awx-update-instance-group": tool({
      description: [
        "Update an existing AWX instance group by ID.",
        "Accepts partial fields (name, description).",
        "Returns updated instance group detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the instance group to update."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("New name for the instance group."),
        description: z
          .string()
          .optional()
          .describe("New description for the instance group."),
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
              resource_type: "instance-group",
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

          const result = await executeCrud(
            awxClient,
            "instance-group",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Instance Group ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update instance group ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "instance-group",
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
     * Delete an AWX instance group.
     *
     * Removes an instance group from AWX via DELETE /api/v2/instance_groups/<id>/.
     * Requires the instance group ID. Returns a ResourceMutationOutput envelope
     * with data set to null.
     */
    "awx-delete-instance-group": tool({
      description: [
        "Delete an AWX instance group by ID.",
        "Removes the instance group from AWX via DELETE /api/v2/instance_groups/<id>/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the instance group to delete."),
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
              resource_type: "instance-group",
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
            "instance-group",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Instance Group ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete instance group ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "instance-group",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════════
    // Execution Environment CRUD Tools
    // ═════════════════════════════════════════════════════════════

    /**
     * Create a new AWX execution environment.
     *
     * Creates an execution environment in AWX via POST /api/v2/execution_environments/.
     * Requires name, image, and organization_id. The organization_id must be a
     * pre-resolved AWX organization ID.
     * Optional description field is supported.
     *
     * Returns a ResourceMutationOutput envelope containing the created
     * execution environment detail (mapped via mapExecutionEnvironment).
     */
    "awx-create-execution-environment": tool({
      description: [
        "Create a new AWX execution environment.",
        "Requires name, image, and organization_id (resolved organization ID).",
        "Optional description is supported.",
        "Returns created execution environment detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string()
          .min(1)
          .describe("The name of the new execution environment."),
        image: z
          .string()
          .min(1)
          .describe("The container image URL (e.g., quay.io/ansible/awx-ee:latest)."),
        organization_id: z
          .number()
          .int()
          .positive()
          .describe("The resolved AWX organization ID to assign this execution environment to."),
        description: z
          .string()
          .optional()
          .describe("Optional description for the execution environment."),
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
              resource_type: "execution-environment",
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
            image: args.image,
            organization: args.organization_id,
          };
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const result = await executeCrud(
            awxClient,
            "execution-environment",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Execution Environment "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create execution environment: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "execution-environment",
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
     * Update an existing AWX execution environment.
     *
     * Modifies an execution environment in AWX via PATCH /api/v2/execution_environments/<id>/.
     * Requires the execution environment ID; name, image, organization_id, and description
     * are optional partial-update fields.
     *
     * Returns a ResourceMutationOutput envelope containing the updated
     * execution environment detail (mapped via mapExecutionEnvironment).
     */
    "awx-update-execution-environment": tool({
      description: [
        "Update an existing AWX execution environment by ID.",
        "Accepts partial fields (name, image, organization_id, description).",
        "Returns updated execution environment detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the execution environment to update."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe("New name for the execution environment."),
        image: z
          .string()
          .min(1)
          .optional()
          .describe("New container image URL."),
        organization_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("New resolved organization ID for the execution environment."),
        description: z
          .string()
          .optional()
          .describe("New description for the execution environment."),
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
              resource_type: "execution-environment",
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
          if (args.image !== undefined) {
            body.image = args.image;
          }
          if (args.organization_id !== undefined) {
            body.organization = args.organization_id;
          }
          if (args.description !== undefined) {
            body.description = args.description;
          }

          const result = await executeCrud(
            awxClient,
            "execution-environment",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Execution Environment ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update execution environment ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "execution-environment",
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
     * Delete an AWX execution environment.
     *
     * Removes an execution environment from AWX via DELETE /api/v2/execution_environments/<id>/.
     * Requires the execution environment ID. Returns a ResourceMutationOutput envelope
     * with data set to null.
     */
    "awx-delete-execution-environment": tool({
      description: [
        "Delete an AWX execution environment by ID.",
        "Removes the execution environment from AWX via DELETE /api/v2/execution_environments/<id>/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the execution environment to delete."),
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
              resource_type: "execution-environment",
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
            "execution-environment",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Execution Environment ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message =
            err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete execution environment ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "execution-environment",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═══════════════════════════════════════════════════════════════
    // Credential CRUD
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create a new AWX credential.
     *
     * Creates a credential in AWX with the specified name, organization,
     * and credential type. The organization_id and credential_type_id
     * must be resolved numeric IDs (not names). Optional inputs can be
     * provided for the credential (e.g. username, password) but are
     * NEVER exposed in the tool output.
     * Delegates to crud.ts for the HTTP dispatch and mapCredential for
     * the response (which explicitly excludes sensitive inputs).
     * Returns the created credential detail in the standard mutation envelope.
     */
    "awx-create-credential": tool({
      description: [
        "Create a new AWX credential with the specified name, organization,",
        "and credential type. The organization_id and credential_type_id",
        "must be resolved numeric IDs (not names). Inputs for the credential",
        "(e.g. username, password) are accepted but NEVER exposed in output.",
        "Returns the created credential detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        name: z
          .string().min(1)
          .describe("Credential name"),
        organization_id: z
          .number()
          .int()
          .positive()
          .describe("Resolved organization ID"),
        credential_type_id: z
          .number()
          .int()
          .positive()
          .describe("Resolved credential type ID"),
        description: z
          .string()
          .optional()
          .describe("Credential description"),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Credential inputs (e.g. { username, password }) — never exposed in output"),
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
            organization: args.organization_id,
            credential_type: args.credential_type_id,
          };
          if (args.description !== undefined) body.description = args.description;
          if (args.inputs !== undefined) body.inputs = args.inputs;

          const result = await executeCrud(
            awxClient,
            "credential",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          const credentialName = mutationOutput.data
            ? (mutationOutput.data as Record<string, unknown>).name as string ?? ""
            : "";
          return {
            output: `Credential ${result.id} created successfully. Name: ${credentialName}`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create credential: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "credential",
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
     * Update an existing AWX credential.
     *
     * Modifies an existing credential by PATCHing the specified fields.
     * Only provided fields are updated (partial update semantics).
     * Requires the credential ID. Supports updating name, organization_id,
     * credential_type_id, description, and inputs. Sensitive inputs are
     * NEVER exposed in the tool output.
     * Delegates to crud.ts for the HTTP dispatch and mapCredential for the response.
     * Returns the updated credential detail in the standard mutation envelope.
     */
    "awx-update-credential": tool({
      description: [
        "Update an existing AWX credential by ID. Partial update — only",
        "provided fields are modified. Supports updating name,",
        "organization_id, credential_type_id, description, and inputs.",
        "Sensitive inputs are NEVER exposed in the tool output.",
        "Returns the updated credential detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the credential to update."),
        name: z
          .string()
          .optional()
          .describe("New credential name"),
        organization_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Resolved organization ID"),
        credential_type_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Resolved credential type ID"),
        description: z
          .string()
          .optional()
          .describe("Credential description"),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Credential inputs — never exposed in output"),
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
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.organization_id !== undefined) body.organization = args.organization_id;
          if (args.credential_type_id !== undefined) body.credential_type = args.credential_type_id;
          if (args.description !== undefined) body.description = args.description;
          if (args.inputs !== undefined) body.inputs = args.inputs;

          const result = await executeCrud(
            awxClient,
            "credential",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Credential ${result.id} updated successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update credential ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "credential",
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
     * Delete an AWX credential.
     *
     * Deletes a credential by ID from AWX. This action is irreversible.
     * The credential must exist and the user must have sufficient permissions.
     * Delegates to crud.ts for the HTTP dispatch.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-credential": tool({
      description: [
        "Delete an AWX credential by ID. This action is irreversible.",
        "The credential must exist and the user must have sufficient",
        "permissions to delete it. Returns the standard mutation",
        "envelope with data: null on success.",
      ].join(" "),
      args: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The numeric ID of the AWX credential to delete."),
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
          const result = await executeCrud(
            awxClient,
            "credential",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Credential ${result.id} deleted successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete credential ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "credential",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ─── Organization CRUD ─────────────────────────────────────────

    /**
     * Create a new AWX organization.
     *
     * Creates an organization in AWX via POST /api/v2/organizations/.
     * Requires name. Optional description and custom_insights_url are supported.
     * Returns the created organization detail in the standard mutation envelope.
     */
    "awx-create-organization": tool({
      description: [
        "Create a new AWX organization.",
        "Requires name. Optional description is supported.",
        "Returns the created organization detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        name: z.string().min(1).describe("Organization name"),
        description: z.string().optional().describe("Organization description"),
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
          const body: Record<string, unknown> = { name: args.name };
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "organization",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          const orgName = mutationOutput.data
            ? (mutationOutput.data as Record<string, unknown>).name as string ?? ""
            : "";
          return {
            output: `Organization ${result.id} created successfully. Name: ${orgName}`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create organization: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "organization",
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
     * Update an existing AWX organization.
     *
     * Modifies an organization by PATCHing /api/v2/organizations/<id>/.
     * Only provided fields are updated (partial update semantics).
     * Supports updating name and description.
     * Returns the updated organization detail in the standard mutation envelope.
     */
    "awx-update-organization": tool({
      description: [
        "Update an existing AWX organization by ID.",
        "Accepts partial fields (name, description).",
        "Returns the updated organization detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the organization to update."),
        name: z.string().optional().describe("New organization name"),
        description: z.string().optional().describe("New organization description"),
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
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "organization",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Organization ${result.id} updated successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update organization ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "organization",
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
     * Delete an AWX organization.
     *
     * Deletes an organization by ID from AWX via DELETE /api/v2/organizations/<id>/.
     * This action is irreversible.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-organization": tool({
      description: [
        "Delete an AWX organization by ID. This action is irreversible.",
        "The organization must exist and the user must have sufficient",
        "permissions to delete it. Returns the standard mutation",
        "envelope with data: null on success.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the AWX organization to delete."),
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
          const result = await executeCrud(
            awxClient,
            "organization",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Organization ${result.id} deleted successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete organization ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "organization",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════
    // User CRUD Tools
    // ═════════════════════════════════════════════════════════

    /**
     * Create a new AWX user. Requires username and password.
     * Optional fields: first_name, last_name, email, is_superuser,
     * is_system_auditor, and organization_id.
     * Returns the created user detail in the standard mutation envelope.
     */
    "awx-create-user": tool({
      description: [
        "Create a new AWX user. Requires username and password.",
        "Optional fields: first_name, last_name, email, is_superuser,",
        "is_system_auditor, and organization_id.",
        "Returns the created user detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        username: z.string().min(1).describe("Username for the new user"),
        password: z.string().min(1).describe("Password for the new user (create-only)"),
        first_name: z.string().optional().describe("First name"),
        last_name: z.string().optional().describe("Last name"),
        email: z.string().optional().describe("Email address"),
        is_superuser: z.boolean().optional().describe("Whether the user is a superuser"),
        is_system_auditor: z.boolean().optional().describe("Whether the user is a system auditor"),
        organization_id: z.number().int().positive().optional().describe("Resolved organization ID to assign the user to"),
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
            username: args.username,
            password: args.password,
          };
          if (args.first_name !== undefined) body.first_name = args.first_name;
          if (args.last_name !== undefined) body.last_name = args.last_name;
          if (args.email !== undefined) body.email = args.email;
          if (args.is_superuser !== undefined) body.is_superuser = args.is_superuser;
          if (args.is_system_auditor !== undefined) body.is_system_auditor = args.is_system_auditor;
          if (args.organization_id !== undefined) body.organization = args.organization_id;

          const result = await executeCrud(
            awxClient,
            "user",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `User "${args.username}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create user: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "user",
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
     * Update an existing AWX user.
     *
     * Modifies a user in AWX via PATCH /api/v2/users/{id}/.
     * Only provided fields are updated (partial update semantics).
     * Returns the updated user detail in the standard mutation envelope.
     */
    "awx-update-user": tool({
      description: [
        "Update an existing AWX user by ID. Partial update — only",
        "provided fields are modified. Supports updating username,",
        "first_name, last_name, email, is_superuser,",
        "is_system_auditor, and organization_id.",
        "Returns the updated user detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the user to update"),
        username: z.string().optional().describe("New username"),
        first_name: z.string().optional().describe("First name"),
        last_name: z.string().optional().describe("Last name"),
        email: z.string().optional().describe("Email address"),
        is_superuser: z.boolean().optional().describe("Whether the user is a superuser"),
        is_system_auditor: z.boolean().optional().describe("Whether the user is a system auditor"),
        organization_id: z.number().int().positive().optional().describe("Resolved organization ID to assign"),
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
          const body: Record<string, unknown> = {};
          if (args.username !== undefined) body.username = args.username;
          if (args.first_name !== undefined) body.first_name = args.first_name;
          if (args.last_name !== undefined) body.last_name = args.last_name;
          if (args.email !== undefined) body.email = args.email;
          if (args.is_superuser !== undefined) body.is_superuser = args.is_superuser;
          if (args.is_system_auditor !== undefined) body.is_system_auditor = args.is_system_auditor;
          if (args.organization_id !== undefined) body.organization = args.organization_id;

          const result = await executeCrud(
            awxClient,
            "user",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `User ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update user ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "user",
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
     * Delete an AWX user.
     *
     * Removes a user from AWX via DELETE /api/v2/users/{id}/.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-user": tool({
      description: [
        "Delete an AWX user by ID.",
        "Removes the user from AWX via DELETE /api/v2/users/{id}/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the user to delete."),
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
          const result = await executeCrud(
            awxClient,
            "user",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `User ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete user ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "user",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════
    // Team CRUD Tools
    // ═════════════════════════════════════════════════════════

    /**
     * Create a new AWX team.
     *
     * Creates a team in AWX via POST /api/v2/teams/.
     * `name` and `organization_id` are required.
     * `description` is optional.
     * Returns the created team detail in the standard mutation envelope.
     */
    "awx-create-team": tool({
      description: [
        "Create a new AWX team. Requires name and organization_id",
        "(resolved numeric ID, not a name).",
        "Optional description is supported.",
        "Returns created team detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z.string().min(1).describe("The name of the new team."),
        organization_id: z.number().int().positive().describe("The resolved AWX organization ID to assign this team to."),
        description: z.string().optional().describe("Optional description for the team."),
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
            organization: args.organization_id,
          };
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "team",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Team "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create team: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "team",
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
     * Update an existing AWX team.
     *
     * Modifies a team in AWX via PATCH /api/v2/teams/{id}/.
     * Only provided fields are updated (partial update semantics).
     * Returns the updated team detail in the standard mutation envelope.
     */
    "awx-update-team": tool({
      description: [
        "Update an existing AWX team by ID. Partial update — only",
        "provided fields are modified. Supports updating name,",
        "organization_id, and description.",
        "Returns the updated team detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the team to update."),
        name: z.string().min(1).optional().describe("New name for the team."),
        organization_id: z.number().int().positive().optional().describe("Resolved organization ID for the team."),
        description: z.string().optional().describe("New description for the team."),
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
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.organization_id !== undefined) body.organization = args.organization_id;
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "team",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Team ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update team ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "team",
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
     * Delete an AWX team.
     *
     * Removes a team from AWX via DELETE /api/v2/teams/{id}/.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-team": tool({
      description: [
        "Delete an AWX team by ID.",
        "Removes the team from AWX via DELETE /api/v2/teams/{id}/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the team to delete."),
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
          const result = await executeCrud(
            awxClient,
            "team",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Team ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete team ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "team",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════
    // Schedule CRUD Tools
    // ═════════════════════════════════════════════════════════

    /**
     * Create a new AWX schedule.
     *
     * Creates a schedule in AWX via POST /api/v2/schedules/.
     * `name`, `rrule`, and `unified_job_template_id` are required.
     * `rrule` is an RFC 5545 recurrence rule string passed through as-is.
     * Returns the created schedule detail in the standard mutation envelope.
     */
    "awx-create-schedule": tool({
      description: [
        "Create a new AWX schedule. Requires name, rrule (RFC 5545 recurrence",
        "rule string), and unified_job_template_id (resolved numeric ID).",
        "Optional fields: description and extra_data.",
        "Returns created schedule detail in a standard mutation envelope.",
      ].join(" "),
      args: {
        name: z.string().min(1).describe("The name of the new schedule."),
        rrule: z.string().min(1).describe("RFC 5545 recurrence rule string (e.g., 'DTSTART:20250101T000000Z RRULE:FREQ=DAILY;INTERVAL=1')"),
        unified_job_template_id: z.number().int().positive().describe("The resolved AWX job template ID to schedule."),
        description: z.string().optional().describe("Optional description for the schedule."),
        extra_data: z.record(z.string(), z.unknown()).optional().describe("Optional extra variables to pass to the scheduled job."),
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
            rrule: args.rrule,
            unified_job_template: args.unified_job_template_id,
          };
          if (args.description !== undefined) body.description = args.description;
          if (args.extra_data !== undefined) body.extra_data = args.extra_data;

          const result = await executeCrud(
            awxClient,
            "schedule",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Schedule "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create schedule: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "schedule",
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
     * Update an existing AWX schedule.
     *
     * Modifies a schedule in AWX via PATCH /api/v2/schedules/{id}/.
     * Only provided fields are updated (partial update semantics).
     * Returns the updated schedule detail in the standard mutation envelope.
     */
    "awx-update-schedule": tool({
      description: [
        "Update an existing AWX schedule by ID. Partial update — only",
        "provided fields are modified. Supports updating name, rrule,",
        "unified_job_template_id, description, and extra_data.",
        "Returns the updated schedule detail in the standard mutation envelope.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the schedule to update."),
        name: z.string().min(1).optional().describe("New name for the schedule."),
        rrule: z.string().min(1).optional().describe("RFC 5545 recurrence rule string."),
        unified_job_template_id: z.number().int().positive().optional().describe("Resolved AWX job template ID."),
        description: z.string().optional().describe("New description for the schedule."),
        extra_data: z.record(z.string(), z.unknown()).optional().describe("Extra variables to pass to the scheduled job."),
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
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.rrule !== undefined) body.rrule = args.rrule;
          if (args.unified_job_template_id !== undefined) body.unified_job_template = args.unified_job_template_id;
          if (args.description !== undefined) body.description = args.description;
          if (args.extra_data !== undefined) body.extra_data = args.extra_data;

          const result = await executeCrud(
            awxClient,
            "schedule",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Schedule ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update schedule ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "schedule",
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
     * Delete an AWX schedule.
     *
     * Removes a schedule from AWX via DELETE /api/v2/schedules/{id}/.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-schedule": tool({
      description: [
        "Delete an AWX schedule by ID.",
        "Removes the schedule from AWX via DELETE /api/v2/schedules/{id}/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the schedule to delete."),
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
          const result = await executeCrud(
            awxClient,
            "schedule",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Schedule ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete schedule ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "schedule",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ═════════════════════════════════════════════════════════
    // Notification Template CRUD Tools
    // ═════════════════════════════════════════════════════════

    /**
     * Create a new AWX notification template.
     *
     * Creates a notification template in AWX via POST /api/v2/notification_templates/.
     * `name`, `notification_type`, `organization_id`, and `notification_configuration`
     * are required.
     * `notification_configuration` shape depends on `notification_type`
     * (e.g., email, slack, webhook) — AWX validates server-side.
     * Returns the created notification template detail in the standard mutation envelope.
     */
    "awx-create-notification-template": tool({
      description: [
        "Create a new AWX notification template. Requires name,",
        "notification_type (e.g., email, slack, webhook),",
        "organization_id (resolved numeric ID), and",
        "notification_configuration (type-dependent object).",
        "Returns created notification template detail in a standard",
        "mutation envelope.",
      ].join(" "),
      args: {
        name: z.string().min(1).describe("The name of the notification template."),
        notification_type: z.enum(["email", "slack", "webhook", "pagerduty", "grafana", "irc", "twilio", "mattermost", "rocketchat"]).describe("Notification type (email, slack, webhook, etc.)"),
        organization_id: z.number().int().positive().describe("The resolved AWX organization ID to assign this notification template to."),
        notification_configuration: z.record(z.string(), z.unknown()).describe("Type-dependent configuration object (e.g., {channels: ['#ops']} for slack)"),
        description: z.string().optional().describe("Optional description for the notification template."),
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
            notification_type: args.notification_type,
            organization: args.organization_id,
            notification_configuration: args.notification_configuration,
          };
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "notification_template",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Notification template "${args.name}" created (ID ${result.id}).`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create notification template: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "notification_template",
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
     * Update an existing AWX notification template.
     *
     * Modifies a notification template in AWX via PATCH /api/v2/notification_templates/{id}/.
     * Only provided fields are updated (partial update semantics).
     * Returns the updated notification template detail in the standard mutation envelope.
     */
    "awx-update-notification-template": tool({
      description: [
        "Update an existing AWX notification template by ID. Partial update",
        "— only provided fields are modified. Supports updating name,",
        "notification_type, organization_id, notification_configuration,",
        "and description.",
        "Returns the updated notification template detail in the standard",
        "mutation envelope.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the notification template to update."),
        name: z.string().min(1).optional().describe("New name for the notification template."),
        notification_type: z.enum(["email", "slack", "webhook", "pagerduty", "grafana", "irc", "twilio", "mattermost", "rocketchat"]).optional().describe("Notification type."),
        organization_id: z.number().int().positive().optional().describe("Resolved organization ID for the notification template."),
        notification_configuration: z.record(z.string(), z.unknown()).optional().describe("Type-dependent configuration object."),
        description: z.string().optional().describe("New description for the notification template."),
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
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.notification_type !== undefined) body.notification_type = args.notification_type;
          if (args.organization_id !== undefined) body.organization = args.organization_id;
          if (args.notification_configuration !== undefined) body.notification_configuration = args.notification_configuration;
          if (args.description !== undefined) body.description = args.description;

          const result = await executeCrud(
            awxClient,
            "notification_template",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Notification template ${args.id} updated.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update notification template ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "notification_template",
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
     * Delete an AWX notification template.
     *
     * Removes a notification template from AWX via DELETE /api/v2/notification_templates/{id}/.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-notification-template": tool({
      description: [
        "Delete an AWX notification template by ID.",
        "Removes the notification template from AWX via",
        "DELETE /api/v2/notification_templates/{id}/.",
        "Returns a standard mutation envelope with data set to null.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the notification template to delete."),
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
          const result = await executeCrud(
            awxClient,
            "notification_template",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Notification template ${args.id} deleted.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete notification template ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "notification_template",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            } as unknown as Record<string, unknown>,
          };
        }
      },
    }),

    // ─── Workflow Template CRUD ──────────────────────────────────

    /**
     * Create a new AWX workflow job template.
     *
     * Creates a workflow job template in AWX via POST /api/v2/workflow_job_templates/.
     * Requires name and organization_id. Optional fields include description,
     * inventory_id, limit, verbosity, extra_vars, job_tags, skip_tags, timeout,
     * and various ask_* / survey / allow_simultaneous flags.
     *
     * Note: Workflow templates are different from regular job templates —
     * they have no project, playbook, or job_type fields.
     *
     * Returns the created workflow template detail in the standard mutation envelope.
     */
    "awx-create-workflow-template": tool({
      description: [
        "Create a new AWX workflow job template.",
        "Requires name and organization_id (resolved organization ID).",
        "Optional fields: description, inventory_id, limit, verbosity,",
        "extra_vars (object), job_tags, skip_tags, timeout, and various",
        "ask_* / survey_enabled / allow_simultaneous flags.",
        "Workflow templates have no project, playbook, or job_type fields.",
        "Returns the created workflow template detail in the standard",
        "ResourceMutationOutput envelope.",
      ].join(" "),
      args: {
        name: z.string().min(1).describe("Workflow template name"),
        organization_id: z.number().int().positive().describe("Resolved AWX organization ID"),
        description: z.string().optional().describe("Optional workflow template description"),
        inventory_id: z.number().int().positive().optional().describe("Resolved AWX inventory ID"),
        limit: z.string().optional().describe("Host limit pattern (e.g., webservers)"),
        verbosity: z.number().int().min(0).max(5).optional().describe("Verbosity level (0-5)"),
        extra_vars: z.record(z.string(), z.unknown()).optional().describe("Extra variables (will be serialized to JSON string)"),
        job_tags: z.string().optional().describe("Comma-separated list of job tags to run"),
        skip_tags: z.string().optional().describe("Comma-separated list of job tags to skip"),
        timeout: z.number().int().min(0).optional().describe("Job timeout in seconds (0 = no timeout)"),
        ask_variables_on_launch: z.boolean().optional().describe("Prompt for variables on launch"),
        ask_inventory_on_launch: z.boolean().optional().describe("Prompt for inventory on launch"),
        ask_limit_on_launch: z.boolean().optional().describe("Prompt for limit on launch"),
        ask_tags_on_launch: z.boolean().optional().describe("Prompt for job tags on launch"),
        ask_skip_tags_on_launch: z.boolean().optional().describe("Prompt for skip tags on launch"),
        ask_credential_on_launch: z.boolean().optional().describe("Prompt for credential on launch"),
        survey_enabled: z.boolean().optional().describe("Enable survey mode"),
        allow_simultaneous: z.boolean().optional().describe("Allow simultaneous runs"),
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
            organization: args.organization_id,
          };
          if (args.description !== undefined) body.description = args.description;
          if (args.inventory_id !== undefined) body.inventory = args.inventory_id;
          if (args.limit !== undefined) body.limit = args.limit;
          if (args.verbosity !== undefined) body.verbosity = args.verbosity;
          if (args.extra_vars !== undefined) body.extra_vars = JSON.stringify(args.extra_vars);
          if (args.job_tags !== undefined) body.job_tags = args.job_tags;
          if (args.skip_tags !== undefined) body.skip_tags = args.skip_tags;
          if (args.timeout !== undefined) body.timeout = args.timeout;
          if (args.ask_variables_on_launch !== undefined) body.ask_variables_on_launch = args.ask_variables_on_launch;
          if (args.ask_inventory_on_launch !== undefined) body.ask_inventory_on_launch = args.ask_inventory_on_launch;
          if (args.ask_limit_on_launch !== undefined) body.ask_limit_on_launch = args.ask_limit_on_launch;
          if (args.ask_tags_on_launch !== undefined) body.ask_tags_on_launch = args.ask_tags_on_launch;
          if (args.ask_skip_tags_on_launch !== undefined) body.ask_skip_tags_on_launch = args.ask_skip_tags_on_launch;
          if (args.ask_credential_on_launch !== undefined) body.ask_credential_on_launch = args.ask_credential_on_launch;
          if (args.survey_enabled !== undefined) body.survey_enabled = args.survey_enabled;
          if (args.allow_simultaneous !== undefined) body.allow_simultaneous = args.allow_simultaneous;

          const crudResult = await executeCrud(
            awxClient,
            "workflow_template",
            "create",
            undefined,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(crudResult);
          return {
            output: `Workflow template ${crudResult.id} created successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to create workflow template: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "created",
              resource_type: "workflow_template",
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
     * Update an existing AWX workflow job template.
     *
     * Modifies a workflow job template via PATCH /api/v2/workflow_job_templates/{id}/.
     * Accepts partial fields — only the fields to change. The id parameter
     * is required to identify the workflow template.
     *
     * Returns the updated workflow template detail in the standard
     * ResourceMutationOutput envelope.
     */
    "awx-update-workflow-template": tool({
      description: [
        "Update an existing AWX workflow job template.",
        "Accepts partial fields — only the fields to change.",
        "The id parameter identifies the workflow template.",
        "Supports updating name, description, organization_id,",
        "inventory_id, limit, verbosity, extra_vars (object),",
        "job_tags, skip_tags, timeout, and various ask_* /",
        "survey_enabled / allow_simultaneous flags.",
        "Returns the updated workflow template detail in the",
        "standard ResourceMutationOutput envelope.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the workflow template to update"),
        name: z.string().min(1).optional().describe("Workflow template name"),
        description: z.string().optional().describe("Description"),
        organization_id: z.number().int().positive().optional().describe("Resolved AWX organization ID"),
        inventory_id: z.number().int().positive().optional().describe("Resolved AWX inventory ID"),
        limit: z.string().optional().describe("Host limit pattern (e.g., webservers)"),
        verbosity: z.number().int().min(0).max(5).optional().describe("Verbosity level (0-5)"),
        extra_vars: z.record(z.string(), z.unknown()).optional().describe("Extra variables (will be serialized to JSON string)"),
        job_tags: z.string().optional().describe("Comma-separated list of job tags to run"),
        skip_tags: z.string().optional().describe("Comma-separated list of job tags to skip"),
        timeout: z.number().int().min(0).optional().describe("Job timeout in seconds (0 = no timeout)"),
        ask_variables_on_launch: z.boolean().optional().describe("Prompt for variables on launch"),
        ask_inventory_on_launch: z.boolean().optional().describe("Prompt for inventory on launch"),
        ask_limit_on_launch: z.boolean().optional().describe("Prompt for limit on launch"),
        ask_tags_on_launch: z.boolean().optional().describe("Prompt for job tags on launch"),
        ask_skip_tags_on_launch: z.boolean().optional().describe("Prompt for skip tags on launch"),
        ask_credential_on_launch: z.boolean().optional().describe("Prompt for credential on launch"),
        survey_enabled: z.boolean().optional().describe("Enable survey mode"),
        allow_simultaneous: z.boolean().optional().describe("Allow simultaneous runs"),
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
          const body: Record<string, unknown> = {};
          if (args.name !== undefined) body.name = args.name;
          if (args.description !== undefined) body.description = args.description;
          if (args.organization_id !== undefined) body.organization = args.organization_id;
          if (args.inventory_id !== undefined) body.inventory = args.inventory_id;
          if (args.limit !== undefined) body.limit = args.limit;
          if (args.verbosity !== undefined) body.verbosity = args.verbosity;
          if (args.extra_vars !== undefined) body.extra_vars = JSON.stringify(args.extra_vars);
          if (args.job_tags !== undefined) body.job_tags = args.job_tags;
          if (args.skip_tags !== undefined) body.skip_tags = args.skip_tags;
          if (args.timeout !== undefined) body.timeout = args.timeout;
          if (args.ask_variables_on_launch !== undefined) body.ask_variables_on_launch = args.ask_variables_on_launch;
          if (args.ask_inventory_on_launch !== undefined) body.ask_inventory_on_launch = args.ask_inventory_on_launch;
          if (args.ask_limit_on_launch !== undefined) body.ask_limit_on_launch = args.ask_limit_on_launch;
          if (args.ask_tags_on_launch !== undefined) body.ask_tags_on_launch = args.ask_tags_on_launch;
          if (args.ask_skip_tags_on_launch !== undefined) body.ask_skip_tags_on_launch = args.ask_skip_tags_on_launch;
          if (args.ask_credential_on_launch !== undefined) body.ask_credential_on_launch = args.ask_credential_on_launch;
          if (args.survey_enabled !== undefined) body.survey_enabled = args.survey_enabled;
          if (args.allow_simultaneous !== undefined) body.allow_simultaneous = args.allow_simultaneous;

          const crudResult = await executeCrud(
            awxClient,
            "workflow_template",
            "update",
            args.id,
            body,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(crudResult);
          return {
            output: `Workflow template ${crudResult.id} updated successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to update workflow template ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "updated",
              resource_type: "workflow_template",
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
     * Delete an AWX workflow job template.
     *
     * Deletes a workflow job template from AWX via DELETE /api/v2/workflow_job_templates/{id}/.
     * This action is irreversible. The workflow template must exist and the user
     * must have sufficient permissions.
     * Returns the standard mutation envelope with data: null on success.
     */
    "awx-delete-workflow-template": tool({
      description: [
        "Delete an AWX workflow job template by ID. This action is",
        "irreversible. The workflow template must exist and the user",
        "must have sufficient permissions to delete it. Returns the",
        "standard mutation envelope with data: null on success.",
      ].join(" "),
      args: {
        id: z.number().int().positive().describe("The numeric ID of the AWX workflow template to delete."),
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
          const result = await executeCrud(
            awxClient,
            "workflow_template",
            "delete",
            args.id,
            undefined,
            context.abort,
          );

          const mutationOutput = wrapMutationResult(result);
          return {
            output: `Workflow template ${result.id} deleted successfully.`,
            metadata: mutationOutput as unknown as Record<string, unknown>,
          };
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") {
            return { output: "Request was aborted." };
          }
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `Failed to delete workflow template ${args.id}: ${message}`,
            metadata: {
              schema_version: "1.0",
              action: "deleted",
              resource_type: "workflow_template",
              id: args.id,
              data: null,
              warnings: [],
              errors: [message],
            },
          };
        }
      },
    }),
  };
}
