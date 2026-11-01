/**
 * A stable identifier for a memory, derived from its text.
 *
 * The `user_memories.key` column is a short label the assistant sees in its
 * prompt (`- [financial] User …`). Asking the user to invent one was busywork, so
 * the form derives it from the content instead — the column keeps its shape and
 * existing rows keep the keys they were imported or created with.
 */

/** Lowercase, accent-free, underscore-separated, at most 48 characters. */
export function slugifyMemoryKey(content: string): string {
  const flattened = content
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!flattened) return "memory";
  return flattened.slice(0, 48).replace(/_+$/g, "") || "memory";
}

/**
 * A key that is not already in use, suffixing `_2`, `_3`, … when it is.
 *
 * `taken` is the set of keys on the memories that already exist.
 */
export function deriveMemoryKey(content: string, taken: Iterable<string> = []): string {
  const base = slugifyMemoryKey(content);
  const used = new Set(taken);
  if (!used.has(base)) return base;

  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base.slice(0, 44)}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base.slice(0, 40)}_${Date.now()}`;
}
