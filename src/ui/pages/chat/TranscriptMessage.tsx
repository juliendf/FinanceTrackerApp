/**
 * One saved message, memoised.
 *
 * While an answer streams, the page re-renders several times a second; without
 * memoisation that re-parsed every message in the conversation each time, which is
 * what made long chats lag. The component re-renders only when its message changes
 * or a handler does, and the handlers are `useCallback` in the page.
 *
 * A user message can be edited in place. Saving rewinds the conversation to that
 * message and asks again, so the editor says so before the click rather than
 * after: the deletion is not undoable.
 */

import { memo, useState } from "react";
import { MessageMarkdown } from "./MessageMarkdown";

export interface TranscriptMessageRow {
  id: number;
  role: string;
  content: string;
}

interface Props {
  message: TranscriptMessageRow;
  onRequestDelete: (id: number) => void;
  /** Save the edited text; the page rewinds and asks again. */
  onSaveEdit: (id: number, content: string) => void;
  /** Editing is refused while an answer streams. */
  canEdit: boolean;
}

export const TranscriptMessage = memo(function TranscriptMessage({
  message,
  onRequestDelete,
  onSaveEdit,
  canEdit,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  if (message.role === "user") {
    if (draft !== null) {
      const trimmed = draft.trim();
      return (
        <div className="msg-bubble msg-user msg-editing">
          <textarea
            className="form-control msg-edit-input"
            value={draft}
            rows={Math.min(10, Math.max(2, draft.split("\n").length))}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(null);
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && trimmed) {
                setDraft(null);
                onSaveEdit(message.id, trimmed);
              }
            }}
          />
          <div className="msg-edit-hint">
            Saving removes this message and everything after it, then asks again. This cannot be undone.
          </div>
          <div className="msg-edit-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!trimmed}
              onClick={() => {
                setDraft(null);
                onSaveEdit(message.id, trimmed);
              }}
            >
              Save &amp; regenerate
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="msg-bubble msg-user">
        {canEdit ? (
          <button
            type="button"
            className="btn-edit-msg"
            title="Edit this message and regenerate the answer"
            onClick={() => setDraft(message.content)}
          >
            <i className="bi bi-pencil" aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          className="btn-delete-msg"
          title="Delete this message and rewind conversation"
          onClick={() => onRequestDelete(message.id)}
        >
          <i className="bi bi-x" aria-hidden="true" />
        </button>
        <span className="msg-text">{message.content}</span>
      </div>
    );
  }

  if (message.role === "assistant" && message.content) {
    return (
      <div className="msg-bubble msg-assistant">
        <MessageMarkdown content={message.content} />
      </div>
    );
  }

  return null;
});
