import Database from "better-sqlite3";
import { homedir } from "os";
import { join, resolve } from "path";
import { existsSync } from "fs";

let db: Database.Database | null = null;

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
 * Get the read-only database connection. Opens on first call (lazy).
 */
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = resolveDbPath();

  if (!existsSync(dbPath)) {
    throw new Error(
      `Database not found at: ${dbPath}\n` +
      `Set the OPENCODE_DB_PATH environment variable to point to your OpenCode database.`
    );
  }

  try {
    db = new Database(dbPath, { readonly: true });
    db.pragma("query_only = true");
    return db;
  } catch (err) {
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
