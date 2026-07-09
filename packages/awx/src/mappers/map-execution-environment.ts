/**
 * map-execution-environment.ts — AWX Execution Environment Detail Mapper
 *
 * Pure function that transforms a raw AWX API execution environment response
 * (from GET /api/v2/execution_environments/<id>/) into the structured
 * ExecutionEnvironmentDetailOutput contract format.
 *
 * ## Key Transformations
 *
 * - **Organization name**: Extracts organization_name from AWX
 *   `summary_fields` rather than raw ID.
 * - **Image**: Preserves the container image URL.
 * - **Envelope**: Wraps output in `{ schema_version, resource_type, id, data }`.
 *
 * ## Usage
 *
 * ```ts
 * const response = await fetch(client, "GET", "/api/v2/execution_environments/1/");
 * const raw = await response.json();
 * const output = mapExecutionEnvironment(raw);
 * ```
 */
import type { ExecutionEnvironmentDetailOutput, ExecutionEnvironmentData } from "../contracts/execution-environment-detail.js";

/**
 * Raw AWX API execution environment response shape (the subset we care about).
 * The actual AWX response has many more fields; we access only these.
 */
interface RawAwxExecutionEnvironment {
  id: number;
  name: string;
  description: string;
  image: string;
  created: string;
  modified: string;
  summary_fields?: {
    organization?: { id?: number; name?: string } | null;
  };
}

/**
 * Transform a raw AWX API execution environment response into the
 * ExecutionEnvironmentDetailOutput v1.0 contract format.
 *
 * Pure function — no side effects, no HTTP calls.
 *
 * @param raw  Raw JSON-decoded AWX API response from /api/v2/execution_environments/<id>/
 * @returns    An ExecutionEnvironmentDetailOutput matching the v1.0 contract
 */
export function mapExecutionEnvironment(raw: unknown): ExecutionEnvironmentDetailOutput {
  if (!raw || typeof raw !== "object" || !("id" in (raw as Record<string, unknown>)) || (raw as Record<string, unknown>).id == null) {
    throw new Error(`mapExecutionEnvironment: raw response is missing or has no id — ${JSON.stringify(raw)}`);
  }
  const ee = raw as RawAwxExecutionEnvironment;
  const sf = ee.summary_fields ?? {};

  const data: ExecutionEnvironmentData = {
    id: ee.id ?? 0,
    name: ee.name ?? "",
    description: ee.description ?? "",
    image: ee.image ?? "",
    organization_name: sf.organization?.name ?? "",
    created: ee.created ?? "",
    modified: ee.modified ?? "",
  };

  return {
    schema_version: "1.0",
    resource_type: "execution-environment",
    id: ee.id ?? 0,
    data,
  };
}
