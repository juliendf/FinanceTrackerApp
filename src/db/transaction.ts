/**
 * All-or-nothing writes.
 *
 * `tauri-plugin-sql` cannot hold a transaction (see src-tauri/src/commands/db.rs),
 * so multi-statement writes go through the Rust `run_transaction` command, which
 * runs the list on one connection with foreign keys enforced.
 *
 * Statements carry escaped literals rather than bind parameters; build them with
 * the helpers in `./literals`.
 */

import { invoke } from "@tauri-apps/api/core";

export async function runTransaction(statements: string[]): Promise<number> {
  return invoke<number>("run_transaction", { statements });
}

/**
 * SQL expression for "the id of the row this transaction just inserted into an
 * AUTOINCREMENT table". Valid after an INSERT into `table` and before any other
 * INSERT into the same table.
 */
export function justInserted(table: string): string {
  return `(SELECT seq FROM sqlite_sequence WHERE name = '${table.replace(/'/g, "''")}')`;
}

/** The id the *next* AUTOINCREMENT insert into `table` will receive. */
export function nextId(table: string): string {
  return `(COALESCE((SELECT seq FROM sqlite_sequence WHERE name = '${table.replace(/'/g, "''")}'), 0) + 1)`;
}
