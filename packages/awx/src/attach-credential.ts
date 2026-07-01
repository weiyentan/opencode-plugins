/**
 * attach-credential.ts — Thin proxy for attaching a credential to a job template.
 *
 * POST /api/v2/job_templates/{id}/credentials/ with credential ID in body.
 *
 * This tool eliminates the need for subagents to write inline PowerShell
 * scripts that expose AWX PAT tokens in plain text. Instead, the agent
 * calls this first-class tool which handles auth through the secure
 * middleware pipeline.
 */
import type { AwxClient } from "./client.js";

/**
 * Attach a credential to an AWX job template.
 *
 * Sends POST /api/v2/job_templates/{templateId}/credentials/ with
 * `{ id: credentialId }` body. Returns the raw AWX response.
 *
 * @param client       - The AWX HTTP client
 * @param templateId   - The job template ID to attach the credential to
 * @param credentialId - The credential ID to attach
 * @param abortSignal  - Optional abort signal for cancellation
 * @returns The raw AWX API response body
 * @throws Error if the AWX API returns an error response
 */
export async function attachCredential(
  client: AwxClient,
  templateId: number,
  credentialId: number,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await client.request(
    "awx-attach-credential",
    `/api/v2/job_templates/${templateId}/credentials/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: credentialId }),
    },
    abortSignal,
  );

  // Parse response body (text-first to handle non-JSON responses)
  const text = await response.text();
  let responseBody: Record<string, unknown> | undefined;
  try {
    responseBody = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
  } catch {
    responseBody = undefined;
  }

  // Handle error responses
  if (!response.ok) {
    const detail =
      typeof responseBody === "object" && responseBody && "detail" in responseBody
        ? String((responseBody as { detail: unknown }).detail)
        : text || response.statusText;
    throw new Error(`AWX credential attachment failed: HTTP ${response.status}: ${detail}`);
  }

  return responseBody ?? {};
}
