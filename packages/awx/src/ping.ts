/**
 * ping.ts — Thin proxy that passes the raw AWX ping response through.
 *
 * No validation, no transformation — just GET /api/v2/ping/ and return
 * the raw AWX response body verbatim.
 */
import type { AwxClient } from "./client.js";

/**
 * Fetch the AWX ping / health-check response.
 *
 * Calls GET /api/v2/ping/ and returns the parsed JSON response body
 * from AWX verbatim. The ping endpoint returns connectivity status,
 * AWX version, HA state, active node, install UUID, and instance info.
 *
 * @param client      - The AWX HTTP client
 * @param abortSignal - Optional abort signal propagated to the HTTP client
 * @returns The raw AWX API response body from /api/v2/ping/
 * @throws Error if the AWX API returns an unexpected error
 */
export async function fetchPing(
  client: AwxClient,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  // ── Call AWX ping API ──────────────────────────────────────────
  const response = await client.request(
    "awx-ping",
    "/api/v2/ping/",
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
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

  // ── Handle error responses ─────────────────────────────────────
  if (!response.ok) {
    const detail =
      typeof responseBody === "object" && responseBody && "detail" in responseBody
        ? String((responseBody as { detail: unknown }).detail)
        : text || response.statusText;
    throw new Error(`AWX ping failed: HTTP ${response.status}: ${detail}`);
  }

  // ── Return raw AWX response body ───────────────────────────────
  return responseBody ?? {};
}
