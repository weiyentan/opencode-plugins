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
import type { Database } from "better-sqlite3";

/* ── Mock helpers ───────────────────────────────────────────────── */

interface MockStatement {
  get: ReturnType<typeof vi.fn>;
}

interface PragmaRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function mockDbWithTable(exists: boolean, columns?: PragmaRow[]): Database {
  return {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(exists ? { name: "test_table" } : undefined),
    }),
    pragma: vi.fn().mockReturnValue(columns ?? []),
  } as unknown as Database;
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
      const tools = createSchemaTool(() => db);
      const result = await tools.sqlite_schema.execute({ table: "test_table" });

      expect(db.prepare).toHaveBeenCalledWith(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
      );
      expect(db.pragma).toHaveBeenCalledWith('table_info("test_table")');
      expect(result.metadata).toBeDefined();
    });

    it("returns correct column metadata fields", async () => {
      const columns: PragmaRow[] = [
        { cid: 0, name: "id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: "email", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
        { cid: 2, name: "score", type: "REAL", notnull: 0, dflt_value: "0.0", pk: 0 },
      ];
      const db = mockDbWithTable(true, columns);
      const tools = createSchemaTool(() => db);
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
      const tools = createSchemaTool(() => db);
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
      const tools = createSchemaTool(() => db);
      const result = await tools.sqlite_schema.execute({ table: "test_table" });

      expect(result.output).toContain("❌ No"); // notNull column
      expect(result.output).toContain("✅ Yes"); // nullable column
      expect(result.output).toMatch(/✅.*\|/); // PK indicator
    });

    it("handles table with no columns gracefully", async () => {
      const db = mockDbWithTable(true, []);
      const tools = createSchemaTool(() => db);
      const result = await tools.sqlite_schema.execute({ table: "empty_table" });

      expect(result.output).toContain("*0 column(s) in table `empty_table`*");
      expect(result.metadata).toEqual({ columns: [] });
    });
  });

  describe("non-existent table", () => {
    it("returns a clear error message", async () => {
      const db = mockDbWithTable(false);
      const tools = createSchemaTool(() => db);
      const result = await tools.sqlite_schema.execute({ table: "ghost" });

      expect(result.output).toBe('Table "ghost" not found in the database.');
    });

    it("returns empty columns array in metadata", async () => {
      const db = mockDbWithTable(false);
      const tools = createSchemaTool(() => db);
      const result = await tools.sqlite_schema.execute({ table: "ghost" });

      expect(result.metadata).toEqual({ columns: [] });
    });
  });

  describe("edge cases", () => {
    it("propagates errors from getDb", async () => {
      const tools = createSchemaTool(() => {
        throw new Error("connection failed");
      });

      await expect(
        tools.sqlite_schema.execute({ table: "any" }),
      ).rejects.toThrow("connection failed");
    });
  });
});
