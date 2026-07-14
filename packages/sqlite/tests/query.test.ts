/**
 * Unit tests for the sqlite_query tool.
 *
 * Verifies:
 *   1. Valid SELECT returns results with correct format
 *   2. Valid PRAGMA works
 *   3. Valid EXPLAIN works
 *   4. INSERT is rejected with clear error
 *   5. UPDATE is rejected with clear error
 *   6. DELETE is rejected with clear error
 *   7. DROP is rejected with clear error
 *   8. ALTER is rejected with clear error
 *   9. CREATE is rejected with clear error
 *  10. Malformed SQL returns clear error
 *  11. Empty results return "no rows" message
 *  12. Output format has correct metadata shape
 *  13. Multi-statement input is rejected
 *  14. WITH statement (CTE) is accepted
 */

import { describe, it, expect, vi } from "vitest";
import { createQueryTool } from "../src/tools/query.js";
import type { Database } from "better-sqlite3";

/* ── Mock helpers ───────────────────────────────────────────────── */

function mockDbWithRows(rows: Record<string, unknown>[]): Database {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue(rows),
    }),
  } as unknown as Database;
}

function mockDbThatThrows(errorMessage: string): Database {
  return {
    prepare: vi.fn().mockImplementation(() => {
      throw new Error(errorMessage);
    }),
  } as unknown as Database;
}

