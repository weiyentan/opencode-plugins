import { tool } from "@opencode-ai/plugin";
import type { Database } from "better-sqlite3";

const READ_ONLY_PREFIXES = ["SELECT", "PRAGMA", "EXPLAIN", "WITH"];

function validateReadOnly(sql: string): void {
  const trimmed = sql.trim();

  // Reject multi-statement input (semicolons appearing before the end)
  if (trimmed.includes(";") && !trimmed.endsWith(";")) {
    throw new Error(
      `Multi-statement input is not allowed. Please provide a single SQL statement.\n` +
      `Only read-only queries are supported: SELECT, PRAGMA, EXPLAIN, WITH`
    );
  }
  // Handle trailing semicolon
  const normalized = trimmed.replace(/;\s*$/, "").trim();
  if (normalized.includes(";")) {
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

export function createQueryTool(getDb: () => Database) {
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

        const database = getDb();
        const startTime = performance.now();

        try {
          const stmt = database.prepare(args.sql);
          const rows = stmt.all() as Record<string, unknown>[];
          const endTime = performance.now();
          const executionTimeMs = Math.round((endTime - startTime) * 100) / 100;

          if (rows.length === 0) {
            return {
              output: `Query returned no rows (${executionTimeMs}ms)`,
              metadata: { columns: [], rows: [], rowCount: 0, executionTimeMs },
            };
          }

          const columns = Object.keys(rows[0]!);

          // Build markdown table
          const header = `| ${columns.join(" | ")} |`;
          const separator = `| ${columns.map(() => "---").join(" | ")} |`;
          const body = rows.map(row =>
            `| ${columns.map(col => {
              const val = row[col];
              if (val === null) return "NULL";
              return String(val);
            }).join(" | ")} |`
          ).join("\n");

          const output = `${header}\n${separator}\n${body}\n\n*Returned ${rows.length} row(s) in ${executionTimeMs}ms*`;

          return {
            output,
            metadata: {
              columns,
              rows: rows.map(r => columns.map(c => r[c] ?? null)),
              rowCount: rows.length,
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
