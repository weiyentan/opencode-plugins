/**
 * attach-credential.ts — Thin proxy for POST /api/v2/job_templates/{id}/credentials/
 *
 * Attaches a credential to a job template via the AWX API.
 * Sends the credential ID in the request body and returns the raw AWX response.
 */
import type { AwxClient } from "./client.js";

/**
 * Attach a credential to an AWX job template.
 *
 * Sends POST /api/v2/job_templates/{templateId}/credentials/ with the
 * credential ID in the request body and returns the raw AWX response.
 *
 * @param client        - The AWX HTTP client
 * @param templateId    - The job template ID to attach the credential to
 * @param credentialId  - The credential ID to attach
 * @param abortSignal   - Optional abort signal propagated to the HTTP client
 * @returns The raw AWX API response body
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

  // ── Call AWX API ──────────────────────────────────────────────
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

  // ── Parse response body (text-first to handle non-JSON) ──────
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
    throw new Error(
      `AWX attach credential failed: HTTP ${response.status}: ${detail}`,
    );
  }

  // ── Return raw AWX response body ──────────────────────────────
  return responseBody ?? {};
}