/** Creates a mock database that never gets its prepare() called (for validation-rejection tests). */
function mockDbUnused(): Database {
  return {
    prepare: vi.fn().mockReturnValue({
      all: vi.fn().mockReturnValue([]),
    }),
  } as unknown as Database;
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe("sqlite_query", () => {
  /* ─── Valid read-only statements ─────────────────────────────── */

  describe("valid SELECT", () => {
    it("returns results with correct markdown format", async () => {
      const db = mockDbWithRows([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT id, name FROM users" });

      expect(result.output).toContain("| id | name |");
      expect(result.output).toContain("| --- | --- |");
      expect(result.output).toContain("| 1 | Alice |");
      expect(result.output).toContain("| 2 | Bob |");
      expect(result.output).toContain("*Returned 2 row(s) in");
    });

    it("returns correct metadata", async () => {
      const db = mockDbWithRows([
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT id, name FROM users" });

      expect(result.metadata).toBeDefined();
      expect(result.metadata.columns).toEqual(["id", "name"]);
      expect(result.metadata.rows).toEqual([
        [1, "Alice"],
        [2, "Bob"],
      ]);
      expect(result.metadata.rowCount).toBe(2);
      expect(typeof result.metadata.executionTimeMs).toBe("number");
      expect(result.metadata.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("handles NULL values in output", async () => {
      const db = mockDbWithRows([
        { id: 1, name: null },
        { id: 2, name: "Bob" },
      ]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT id, name FROM users" });

      expect(result.output).toContain("| 1 | NULL |");
      expect(result.output).toContain("| 2 | Bob |");
      expect(result.metadata.rows).toEqual([
        [1, null],
        [2, "Bob"],
      ]);
    });
  });

  describe("valid PRAGMA", () => {
    it("executes PRAGMA statement successfully", async () => {
      const db = mockDbWithRows([{ table_info: "users" }]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "PRAGMA table_info('users')" });

      expect(result.output).toContain("| table_info |");
      expect(result.output).toContain("*Returned 1 row(s) in");
      expect(result.metadata.rowCount).toBe(1);
    });
  });

  describe("valid EXPLAIN", () => {
    it("executes EXPLAIN statement successfully", async () => {
      const db = mockDbWithRows([
        { addr: 0, opcode: "Init", p1: 0, p2: 1, p3: 0 },
      ]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "EXPLAIN SELECT 1" });

      expect(result.output).toContain("| addr |");
      expect(result.output).toContain("*Returned 1 row(s) in");
      expect(result.metadata.rowCount).toBe(1);
    });

    it("executes EXPLAIN QUERY PLAN", async () => {
      const db = mockDbWithRows([
        { id: 0, parent: 0, notused: 0, detail: "SCAN users" },
      ]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "EXPLAIN QUERY PLAN SELECT * FROM users" });

      expect(result.output).toContain("| id |");
      expect(result.metadata.rowCount).toBe(1);
    });
  });

  describe("valid WITH (CTE)", () => {
    it("executes WITH ... SELECT statement", async () => {
      const db = mockDbWithRows([{ cnt: 5 }]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "WITH cte AS (SELECT 1 AS n) SELECT count(*) as cnt FROM cte" });

      expect(result.output).toContain("| cnt |");
      expect(result.output).toContain("*Returned 1 row(s) in");
    });
  });

  describe("trailing semicolon handling", () => {
    it("accepts SELECT with trailing semicolon", async () => {
      const db = mockDbWithRows([{ cnt: 1 }]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT 1 AS cnt;" });

      expect(result.output).toContain("| cnt |");
      expect(result.metadata.rowCount).toBe(1);
    });

    it("accepts SELECT with trailing semicolon and whitespace", async () => {
      const db = mockDbWithRows([{ cnt: 1 }]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT 1 AS cnt;   " });

      expect(result.output).toContain("| cnt |");
      expect(result.metadata.rowCount).toBe(1);
    });
  });

  /* ─── Empty results ──────────────────────────────────────────── */

  describe("empty results", () => {
    it("returns 'no rows' message", async () => {
      const db = mockDbWithRows([]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT * FROM empty_table" });

      expect(result.output).toContain("Query returned no rows");
      expect(result.output).toMatch(/\(\d+(\.\d+)?ms\)/);
    });

    it("returns empty metadata for empty results", async () => {
      const db = mockDbWithRows([]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT * FROM empty_table" });

      expect(result.metadata.columns).toEqual([]);
      expect(result.metadata.rows).toEqual([]);
      expect(result.metadata.rowCount).toBe(0);
      expect(typeof result.metadata.executionTimeMs).toBe("number");
    });
  });

  /* ─── Rejected write statements ──────────────────────────────── */

  describe("rejected write statements", () => {
    /** Reusable helper: asserts that a write statement is rejected with a clear error. */
    async function assertRejected(sql: string) {
      const db = mockDbUnused();
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql });

      expect(result.output).toContain("Only read-only SQL queries are allowed.");
      expect(result.metadata.columns).toEqual([]);
      expect(result.metadata.rows).toEqual([]);
      expect(result.metadata.rowCount).toBe(0);
      // prepare() should never have been called for rejected statements
      expect(db.prepare).not.toHaveBeenCalled();
    }

    it("rejects INSERT", async () => {
      await assertRejected("INSERT INTO users (name) VALUES ('test')");
    });

    it("rejects UPDATE", async () => {
      await assertRejected("UPDATE users SET name = 'test' WHERE id = 1");
    });

    it("rejects DELETE", async () => {
      await assertRejected("DELETE FROM users WHERE id = 1");
    });

    it("rejects DROP", async () => {
      await assertRejected("DROP TABLE users");
    });

    it("rejects ALTER", async () => {
      await assertRejected("ALTER TABLE users ADD COLUMN email TEXT");
    });

    it("rejects CREATE", async () => {
      await assertRejected("CREATE TABLE new_table (id INTEGER)");
    });
  });

  /* ─── Multi-statement rejection ──────────────────────────────── */

  describe("multi-statement rejection", () => {
    it("rejects statements with semicolons in the middle", async () => {
      const db = mockDbUnused();
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT 1; SELECT 2" });

      expect(result.output).toContain("Multi-statement input is not allowed.");
      expect(db.prepare).not.toHaveBeenCalled();
    });

    it("rejects SELECT with embedded semicolons", async () => {
      const db = mockDbUnused();
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT 1; DROP TABLE users;--" });

      expect(result.output).toContain("Multi-statement input is not allowed.");
      expect(db.prepare).not.toHaveBeenCalled();
    });
  });

  /* ─── Malformed SQL ──────────────────────────────────────────── */

  describe("malformed SQL", () => {
    it("returns clear error message for syntax errors", async () => {
      const db = mockDbThatThrows("near \"FRUM\": syntax error");
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT * FRUM users" });

      expect(result.output).toContain("SQL error:");
      expect(result.output).toContain("syntax error");
      expect(result.metadata.columns).toEqual([]);
      expect(result.metadata.rows).toEqual([]);
      expect(result.metadata.rowCount).toBe(0);
      expect(result.metadata.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("returns clear error message for missing table", async () => {
      const db = mockDbThatThrows("no such table: missing_table");
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "SELECT * FROM missing_table" });

      expect(result.output).toContain("SQL error:");
      expect(result.output).toContain("no such table");
    });
  });

  /* ─── Case insensitivity ─────────────────────────────────────── */

  describe("case insensitivity", () => {
    it("accepts lowercase select", async () => {
      const db = mockDbWithRows([{ cnt: 1 }]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "select 1 as cnt" });

      expect(result.output).toContain("| cnt |");
    });

    it("accepts mixed-case SELECT", async () => {
      const db = mockDbWithRows([{ cnt: 1 }]);
      const tools = createQueryTool(() => db);
      const result = await tools.sqlite_query.execute({ sql: "Select 1 as cnt" });

      expect(result.output).toContain("| cnt |");
    });
  });
});
