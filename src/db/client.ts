/**
 * SQLite access.
 *
 * Every statement the webview runs goes through a Rust command:
 *
 * * `db_select` for reads — a **read-only** connection with an authorizer that
 *   allows only `SELECT`/`READ`/`FUNCTION`/`RECURSIVE`;
 * * `execute_write` for one statement with bound values;
 * * `run_transaction` for a batch that must be atomic.
 *
 * `tauri-plugin-sql` is still registered in the Rust builder so it can own the
 * schema migrations, but **none of its commands are granted to the webview**. Its
 * `select` ran whatever followed the first statement (`SELECT 1; DROP TABLE
 * snapshots` returned `Ok` with the table gone), and it used a pool this app does
 * not guard.
 */

import { invoke } from "@tauri-apps/api/core";

const DB_NAME = "financetracker.db";

/** The shape the repositories use. Mirrors the plugin's `select`, minus the hole. */
export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

const db: Db = {
  select: <T>(sql: string, params: unknown[] = []) => invoke<T>("db_select", { sql, params }),
};

/** The database handle. Kept async so call sites and their mocks stay unchanged. */
export function getDb(): Promise<Db> {
  return Promise.resolve(db);
}

/** Absolute path of the database file, for the Diagnostics panel. */
export function databaseName(): string {
  return DB_NAME;
}

/**
 * One guarded write with bound parameters.
 *
 * `tauri-plugin-sql`'s own `execute` is not granted to the webview: it accepted
 * any SQL and bypassed the Rust statement guard. This command validates the
 * statement (INSERT/UPDATE/DELETE only, no stacked statements or comments, and a
 * SQLite authorizer underneath) and keeps the values bound rather than inlined.
 */
export interface WriteResult {
  lastInsertId: number;
  rowsAffected: number;
}

export async function executeWrite(sql: string, params: unknown[] = []): Promise<WriteResult> {
  return invoke<WriteResult>("execute_write", { sql, params });
}
