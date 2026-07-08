/**
 * run-command.ts — Thin proxy for POST /api/v2/ad_hoc_commands/
 *
 * Launches an ad-hoc Ansible command via the AWX API. No transforms,
 * no validation beyond the AWX API's own checks — just forward the
 * parameters to /api/v2/ad_hoc_commands/ and return the raw response.
 */
import type { AwxClient } from "./client.js";

/**
 * Launch an ad-hoc Ansible command via the AWX API.
 *
 * POSTs to /api/v2/ad_hoc_commands/ with the given inventory,
 * credential, module name, optional module arguments, and optional
 * host limit pattern. Returns the raw AWX API response body.
 *
 * @param client       - The AWX HTTP client
 * @param inventoryId  - The inventory ID to run the command against
 * @param credentialId - The machine credential ID for SSH access
 * @param moduleName   - The Ansible module to run (e.g. "command", "shell", "ping", "setup")
 * @param moduleArgs   - Optional arguments for the module (e.g. "uptime", "ls -la")
 * @param limit        - Optional host pattern (e.g. "webservers", "*.example.com")
 * @param abortSignal  - Optional abort signal propagated to the HTTP client
 * @returns The raw AWX API response body for the created ad-hoc command
 * @throws Error if the AWX API returns an unexpected error
 */
export async function runCommand(
  client: AwxClient,
  inventoryId: number,
  credentialId: number,
  moduleName: string,
  moduleArgs?: string,
  limit?: string,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  // ── Build request body ────────────────────────────────────────
  const body: Record<string, unknown> = {
    inventory: inventoryId,
    credential: credentialId,
    module_name: moduleName,
  };

  if (moduleArgs !== undefined) {
    body.module_args = moduleArgs;
  }

  if (limit !== undefined) {
    body.limit = limit;
  }

  // ── Call AWX ad-hoc commands API ──────────────────────────────
  const response = await client.request(
    "awx-run-command",
    "/api/v2/ad_hoc_commands/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    abortSignal,
  );

  // ── Parse response body (text-first to handle non-JSON) ────────
  const text = await response.text();
  let responseBody: Record<string, unknown> | undefined;
  try {
    responseBody = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  } catch {
    responseBody = undefined;
  }

  // ── Handle error responses ────────────────────────────────────
  if (!response.ok) {
    const detail =
      typeof responseBody === "object" && responseBody && "detail" in responseBody
        ? String((responseBody as { detail: unknown }).detail)
        : text || response.statusText;
    throw new Error(`AWX ad-hoc command failed: HTTP ${response.status}: ${detail}`);
  }

  // ── Return raw AWX response body ──────────────────────────────
  return responseBody ?? {};
}
