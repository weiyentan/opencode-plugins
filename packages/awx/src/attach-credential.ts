/**
 * attach-credential.ts — Attach credentials to an AWX job template.
 *
 * Calls POST /api/v2/job_templates/{id}/credentials/ to associate
 * one or more credentials with a job template. Returns a
 * ResourceMutationOutput-like response confirming the association.
 *
 * No transforms, no validation beyond AWX API — just POST the
 * credential IDs and return the response.
 */
import type { AwxClient } from "./client.js";

/**
 * Attach one or more credentials to an AWX job template.
 *
 * Calls POST /api/v2/job_templates/{templateId}/credentials/ with
 * the credential IDs in the request body. The AWX API expects:
 *
 * ```json
 * { "id": [credential_id_1, credential_id_2, ...] }
 * ```
 *
 * @param client        - The AWX HTTP client
 * @param templateId    - The job template ID to attach credentials to
 * @param credentialIds - Array of credential IDs to attach
 * @param abortSignal   - Optional abort signal propagated to the HTTP client
 * @returns A ResourceMutationOutput-like response indicating success
 * @throws Error if the AWX API returns an unexpected error
 */
export async function attachCredentials(
  client: AwxClient,
  templateId: number,
  credentialIds: number[],
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  // ── Build request body ────────────────────────────────────────
  const body = JSON.stringify({ id: credentialIds });

  // ── Call AWX credentials attachment API ───────────────────────
  const response = await client.request(
    "awx-attach-credential",
    `/api/v2/job_templates/${templateId}/credentials/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    },
    abortSignal,
  );

  // ── Parse response body (text-first to handle non-JSON) ──────────
  const text = await response.text();
  let responseBody: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = text ? JSON.parse(text) : undefined;
    responseBody = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    responseBody = undefined;
  }

  // ── Handle error responses ────────────────────────────────────
  if (!response.ok) {
    const detailRaw =
      responseBody && typeof responseBody === "object" && "detail" in responseBody
        ? (responseBody as { detail: unknown }).detail
        : undefined;
    const detail =
      typeof detailRaw === "string"
        ? detailRaw
        : detailRaw
          ? JSON.stringify(detailRaw)
          : text || response.statusText;
    throw new Error(`AWX attach credential failed: HTTP ${response.status}: ${detail}`);
  }

  // ── Return raw AWX response body ──────────────────────────────
  return responseBody ?? {};
}
