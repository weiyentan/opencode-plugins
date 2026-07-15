import { tool } from "@opencode-ai/plugin";
import type { Database as SqlJsDatabase } from "sql.js";

const READ_ONLY_PREFIXES = ["SELECT", "PRAGMA", "EXPLAIN", "WITH"];

function validateReadOnly(sql: string): void {
  const trimmed = sql.trim();

  // Strip content inside single-quoted strings so we don't false-positive on
  // semicolons that appear inside string literals (e.g. WHERE name = 'O;Brien')
  const stripped = trimmed.replace(/'[^']*'/g, "");

  // Reject multi-statement input (semicolons appearing before the end)
  if (stripped.includes(";") && !stripped.endsWith(";")) {
    throw new Error(
      `Multi-statement input is not allowed. Please provide a single SQL statement.\n` +
      `Only read-only queries are supported: SELECT, PRAGMA, EXPLAIN, WITH`
    );
  }
  // Handle trailing semicolon
  const normalized = trimmed.replace(/;\s*$/, "").trim();
  const strippedNormalized = normalized.replace(/'[^']*'/g, "");
  if (strippedNormalized.includes(";")) {
    throw new Error(
      `Multi-statement input is not allowed. Please provide a single SQL statement.\n` +
      `Only read-only queries are supported: SELECT, PRAGMA, EXPLAIN, WITH`
    );
  }

  const upper = normalized.toUpperCase();
  const isReadOnly = READ_ONLY_PREFIXES.some(prefix => upper.startsWith(prefix));

  if (!isReadOnly) {
    throw new Error(
      `Only read-only SQL queries are allowed.\n` +
      `Statement must start with one of: ${READ_ONLY_PREFIXES.join(", ")}\n` +
      `Write statements (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, etc.) are rejected.`
    );
  }
}

export function createQueryTool(getDb: () => Promise<SqlJsDatabase>) {
  return {
    sqlite_query: tool({
      description: "Execute a read-only SQL query against the SQLite database",
      args: {
        sql: tool.schema.string().describe("The read-only SQL query to execute (SELECT, PRAGMA, EXPLAIN, or WITH)"),
      },
      async execute(args) {
        // Validate the SQL is read-only
        try {
          validateReadOnly(args.sql);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: message,
            metadata: { columns: [], rows: [], rowCount: 0, executionTimeMs: 0 },
          };
        }

        const database = await getDb();
        const startTime = performance.now();

        try {
          const result = database.exec(args.sql);
          const endTime = performance.now();
          const executionTimeMs = Math.round((endTime - startTime) * 100) / 100;

          // exec returns [{columns: string[], values: any[][]}]
          const columns: string[] = result[0]?.columns ?? [];
          const values: any[][] = result[0]?.values ?? [];

          if (values.length === 0) {
            return {
              output: `Query returned no rows (${executionTimeMs}ms)`,
              metadata: { columns: [], rows: [], rowCount: 0, executionTimeMs },
            };
          }

          // Build markdown table
          const header = `| ${columns.join(" | ")} |`;
          const separator = `| ${columns.map(() => "---").join(" | ")} |`;
          const body = values.map(row =>
            `| ${columns.map((_col, i) => {
              const val = row[i];
              if (val === null || val === undefined) return "NULL";
              return String(val);
            }).join(" | ")} |`
          ).join("\n");

          const output = `${header}\n${separator}\n${body}\n\n*Returned ${values.length} row(s) in ${executionTimeMs}ms*`;

          return {
            output,
            metadata: {
              columns,
              rows: values.map(r => columns.map((_, i) => r[i] ?? null)),
              rowCount: values.length,
              executionTimeMs,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            output: `SQL error: ${message}`,
            metadata: { columns: [], rows: [], rowCount: 0, executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100 },
          };
        }
      },
    }),
  };
}
