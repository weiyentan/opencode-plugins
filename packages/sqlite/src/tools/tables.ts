import { tool } from "@opencode-ai/plugin";
import type { Database as SqlJsDatabase } from "sql.js";

export function createTablesTool(getDb: () => Promise<SqlJsDatabase>) {
  return {
    sqlite_tables: tool({
      description: "List all tables in the connected SQLite database",
      args: {} as Record<string, never>,
      async execute(_args: Record<string, never>) {
        const database = await getDb();
        const result = database.exec(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        );
        const rows = (result[0]?.values ?? []).map(v => ({ name: v[0] as string }));

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
