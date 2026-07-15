import { tool } from "@opencode-ai/plugin";
import type { Database as SqlJsDatabase } from "sql.js";

interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
}

export function createSchemaTool(getDb: () => Promise<SqlJsDatabase>) {
  return {
    sqlite_schema: tool({
      description:
        "Get the schema (column info) for a specific table in the SQLite database",
      args: {
        table: tool.schema.string().describe("Name of the table to inspect"),
      },
      async execute(args: { table: string }) {
        const database = await getDb();

        // Validate that the table exists — escape single quotes for SQL injection prevention
        const escapedTable = args.table.replace(/'/g, "''");
        const tableCheck = database.exec(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${escapedTable}'`,
        );
        const tableExists = (tableCheck[0]?.values?.length ?? 0) > 0;

        if (!tableExists) {
          return {
            output: `Table "${args.table}" not found in the database.`,
            metadata: { columns: [] },
          };
        }

        // Escape double quotes in table name to prevent PRAGMA injection
        const safeTable = args.table.replace(/"/g, '""');
        const pragmaResult = database.exec(
          `PRAGMA table_info("${safeTable}")`,
        );
        const pragmaColumns = pragmaResult[0]?.values ?? [];

        const columns: Array<{
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }> = pragmaColumns.map((v) => ({
          cid: v[0] as number,
          name: v[1] as string,
          type: v[2] as string,
          notnull: v[3] as number,
          dflt_value: (v[4] as string | null) ?? null,
          pk: v[5] as number,
        }));

        const columnInfo: ColumnInfo[] = columns.map((col) => ({
          name: col.name,
          type: col.type,
          notNull: col.notnull === 1,
          defaultValue: col.dflt_value ?? null,
          primaryKey: col.pk === 1,
        }));

        // Build markdown table
        const header =
          "| # | Column | Type | Nullable | Default | PK |\n|---|--------|------|----------|---------|-----|";
        const body = columnInfo
          .map(
            (col, i) =>
              `| ${i + 1} | \`${col.name}\` | \`${col.type}\` | ${col.notNull ? "❌ No" : "✅ Yes"} | ${col.defaultValue !== null ? `\`${col.defaultValue}\`` : "—"} | ${col.primaryKey ? "✅" : ""} |`,
          )
          .join("\n");
        const output = `${header}\n${body}\n\n*${columnInfo.length} column(s) in table \`${args.table}\`*`;

        return {
          output,
          metadata: { columns: columnInfo },
        };
      },
    }),
  };
}
