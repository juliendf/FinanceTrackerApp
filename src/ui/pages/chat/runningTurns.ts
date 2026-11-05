/**
 * Chat turns that outlive the page that started them.
 *
 * An answer is written by `sendMessage`, which persists each step as it arrives;
 * the page only renders it. Cancelling on navigation therefore threw away work
 * that was already being saved, and with a slow local model it forced the user to
 * sit and watch the spinner — the one thing they could not do was leave.
 *
 * This registry is module state on purpose. The page unmounts and remounts
 * (dashboard, settings, another conversation) while the promise keeps running, and
 * it has to find the turn again on return to show the Stop button and to know a
 * spinner belongs on screen.
 *
 * A turn is registered when it starts and removed when it settles, whether it
 * finished, was cancelled, or failed.
 */

export interface RunningTurn {
  /** Stops the request; `sendMessage` then resolves with `cancelled: true`. */
  cancel: () => Promise<void>;
}

const turns = new Map<number, RunningTurn>();

export function registerTurn(conversationId: number, turn: RunningTurn): void {
  turns.set(conversationId, turn);
}

export function unregisterTurn(conversationId: number): void {
  turns.delete(conversationId);
}

export function getRunningTurn(conversationId: number): RunningTurn | undefined {
  return turns.get(conversationId);
}

/** Test-only: module state would otherwise leak between cases. */
export function clearRunningTurns(): void {
  turns.clear();
}

/**
 * Which conversation is on screen, or null when the chat is not.
 *
 * The page cannot answer this after it unmounts: a ref captured in the turn's
 * closure keeps its last value and would claim the user is still there. This is
 * module state for the same reason the registry is.
 */
let visibleConversation: number | null = null;

export function setVisibleConversation(conversationId: number | null): void {
  visibleConversation = conversationId;
}

export function getVisibleConversation(): number | null {
  return visibleConversation;
}
