import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import { homedir } from "os";
import { join, resolve } from "path";
import { existsSync, readFileSync } from "fs";

let db: SqlJsDatabase | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Resolve the database path from env var or default.
 */
function resolveDbPath(): string {
  const envPath = process.env.OPENCODE_DB_PATH;
  if (envPath) return resolve(envPath);

  const defaultPath = join(homedir(), ".local", "share", "opencode", "opencode.db");
  return defaultPath;
}

/**
 * Get the database connection. Opens on first call (lazy, async).
 */
export async function getDb(): Promise<SqlJsDatabase> {
  if (db) return db;
  if (initPromise) {
    try {
      await initPromise;
      if (db) return db;
    } catch {
      // init failed — fall through to retry below
    }
  }

  const dbPath = resolveDbPath();

  if (!existsSync(dbPath)) {
    throw new Error(
      `Database not found at: ${dbPath}\n` +
      `Set the OPENCODE_DB_PATH environment variable to point to your OpenCode database.`
    );
  }

  // Set the init promise BEFORE any async work so concurrent callers
  // hitting the initPromise check above will await this same promise
  initPromise = (async () => {
    const SQL = await initSqlJs();
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  })();

  try {
    await initPromise;
    initPromise = null;
    return db!;
  } catch (err) {
    initPromise = null;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("file is not a database") || message.includes("file is encrypted")) {
      throw new Error(
        `Database at ${dbPath} appears to be corrupt or is not a valid SQLite database.\n` +
        `Error: ${message}`
      );
    }
    if (message.includes("locked") || message.includes("busy")) {
      throw new Error(
        `Database at ${dbPath} is locked. Close other connections and try again.\n` +
        `Error: ${message}`
      );
    }
    throw new Error(
      `Failed to open database at ${dbPath}: ${message}`
    );
  }
}

/**
 * Close the database connection.
 */
export function close(): void {
  if (db) {
    db.close();
    db = null;
  }
}
