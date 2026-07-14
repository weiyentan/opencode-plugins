/**
 * Unit tests for the SQLite database client module.
 *
 * Verifies:
 *   1. Connection opened read-only with query_only pragma
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

interface MockStatement {
  all: ReturnType<typeof vi.fn>;
}

interface MockDatabase {
  pragma: ReturnType<typeof vi.fn>;
  prepare: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockDb(overrides?: Partial<MockDatabase>): MockDatabase {
  return {
    pragma: vi.fn(),
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]) } as MockStatement),
    close: vi.fn(),
    ...overrides,
  };
}

/* ── Helpers to load client module with mocks ──────────────────── */

/**
 * Dynamic import of client module. Must be called after vi.mock setup
 * so that better-sqlite3 and fs are intercepted.
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
    vi.doMock("better-sqlite3", () => ({
      default: mockDbConstructor,
    }));
  });

  afterEach(() => {
    // Reset module registry to ensure clean state between tests
    vi.resetModules();
  });

  describe("getDb()", () => {
    it("opens connection readonly and sets query_only pragma", async () => {
      const mockDb = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb);

      // fs.existsSync must return true
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      const { getDb } = await loadClient();
      const db = getDb();

      expect(mockDbConstructor).toHaveBeenCalledWith(
        DEFAULT_DB_PATH,
        { readonly: true }
      );
      expect(mockDb.pragma).toHaveBeenCalledWith("query_only = true");
      expect(db).toBe(mockDb);
    });

    it("opens connection only once (lazy singleton)", async () => {
      const mockDb = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb);

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      const { getDb } = await loadClient();
      getDb();
      const db2 = getDb();

      expect(mockDbConstructor).toHaveBeenCalledTimes(1);
      expect(db2).toBe(mockDb);
    });
  });

  describe("missing file", () => {
    it("throws helpful error with env var hint", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      const { getDb } = await loadClient();

      expect(() => getDb()).toThrow(/Database not found at:/);
      expect(() => getDb()).toThrow(/OPENCODE_DB_PATH/);
    });
  });

  describe("corrupt database", () => {
    it("surfaces corruption error with guidance", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      mockDbConstructor.mockImplementation(() => {
        throw new Error("file is not a database");
      });

      const { getDb } = await loadClient();

      expect(() => getDb()).toThrow(/corrupt/);
      expect(() => getDb()).toThrow(/not a valid SQLite database/);
    });

    it("surfaces encrypted database error", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      mockDbConstructor.mockImplementation(() => {
        throw new Error("file is encrypted or is not a database");
      });

      const { getDb } = await loadClient();

      expect(() => getDb()).toThrow(/corrupt/);
    });

    it("surfaces locked database error", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      mockDbConstructor.mockImplementation(() => {
        throw new Error("database is locked");
      });

      const { getDb } = await loadClient();

      expect(() => getDb()).toThrow(/locked/);
      expect(() => getDb()).toThrow(/Close other connections/);
    });
  });

  describe("close()", () => {
    it("closes the connection and resets state", async () => {
      const mockDb = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb);

      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
      }));

      const { getDb, close } = await loadClient();
      getDb();
      close();

      expect(mockDb.close).toHaveBeenCalledTimes(1);

      // Reset mocks so second getDb creates a new connection
      mockDbConstructor.mockReset();
      const mockDb2 = createMockDb();
      mockDbConstructor.mockReturnValue(mockDb2);

      getDb();

      expect(mockDbConstructor).toHaveBeenCalledTimes(1);
    });

    it("is safe to call close() when not connected", async () => {
      vi.doMock("fs", () => ({
        existsSync: vi.fn().mockReturnValue(true),
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
      }));

      const { getDb } = await loadClient();
      getDb();

      expect(mockDbConstructor).toHaveBeenCalledWith(
        resolve(customPath),
        { readonly: true }
      );

      vi.unstubAllEnvs();
    });
  });
});
