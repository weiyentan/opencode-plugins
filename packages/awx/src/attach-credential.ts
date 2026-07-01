/**
 * attach-credential.ts — Thin proxy for POST /api/v2/job_templates/{id}/credentials/
 *
 * Attaches a credential to a job template in AWX by making a POST request
 * to the AWX API credentials endpoint. No transforms, no validation beyond
 * the AWX API's own checks — just forward the credential ID.
 */
import type { AwxClient } from "./client.js";

/**
 * Attach a credential to an AWX job template.
 *
 * Makes a POST request to /api/v2/job_templates/{templateId}/credentials/
 * with body { "id": credentialId }.
 *
 * @param client       - The AWX HTTP client
 * @param templateId   - The job template ID to attach the credential to
 * @param credentialId - The credential ID to attach
 * @param abortSignal  - Optional abort signal propagated to the HTTP client
 * @returns The raw AWX API response body (typically the credential object)
 * @throws Error if the AWX API returns an unexpected error
 */
export async function attachCredential(
  client: AwxClient,
  templateId: number,
  credentialId: number,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  // ── Build request body ────────────────────────────────────────
  const body: Record<string, unknown> = {
    id: credentialId,
  };

  // ── Call AWX attach credential API ────────────────────────────
  const response = await client.request(
    "awx-attach-credential",
    `/api/v2/job_templates/${templateId}/credentials/`,
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
    throw new Error(`AWX attach credential failed: HTTP ${response.status}: ${detail}`);
  }

  // ── Return raw AWX response body ──────────────────────────────
  return responseBody ?? {};
}
