/**
 * Unit tests for the sqlite_schema tool.
 *
 * Verifies:
 *   1. Returns column info for a known table
 *   2. Non-existent table returns a clear error
 *   3. Output format is correct markdown table with structured metadata
 *   4. Column metadata has correct fields (name, type, notNull, defaultValue, primaryKey)
 *   5. Error propagation from getDb
 */

import { describe, it, expect, vi } from "vitest";
import { createSchemaTool } from "../src/tools/schema.js";
import type { Database as SqlJsDatabase } from "sql.js";

/* ── Mock helpers ───────────────────────────────────────────────── */

interface PragmaRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function mockDbWithTable(exists: boolean, columns?: PragmaRow[]): SqlJsDatabase {
  const pragmaValues = (columns ?? []).map(c => [
    c.cid, c.name, c.type, c.notnull, c.dflt_value, c.pk,
  ]);

  // Simulate sql.js exec output: { columns: string[], values: any[][] }[]
  return {
    exec: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("sqlite_master")) {
        // Table existence check
        return exists
          ? [{ columns: ["name"], values: [["test_table"]] }]
          : [];
      }
      if (sql.includes("PRAGMA")) {
        // PRAGMA table_info
        return [
          {
            columns: ["cid", "name", "type", "notnull", "dflt_value", "pk"],
            values: pragmaValues,
          },
        ];
      }
      return [];
    }),
  } as unknown as SqlJsDatabase;
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe("sqlite_schema", () => {
  describe("existing table", () => {
    it("returns column info for a known table", async () => {
      const columns: PragmaRow[] = [
        { cid: 0, name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: "name", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        { cid: 2, name: "created_at", type: "DATETIME", notnull: 0, dflt_value: "CURRENT_TIMESTAMP", pk: 0 },
      ];
      const db = mockDbWithTable(true, columns);
      const tools = createSchemaTool(async () => db);
      const result = await tools.sqlite_schema.execute({ table: "test_table" });

      expect(db.exec).toHaveBeenCalledWith(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
      );
      expect(db.exec).toHaveBeenCalledWith('PRAGMA table_info("test_table")');
      expect(result.metadata).toBeDefined();
    });

    it("returns correct column metadata fields", async () => {
      const columns: PragmaRow[] = [
        { cid: 0, name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: "email", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
        { cid: 2, name: "score", type: "REAL", notnull: 0, dflt_value: "0.0", pk: 0 },
      ];
      const db = mockDbWithTable(true, columns);
      const tools = createSchemaTool(async () => db);
      const result = await tools.sqlite_schema.execute({ table: "test_table" });

      expect(result.metadata).toEqual({
        columns: [
          { name: "id", type: "INTEGER", notNull: true, defaultValue: null, primaryKey: true },
          { name: "email", type: "TEXT", notNull: true, defaultValue: null, primaryKey: false },
          { name: "score", type: "REAL", notNull: false, defaultValue: "0.0", primaryKey: false },
        ],
      });
    });

    it("outputs a markdown table with column info", async () => {
      const columns: PragmaRow[] = [
        { cid: 0, name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: "label", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      ];
      const db = mockDbWithTable(true, columns);
      const tools = createSchemaTool(async () => db);
      const result = await tools.sqlite_schema.execute({ table: "test_table" });

      expect(result.output).toContain("| # | Column | Type | Nullable | Default | PK |");
      expect(result.output).toContain("`id`");
      expect(result.output).toContain("`label`");
      expect(result.output).toContain("*2 column(s) in table `test_table`*");
    });

    it("shows primary key and not-null indicators correctly", async () => {
      const columns: PragmaRow[] = [
        { cid: 0, name: "pk_col", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: "nullable_col", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
      ];
      const db = mockDbWithTable(true, columns);
      const tools = createSchemaTool(async () => db);
      const result = await tools.sqlite_schema.execute({ table: "test_table" });

      expect(result.output).toContain("❌ No"); // notNull column
      expect(result.output).toContain("✅ Yes"); // nullable column
      expect(result.output).toMatch(/✅.*\|/); // PK indicator
    });

    it("handles table with no columns gracefully", async () => {
      const db = mockDbWithTable(true, []);
      const tools = createSchemaTool(async () => db);
      const result = await tools.sqlite_schema.execute({ table: "empty_table" });

      expect(result.output).toContain("*0 column(s) in table `empty_table`*");
      expect(result.metadata).toEqual({ columns: [] });
    });
  });

  describe("non-existent table", () => {
    it("returns a clear error message", async () => {
      const db = mockDbWithTable(false);
      const tools = createSchemaTool(async () => db);
      const result = await tools.sqlite_schema.execute({ table: "ghost" });

      expect(result.output).toBe('Table "ghost" not found in the database.');
    });

    it("returns empty columns array in metadata", async () => {
      const db = mockDbWithTable(false);
      const tools = createSchemaTool(async () => db);
      const result = await tools.sqlite_schema.execute({ table: "ghost" });

      expect(result.metadata).toEqual({ columns: [] });
    });
  });

  describe("edge cases", () => {
    it("propagates errors from getDb", async () => {
      const tools = createSchemaTool(async () => {
        throw new Error("connection failed");
      });

      await expect(
        tools.sqlite_schema.execute({ table: "any" }),
      ).rejects.toThrow("connection failed");
    });
  });
});
