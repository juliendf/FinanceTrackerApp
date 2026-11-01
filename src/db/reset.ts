/**
 * Wipe the database back to a freshly-seeded state.
 *
 * Order matters: children before parents, so the foreign keys hold even when a
 * pooled connection happens to have `PRAGMA foreign_keys` on.
 */

import { invoke } from "@tauri-apps/api/core";

export async function resetDatabase(): Promise<void> {
  // Providers and their Keychain items first: the generic SQL path may not touch
  // those tables, and Rust removes both together.
  await invoke("providers_reset");

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
    `DELETE FROM exchange_rates`,
    `DELETE FROM user_memories`,
    `DELETE FROM user_goals`,
    `DELETE FROM settings`,
    `DELETE FROM profile`,
  ];

  // One transaction, so a failed reset cannot leave a half-empty database.
  await invoke<number>("run_transaction", { statements });
}
