/**
 * One saved message, memoised.
 *
 * While an answer streams, the page re-renders several times a second; without
 * memoisation that re-parsed every message in the conversation each time, which is
 * what made long chats lag. The component re-renders only when its message changes
 * or the delete handler does, and the handler is a `useCallback` in the page.
 */

import { memo } from "react";
import { MessageMarkdown } from "./MessageMarkdown";

export interface TranscriptMessageRow {
  id: number;
  role: string;
  content: string;
}

interface Props {
  message: TranscriptMessageRow;
  onRequestDelete: (id: number) => void;
}

export const TranscriptMessage = memo(function TranscriptMessage({ message, onRequestDelete }: Props) {
  if (message.role === "user") {
    return (
      <div className="msg-bubble msg-user">
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
