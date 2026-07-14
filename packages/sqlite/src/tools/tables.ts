import { tool } from "@opencode-ai/plugin";
import type { Database } from "better-sqlite3";

export function createTablesTool(getDb: () => Database) {
  return {
    sqlite_tables: tool({
      description: "List all tables in the connected SQLite database",
      args: {} as Record<string, never>,
      async execute(_args: Record<string, never>) {
        const database = getDb();
        const rows = database.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all() as { name: string }[];

        if (rows.length === 0) {
          return {
            output: "No tables found in the database.",
            metadata: { tables: [] },
          };
        }

        // Build markdown table
        const header = "| # | Table Name |\n|---|------------|";
        const body = rows.map((r, i) => `| ${i + 1} | \`${r.name}\` |`).join("\n");
        const output = `${header}\n${body}\n\n*${rows.length} table(s) found*`;

        return {
          output,
          metadata: {
            tables: rows.map(r => ({ name: r.name, type: "table" })),
          },
        };
      },
    }),
  };
}
