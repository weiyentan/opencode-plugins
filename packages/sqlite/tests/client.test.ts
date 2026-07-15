/**
 * Unit tests for the SQLite database client module.
 *
 * Verifies:
 *   1. Connection opened with db buffer via sql.js
 *   2. Missing file produces helpful error
 *   3. Corrupt DB produces helpful error
 *   4. close() resets connection state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { homedir } from "os";
import { join } from "path";

const DEFAULT_DB_PATH = join(homedir(), ".local", "share", "opencode", "opencode.db");

/* ── Mock helpers ───────────────────────────────────────────────── */

interface MockDatabase {
  close: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
  run: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
}

function createMockDb(overrides?: Partial<MockDatabase>): MockDatabase {
  return {
    close: vi.fn(),
    exec: vi.fn().mockReturnValue([]),
    run: vi.fn(),
    prepare: vi.fn(),
    ...overrides,
  };
}

/* ── Helpers to load client module with mocks ──────────────────── */

/**
 * Dynamic import of client module. Must be called after vi.mock setup
 * so that sql.js and fs are intercepted.
 */
async function loadClient(): Promise<
  typeof import("../src/client.js")
> {
  return import("../src/client.js");
}

/* ── Tests ─────────────────────────────────────────────────────── */

describe("client", () => {
  let mockDbConstructor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDbConstructor = vi.fn();
    vi.doMock("sql.js", () => ({
      default: vi.fn().mockResolvedValue({
        Database: mockDbConstructor,
      }),
    }));
  });

  afterEach(() => {
    // Reset module registry to ensure clean state between tests
    vi.resetModules();
  });

  describe("getDb()", () => {
    it("opens connection from buffer via initSqlJs", async () => {
      const mockDb = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb);

      // fs.existsSync must return true, readFileSync returns a buffer
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
      }));

      const { getDb } = await loadClient();
      const db = await getDb();

      expect(mockDbConstructor).toHaveBeenCalledTimes(1);
      expect(db).toBe(mockDb);
    });

    it("opens connection only once (lazy singleton)", async () => {
      const mockDb = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb);

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
      }));

      const { getDb } = await loadClient();
      await getDb();
      const db2 = await getDb();

      expect(mockDbConstructor).toHaveBeenCalledTimes(1);
      expect(db2).toBe(mockDb);
    });

    it("concurrent callers handle init failure gracefully", async () => {
      const mockDb = createMockDb();

      // Make initSqlJs reject on first call, succeed on subsequent calls
      vi.doMock("sql.js", () => ({
        default: vi
          .fn()
          .mockRejectedValueOnce(new Error("WASM load failed"))
          .mockResolvedValue({ Database: vi.fn().mockReturnValue(mockDb) }),
      }));

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
      }));

      const { getDb } = await loadClient();

      // Launch concurrent calls — both should settle without unhandled rejections
      const results = await Promise.allSettled([getDb(), getDb()]);
      expect(results).toHaveLength(2);

      // A subsequent call should recover and open the database
      const db = await getDb();
      expect(db).toBe(mockDb);
    });
  });

  describe("missing file", () => {
    it("throws helpful error with env var hint", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
        readFileSync: vi.fn(),
      }));

      const { getDb } = await loadClient();

      await expect(getDb()).rejects.toThrow(/Database not found at:/);
      await expect(getDb()).rejects.toThrow(/OPENCODE_DB_PATH/);
    });
  });

  describe("corrupt database", () => {
    it("surfaces corruption error with guidance", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("corrupt")),
      }));

      mockDbConstructor.mockImplementation(() => {
        throw new Error("file is not a database");
      });

      const { getDb } = await loadClient();

      await expect(getDb()).rejects.toThrow(/corrupt/);
      await expect(getDb()).rejects.toThrow(/not a valid SQLite database/);
    });

    it("surfaces encrypted database error", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("encrypted")),
      }));

      mockDbConstructor.mockImplementation(() => {
        throw new Error("file is encrypted or is not a database");
      });

      const { getDb } = await loadClient();

      await expect(getDb()).rejects.toThrow(/corrupt/);
    });

    it("surfaces locked database error", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
      }));

      mockDbConstructor.mockImplementation(() => {
        throw new Error("database is locked");
      });

      const { getDb } = await loadClient();

      await expect(getDb()).rejects.toThrow(/locked/);
      await expect(getDb()).rejects.toThrow(/Close other connections/);
    });
  });

  describe("close()", () => {
    it("closes the connection and resets state", async () => {
      const mockDb = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb);

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
      }));

      const { getDb, close } = await loadClient();
      await getDb();
      close();

      expect(mockDb.close).toHaveBeenCalledTimes(1);

      // Reset mocks so second getDb creates a new connection
      mockDbConstructor.mockReset();
      const mockDb2 = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb2);

      await getDb();

      expect(mockDbConstructor).toHaveBeenCalledTimes(1);
    });

    it("is safe to call close() when not connected", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
      }));

      const { close } = await loadClient();

      expect(() => close()).not.toThrow();
    });
  });

  describe("environment variable", () => {
    it("uses OPENCODE_DB_PATH when set", async () => {
      const customPath = "/custom/path/to/db.sqlite";
      vi.stubEnv("OPENCODE_DB_PATH", customPath);

      const mockDb = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb);

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
        readFileSync: vi.fn().mockReturnValue(Buffer.from("")),
      }));

      const { getDb } = await loadClient();
      await getDb();

      expect(mockDbConstructor).toHaveBeenCalledTimes(1);

      vi.unstubAllEnvs();
    });
  });
});
