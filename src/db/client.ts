/**
 * SQLite connection through `tauri-plugin-sql`.
 *
 * The database file lives at ~/Library/Application Support/<bundle-id>/
 * financetracker.db, which is where the plugin resolves `sqlite:financetracker.db`
 * on macOS.
 *
 * PRAGMA note: the plugin pools connections, so a PRAGMA issued here applies to
 * the connection that ran it. `journal_mode=WAL` is persistent in the database
 * header, so it sticks. `foreign_keys` is per-connection and is therefore also
 * declared in each repository's write path. Phase 1 replaces this with a single
 * connection or an explicit transaction helper.
 */

import Database from "@tauri-apps/plugin-sql";

const DB_NAME = "sqlite:financetracker.db";

let connection: Promise<Database> | null = null;

async function open(): Promise<Database> {
  const db = await Database.load(DB_NAME);
  await db.execute("PRAGMA journal_mode = WAL;");
  await db.execute("PRAGMA foreign_keys = ON;");
  return db;
}

/** Lazily open (and memoise) the database connection. */
export function getDb(): Promise<Database> {
  if (!connection) {
    connection = open().catch((error) => {
      // Let the next caller retry instead of caching a rejected promise.
      connection = null;
      throw error;
    });
  }
  return connection;
}

/** Absolute path of the database file, for the Diagnostics panel. */
export function databaseName(): string {
  return DB_NAME.replace("sqlite:", "");
}
