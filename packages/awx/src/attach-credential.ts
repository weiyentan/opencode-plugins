/**
 * attach-credential.ts — Thin proxy for POST /api/v2/job_templates/{id}/credentials/
 *
 * Attaches a credential to a job template in AWX by making a POST request
 * to the AWX API credentials endpoint. No transforms, no validation beyond
 * the AWX API's own checks — just forward the credential ID.
 *
 * Multi-credential support: when credentialId is an array, each credential
 * is attached via an individual POST request (not a single array payload),
 * matching the AWX API's expected request shape.
 */
import type { AwxClient } from "./client.js";

/**
 * Make a single POST to attach one credential to a job template.
 *
 * @returns The raw AWX API response body for the single attachment.
 * @throws Error if the AWX API returns an unexpected error response.
 */
async function attachSingle(
  client: AwxClient,
  templateId: number,
  credentialId: number,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { id: credentialId };

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

/**
 * Attach one or more credentials to an AWX job template.
 *
 * For a single credential, makes one POST to
 * /api/v2/job_templates/{templateId}/credentials/ with body { "id": credentialId }.
 *
 * For multiple credentials, makes N individual POST requests (one per
 * credential ID), each with body { "id": <single_id> }, then collects
 * the results into a composite object { count: N, results: [...] }.
 * Partial failures throw with per-credential error detail.
 *
 * @param client       - The AWX HTTP client
 * @param templateId   - The job template ID to attach the credential(s) to
 * @param credentialId - A single credential ID or an array of credential IDs to attach
 * @param abortSignal  - Optional abort signal propagated to every individual HTTP request
 * @returns A composite object with `count` and `results` for multi-credential,
 *          or the raw AWX API response body for a single credential.
 * @throws Error with per-credential detail if any attachment fails.
 */
export async function attachCredential(
  client: AwxClient,
  templateId: number,
  credentialId: number | number[],
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  // ── Single credential — one POST, original behaviour ──────────
  if (!Array.isArray(credentialId)) {
    return attachSingle(client, templateId, credentialId, abortSignal);
  }

  // ── Multi-credential — N individual POSTs ─────────────────────
  const results: Record<string, unknown>[] = [];
  const failures: { id: number; error: string }[] = [];

  for (const id of credentialId) {
    try {
      const result = await attachSingle(client, templateId, id, abortSignal);
      results.push(result);
    } catch (err: unknown) {
      // Re-throw abort signals immediately — not a credential error
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      failures.push({ id, error: message });
    }
  }

  // ── Build composite result ────────────────────────────────────
  const composite: Record<string, unknown> = {
    count: results.length,
    results,
  };

  if (failures.length > 0) {
    const failureDescriptions = failures
      .map((f) => `credential ${f.id}: ${f.error}`)
      .join("; ");

    composite._errors = failures;

    throw new Error(
      failures.length === credentialId.length
        ? `Failed to attach credentials: ${failureDescriptions}`
        : `Partial failure attaching credentials: ${failureDescriptions}`,
    );
  }

  return composite;
}
