/**
 * Wipe the database back to a freshly-seeded state.
 *
 * Order matters: children before parents, so the foreign keys hold even when a
 * pooled connection happens to have `PRAGMA foreign_keys` on.
 */

import { invoke } from "@tauri-apps/api/core";
import { getDb } from "./client";

/** Keychain accounts to remove when the providers holding them go away. */
async function providerAccounts(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<Array<{ keychain_ref: string | null }>>(
    `SELECT keychain_ref FROM llm_providers WHERE keychain_ref IS NOT NULL`,
  );
  return rows.map((row) => row.keychain_ref).filter((ref): ref is string => !!ref);
}

export async function resetDatabase(): Promise<void> {
  for (const account of await providerAccounts()) {
    try {
      await invoke("secret_delete", { account });
    } catch {
      // A missing Keychain item is not a reason to block a reset.
    }
  }

  const statements = [
    `DELETE FROM pending_actions`,
    `DELETE FROM messages`,
    `DELETE FROM conversations`,
    `DELETE FROM asset_tags`,
    `DELETE FROM snapshots`,
    `DELETE FROM assets`,
    `DELETE FROM tags`,
    `DELETE FROM categories`,
    `DELETE FROM institutions`,
    `DELETE FROM llm_providers`,
    `DELETE FROM exchange_rates`,
    `DELETE FROM user_memories`,
    `DELETE FROM user_goals`,
    `DELETE FROM settings`,
    `DELETE FROM profile`,
  ];

  // One transaction, so a failed reset cannot leave a half-empty database.
  await invoke<number>("run_transaction", { statements });
}
