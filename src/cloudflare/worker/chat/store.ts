import type { ChatMessageRecord } from '../../../chat/model';
import type { ChatMessageRow, Env } from '../core/types';

export async function listChatMessages(
  env: Env,
  limit: number,
  afterCreatedAt: string | null
): Promise<ChatMessageRecord[]> {
  const results =
    afterCreatedAt === null
      ? await env.DB.prepare(
          `
            SELECT id, user_id, user_display_name, body, created_at
            FROM (
              SELECT id, user_id, user_display_name, body, created_at
              FROM chat_messages
              ORDER BY created_at DESC, id DESC
              LIMIT ?
            )
            ORDER BY created_at ASC, id ASC
          `
        )
          .bind(limit)
          .all<ChatMessageRow>()
      : await env.DB.prepare(
          `
            SELECT id, user_id, user_display_name, body, created_at
            FROM chat_messages
            WHERE created_at > ?
            ORDER BY created_at ASC, id ASC
            LIMIT ?
          `
        )
          .bind(afterCreatedAt, limit)
          .all<ChatMessageRow>();

  return results.results.map(mapChatMessageRow);
}

export async function createChatMessage(
  env: Env,
  userId: string,
  userDisplayName: string,
  body: string,
  createdAt: string,
  id: string = crypto.randomUUID()
): Promise<ChatMessageRecord> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO chat_messages (id, user_id, user_display_name, body, created_at)
        VALUES (?, ?, ?, ?, ?)
      `
    ).bind(id, userId, userDisplayName, body, createdAt),
  ]);

  return {
    id,
    userId,
    userDisplayName,
    body,
    createdAt,
  };
}

export async function loadLatestChatMessageForUser(
  env: Env,
  userId: string
): Promise<ChatMessageRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, user_display_name, body, created_at
      FROM chat_messages
      WHERE user_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `
  )
    .bind(userId)
    .first<ChatMessageRow>();

  return row ? mapChatMessageRow(row) : null;
}

function mapChatMessageRow(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    body: row.body,
    createdAt: row.created_at,
  };
}
