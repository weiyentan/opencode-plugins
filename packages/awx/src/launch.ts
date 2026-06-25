/**
 * launch.ts — Thin proxy that passes raw extra_vars to the AWX launch API.
 *
 * No transforms, no validation — just POST raw extra_vars to
 * /api/v2/job_templates/{id}/launch/ and return the raw AWX response body.
 */
import type { AwxClient } from "./client.js";

/**
 * Launch an AWX job template by ID.
 *
 * Passes raw extra_vars as-is to POST /api/v2/job_templates/{id}/launch/
 * and returns the parsed JSON response body from AWX verbatim.
 *
 * @param client     - The AWX HTTP client
 * @param templateId - The job template ID to launch
 * @param extraVars  - Raw extra vars (may be undefined; if so, POST an empty object)
 * @param abortSignal - Optional abort signal propagated to the HTTP client
 * @returns The raw AWX API response body
 * @throws Error if the AWX API returns an unexpected error
 */
export async function launchJob(
  client: AwxClient,
  templateId: number,
  extraVars: Record<string, unknown> | undefined,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  // ── Build request body ────────────────────────────────────────
  const body: Record<string, unknown> = {};

  // Only include extra_vars in the request body if there are any
  const hasExtraVars = extraVars && Object.keys(extraVars).length > 0;
  if (hasExtraVars) {
    body.extra_vars = extraVars;
  }

  // ── Call AWX launch API ───────────────────────────────────────
  const response = await client.request(
    "awx-launch-job",
    `/api/v2/job_templates/${templateId}/launch/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    abortSignal,
  );

  // ── Parse response body (text-first to handle non-JSON) ──────────
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
    throw new Error(`AWX launch failed: HTTP ${response.status}: ${detail}`);
  }

  // ── Return raw AWX response body ──────────────────────────────
  return responseBody ?? {};
}
