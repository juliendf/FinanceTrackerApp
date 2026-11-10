/**
 * Marks text as data, not instructions (FIN-47).
 *
 * Notes, asset descriptions, holding labels and saved memories reach the model
 * inside the prompt or inside tool results. Wrapped in `<data>` tags, with any
 * tag of that name removed from the text first, the model is told (in the system
 * prompt) that the contents are data. This is framing, not a guarantee: it
 * reduces the risk and the length limits are a separate control.
 */

/**
 * A `<data>` or `</data>` tag, in any letter case, with optional attributes.
 *
 * Attributes may not contain `<` or `>`, so an unclosed `<data` cannot run on
 * into the next JSON field and delete it.
 */
const DATA_TAG = /<\/?\s*data(?:\s[^<>]*)?\/?\s*>/gi;

/**
 * Remove every `<data>` tag from `text`.
 *
 * Repeats until nothing changes: deleting one tag can join the pieces around it
 * into another (`<da<data>ta>` becomes `<data>`), so one pass is not enough.
 */
export function stripDataTags(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(DATA_TAG, "");
  } while (current !== previous);
  return current;
}

/** The text, with its own data tags removed, wrapped in one `<data>` pair. */
export function fenceData(text: string): string {
  return `<data>${stripDataTags(text)}</data>`;
}
