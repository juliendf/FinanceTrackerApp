/** Conversations, messages and pending actions. */

import { getDb } from "../client";

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

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  return db.select<Conversation[]>(
    `SELECT * FROM conversations ORDER BY updated_at DESC`,
  );
}

export async function createConversation(input: {
  title?: string;
  provider_id?: number | null;
  model_override?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO conversations (title, provider_id, model_override) VALUES (?, ?, ?)`,
    [
      input.title ?? "New conversation",
      input.provider_id ?? null,
      input.model_override ?? null,
    ],
  );
  return Number(result.lastInsertId);
}

export async function renameConversation(
  id: number,
  title: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE conversations SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [title.trim(), id],
  );
}

export async function deleteConversation(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM conversations WHERE id = ?`, [id]);
}

export async function listMessages(conversationId: number): Promise<Message[]> {
  const db = await getDb();
  return db.select<Message[]>(
    `SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC`,
    [conversationId],
  );
}

export async function appendMessage(input: {
  conversationId: number;
  role: Message["role"];
  content: string;
  tool_calls?: string | null;
  tool_call_id?: string | null;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id)
     VALUES (?, ?, ?, ?, ?)`,
    [
      input.conversationId,
      input.role,
      input.content,
      input.tool_calls ?? null,
      input.tool_call_id ?? null,
    ],
  );
  await db.execute(
    `UPDATE conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [input.conversationId],
  );
  return Number(result.lastInsertId);
}

export async function deleteMessage(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM messages WHERE id = ?`, [id]);
}

export type PendingActionStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "expired"
  | "failed";

export interface PendingAction {
  id: number;
  conversation_id: number;
  action_type: string;
  payload: string;
  status: PendingActionStatus;
  result_message: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listPendingActions(
  conversationId: number,
): Promise<PendingAction[]> {
  const db = await getDb();
  return db.select<PendingAction[]>(
    `SELECT * FROM pending_actions WHERE conversation_id = ? ORDER BY id ASC`,
    [conversationId],
  );
}

export async function resolvePendingAction(
  id: number,
  status: PendingActionStatus,
  resultMessage: string | null = null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE pending_actions
        SET status = ?,
            result_message = ?,
            resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?`,
    [status, resultMessage, id],
  );
}
