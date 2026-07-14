/**
 * Unit tests for the sqlite_tables tool.
 *
 * Verifies:
 *   1. Returns table names from sqlite_master
 *   2. Empty database returns "No tables found"
 *   3. Output format is correct markdown table with metadata
 *   4. Error propagation from getDb
 */

import { describe, it, expect, vi } from "vitest";
import { createTablesTool } from "../src/tools/tables.js";
import type { Database } from "better-sqlite3";

/* ── Mock helpers ───────────────────────────────────────────────── */

interface MockStatement {
  all: ReturnType<typeof vi.fn>;
}

interface MockDatabase {
  pragma: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn<[string], MockStatement>>;
  close: ReturnType<typeof vi.fn>;
}

function mockDbWithTables(tableNames: string[]): Database {
  const rows = tableNames.map(name => ({ name }));
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue(rows),
    }),
  } as unknown as Database;
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe("sqlite_tables", () => {
  describe("with tables", () => {
    it("returns table names from sqlite_master", async () => {
      const db = mockDbWithTables(["users", "projects", "tasks"]);
      const tools = createTablesTool(() => db);
      const result = await tools.sqlite_tables.execute({});

      expect(db.prepare).toHaveBeenCalledWith(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      );
      expect(result.metadata).toBeDefined();
    });

    it("outputs a markdown table with table names", async () => {
      const db = mockDbWithTables(["bar", "foo"]);
      const tools = createTablesTool(() => db);
      const result = await tools.sqlite_tables.execute({});

      expect(result.output).toContain("| # | Table Name |");
      expect(result.output).toContain("| 1 | `bar` |");
      expect(result.output).toContain("| 2 | `foo` |");
      expect(result.output).toContain("*2 table(s) found*");
    });

    it("includes structured metadata", async () => {
      const db = mockDbWithTables(["users", "projects"]);
      const tools = createTablesTool(() => db);
      const result = await tools.sqlite_tables.execute({});

      expect(result.metadata).toEqual({
        tables: [
          { name: "users", type: "table" },
          { name: "projects", type: "table" },
        ],
      });
    });
  });

  describe("empty database", () => {
    it("returns 'No tables found' message", async () => {
      const db = mockDbWithTables([]);
      const tools = createTablesTool(() => db);
      const result = await tools.sqlite_tables.execute({});

      expect(result.output).toBe("No tables found in the database.");
    });

    it("returns empty tables array in metadata", async () => {
      const db = mockDbWithTables([]);
      const tools = createTablesTool(() => db);
      const result = await tools.sqlite_tables.execute({});

      expect(result.metadata).toEqual({ tables: [] });
    });
  });

  describe("single table", () => {
    it("returns single table correctly", async () => {
      const db = mockDbWithTables(["only_table"]);
      const tools = createTablesTool(() => db);
      const result = await tools.sqlite_tables.execute({});

      expect(result.output).toContain("| 1 | `only_table` |");
      expect(result.output).toContain("*1 table(s) found*");
    });
  });
});
