/** Conversations, messages and pending actions. Typed SQL only. */

import { getDb } from "../client";
import { runTransaction } from "../transaction";
import { sqlInt, sqlText } from "../literals";

export interface Conversation {
  id: number;
  provider_id: number | null;
  model_override: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  created_at: string;
  updated_at: string;
}

export type PendingActionType = "create_snapshot" | "create_memory";
export type PendingActionStatus = "pending" | "confirmed" | "rejected" | "expired" | "failed";

export interface PendingAction {
  id: number;
  conversation_id: number;
  action_type: PendingActionType;
  /** JSON text. */
  payload: string;
  status: PendingActionStatus;
  result_message: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

const CONVERSATION_SQL = `SELECT id, provider_id, model_override, title, created_at, updated_at FROM conversations`;

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  return db.select<Conversation[]>(`${CONVERSATION_SQL} ORDER BY updated_at DESC, id DESC`);
}

export async function getConversation(id: number): Promise<Conversation | null> {
  const db = await getDb();
  const rows = await db.select<Conversation[]>(`${CONVERSATION_SQL} WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

/** New conversation, pre-bound to the default provider (`create_conversation`). */
export async function createConversation(providerId: number | null): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO conversations (provider_id, title) VALUES (?, 'New conversation')`,
    [providerId],
  );
  return Number(result.lastInsertId);
}

export async function setConversationProvider(id: number, providerId: number | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE conversations SET provider_id = ?, model_override = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [providerId, id],
  );
}

export async function setConversationModel(id: number, model: string | null): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE conversations SET model_override = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [model, id],
  );
}

export async function renameConversation(id: number, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE conversations SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [title, id],
  );
}

export async function touchConversation(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    [id],
  );
}

export async function deleteConversation(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM conversations WHERE id = ?`, [id]);
}

export async function listMessages(conversationId: number): Promise<Message[]> {
  const db = await getDb();
  return db.select<Message[]>(
    `SELECT id, conversation_id, role, content, tool_calls, tool_call_id, created_at, updated_at
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, id ASC`,
    [conversationId],
  );
}

/** The newest `limit` messages, oldest first — the history window's input. */
export async function listRecentMessages(conversationId: number, limit: number): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.select<Message[]>(
    `SELECT id, conversation_id, role, content, tool_calls, tool_call_id, created_at, updated_at
       FROM messages WHERE conversation_id = ?
      ORDER BY created_at DESC, id DESC LIMIT ?`,
    [conversationId, limit],
  );
  return rows.reverse();
}

export async function appendMessage(input: {
  conversationId: number;
  role: Message["role"];
  content: string;
  toolCalls?: string | null;
  toolCallId?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.conversationId,
      input.role,
      input.content,
      input.toolCalls ?? null,
      input.toolCallId ?? null,
    ],
  );
  await touchConversation(input.conversationId);
  return Number(result.lastInsertId);
}

/**
 * Delete one message and everything after it ("rewind", as the chat UI's per
 * message delete does), plus the pending actions they produced.
 */
export async function deleteMessageFrom(id: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ conversation_id: number; created_at: string }[]>(
    `SELECT conversation_id, created_at FROM messages WHERE id = ?`,
    [id],
  );
  const row = rows[0];
  if (!row) return;
  await runTransaction([
    `DELETE FROM pending_actions WHERE conversation_id = ${sqlInt(row.conversation_id)}
       AND created_at >= ${sqlText(row.created_at)} AND status = 'pending'`,
    `DELETE FROM messages WHERE conversation_id = ${sqlInt(row.conversation_id)}
       AND (created_at > ${sqlText(row.created_at)}
            OR (created_at = ${sqlText(row.created_at)} AND id >= ${sqlInt(id)}))`,
  ]);
}

export async function listPendingActions(conversationId: number): Promise<PendingAction[]> {
  const db = await getDb();
  return db.select<PendingAction[]>(
    `SELECT id, conversation_id, action_type, payload, status, result_message, resolved_at, created_at, updated_at
       FROM pending_actions WHERE conversation_id = ? AND status = 'pending' ORDER BY id ASC`,
    [conversationId],
  );
}

export async function getPendingAction(id: number): Promise<PendingAction | null> {
  const db = await getDb();
  const rows = await db.select<PendingAction[]>(
    `SELECT id, conversation_id, action_type, payload, status, result_message, resolved_at, created_at, updated_at
       FROM pending_actions WHERE id = ?`,
    [id],
  );
  return rows[0] ?? null;
}

export async function createPendingAction(input: {
  conversationId: number;
  actionType: PendingActionType;
  payload: unknown;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO pending_actions (conversation_id, action_type, payload, status) VALUES (?, ?, ?, 'pending')`,
    [input.conversationId, input.actionType, JSON.stringify(input.payload)],
  );
  return Number(result.lastInsertId);
}

export async function resolvePendingAction(
  id: number,
  status: Exclude<PendingActionStatus, "pending">,
  resultMessage: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE pending_actions
        SET status = ?, result_message = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [status, resultMessage, id],
  );
}
