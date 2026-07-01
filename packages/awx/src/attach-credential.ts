/**
 * attach-credential.ts — Thin proxy for POST /api/v2/job_templates/{id}/credentials/
 *
 * Attaches a credential to a job template by credential ID.
 * Follows the same pattern as launch.ts for consistency.
 */
import type { AwxClient } from "./client.js";

/**
 * Credential attachment response from the AWX API.
 * The API typically returns the credential summary object.
 */
export interface AttachCredentialResult {
  id: number;
  name?: string;
  credential_type?: number;
  /** Any additional fields returned by AWX */
  [key: string]: unknown;
}

/**
 * Attach a credential to a job template by ID.
 *
 * Posts to POST /api/v2/job_templates/{templateId}/credentials/
 * with the credential ID in the request body.
 *
 * @param client       - The AWX HTTP client
 * @param templateId   - The job template ID
 * @param credentialId - The credential ID to attach
 * @param abortSignal  - Optional abort signal propagated to the HTTP client
 * @returns The parsed JSON response body from AWX
 * @throws Error if the AWX API returns an unexpected error
 */
export async function attachCredential(
  client: AwxClient,
  templateId: number,
  credentialId: number,
  abortSignal?: AbortSignal,
): Promise<AttachCredentialResult> {
  // ── Build request body ────────────────────────────────────────
  const body: Record<string, unknown> = {
    id: credentialId,
  };

  // ── Call AWX attach-credential API ────────────────────────────
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

  // ── Parse response body (text-first to handle non-JSON) ──────────
  const text = await response.text();
  let responseBody: AttachCredentialResult | undefined;
  try {
    responseBody = text
      ? (JSON.parse(text) as AttachCredentialResult)
      : undefined;
  } catch {
    responseBody = undefined;
  }

  // ── Handle error responses ────────────────────────────────────
  if (!response.ok) {
    const detail =
      typeof responseBody === "object" && responseBody && "detail" in responseBody
        ? String((responseBody as { detail: unknown }).detail)
        : text || response.statusText;
    throw new Error(`AWX attach-credential failed: HTTP ${response.status}: ${detail}`);
  }

  // ── Return raw AWX response body ──────────────────────────────
  return responseBody ?? ({} as AttachCredentialResult);
}
