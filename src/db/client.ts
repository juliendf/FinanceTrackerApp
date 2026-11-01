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
import { invoke } from "@tauri-apps/api/core";

const DB_NAME = "sqlite:financetracker.db";

let connection: Promise<Database> | null = null;

async function open(): Promise<Database> {
  // WAL is persistent in the database header and foreign keys are enforced by
  // the Rust write paths, so nothing needs to be set on this pooled connection.
  return Database.load(DB_NAME);
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

/**
 * One guarded write with bound parameters.
 *
 * `tauri-plugin-sql`'s own `execute` is not granted to the webview: it accepted
 * any SQL and bypassed the Rust statement guard. This command validates the
 * statement (INSERT/UPDATE/DELETE only, no stacked statements or comments) and
 * keeps the values bound rather than inlined.
 */
export interface WriteResult {
  lastInsertId: number;
  rowsAffected: number;
}

export async function executeWrite(sql: string, params: unknown[] = []): Promise<WriteResult> {
  return invoke<WriteResult>("execute_write", { sql, params });
}
