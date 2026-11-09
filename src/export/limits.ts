/**
 * How large a backup may be, and what to say when it is too large.
 *
 * The app reads files through a native dialog that refuses anything over
 * `MAX_READ_BYTES` (`src-tauri/src/commands/files.rs`). An export bigger than
 * that could never be imported again, so the export screen checks the size
 * before it writes: a backup you cannot restore is worse than no backup, because
 * you stop looking for another one.
 *
 * The limit comes from Rust rather than being duplicated here; `FALLBACK` is only
 * used when the command is unavailable, which is the browser test environment.
 */

import { invoke } from "@tauri-apps/api/core";

/** Mirrors `MAX_READ_BYTES`. Kept in step by the `read_limit_bytes` command. */
export const READ_LIMIT_FALLBACK_BYTES = 50 * 1024 * 1024;

/** The read limit this build enforces. */
export async function readLimitBytes(): Promise<number> {
  try {
    const limit = await invoke<number>("read_limit_bytes");
    return typeof limit === "number" && limit > 0 ? limit : READ_LIMIT_FALLBACK_BYTES;
  } catch {
    return READ_LIMIT_FALLBACK_BYTES;
  }
}

/** UTF-8 bytes, which is what the file will weigh on disk. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** "242 KB", "62.0 MB" — one decimal from the megabyte up. */
export function humanSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Why a file of `bytes` could not be imported, or `null` when it can.
 *
 * Returns the sentence, not a boolean: the caller shows it verbatim, and the
 * numbers are the only part a user can act on.
 */
export function oversizeWarning(bytes: number, limit: number): string | null {
  if (bytes <= limit) return null;
  return `This backup is ${humanSize(bytes)}, and this build reads files up to ${humanSize(limit)}. It could not be imported back.`;
}
