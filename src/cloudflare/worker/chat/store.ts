import type {
  ChatBanListResponse,
  ChatBanRecord,
  ChatMentionUserRecord,
  ChatMessageRecord,
  ChatModerationUserRecord,
} from '../../../chat/model';
import type { ChatAdminRow, ChatBanRow, ChatMessageRow, Env } from '../core/types';

const DEFAULT_CHAT_MENTION_USER_LIMIT = 8;
const MAX_CHAT_MENTION_USER_LIMIT = 12;

export async function listChatMessages(
  env: Env,
  limit: number,
  afterCreatedAt: string | null
): Promise<ChatMessageRecord[]> {
  const results =
    afterCreatedAt === null
      ? await env.DB.prepare(
          `
            SELECT id, user_id, user_display_name, body, created_at, deleted_at, deleted_by_user_id
            FROM (
              SELECT id, user_id, user_display_name, body, created_at, deleted_at, deleted_by_user_id
              FROM chat_messages
              WHERE deleted_at IS NULL
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
            SELECT id, user_id, user_display_name, body, created_at, deleted_at, deleted_by_user_id
            FROM chat_messages
            WHERE created_at > ?
              AND deleted_at IS NULL
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
        INSERT INTO chat_messages (id, user_id, user_display_name, body, created_at, deleted_at, deleted_by_user_id)
        VALUES (?, ?, ?, ?, ?, NULL, NULL)
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

export async function searchChatMentionUsers(
  env: Env,
  query: string,
  limit: number = DEFAULT_CHAT_MENTION_USER_LIMIT
): Promise<ChatMentionUserRecord[]> {
  const normalizedQuery = normalizeMentionSearchQuery(query);
  const boundedLimit = Math.max(1, Math.min(MAX_CHAT_MENTION_USER_LIMIT, Math.floor(limit)));

  try {
    if (!normalizedQuery) {
      const result = await env.DB.prepare(
        `
          SELECT u.id, u.display_name, u.username
          FROM (
            SELECT user_id, MAX(created_at) AS latest_at
            FROM chat_messages
            WHERE deleted_at IS NULL
            GROUP BY user_id
            ORDER BY latest_at DESC
            LIMIT 50
          ) recent
          JOIN users u ON u.id = recent.user_id
          WHERE u.username IS NOT NULL
            AND trim(u.username) != ''
          ORDER BY recent.latest_at DESC, lower(u.username) ASC
          LIMIT ?
        `
      )
        .bind(boundedLimit)
        .all<ChatMentionUserRow>();

      return result.results.map(mapChatMentionUserRow);
    }

    const escapedQuery = escapeSqlLike(normalizedQuery);
    const usernamePrefix = `${escapedQuery}%`;
    const displayNameMatch = `%${escapedQuery}%`;
    const result = await env.DB.prepare(
      `
        SELECT id, display_name, username
        FROM users
        WHERE username IS NOT NULL
          AND trim(username) != ''
          AND (
            lower(username) LIKE ? ESCAPE '\\'
            OR lower(display_name) LIKE ? ESCAPE '\\'
          )
        ORDER BY
          CASE
            WHEN lower(username) = ? THEN 0
            WHEN lower(username) LIKE ? ESCAPE '\\' THEN 1
            WHEN lower(display_name) LIKE ? ESCAPE '\\' THEN 2
            ELSE 3
          END,
          lower(username) ASC,
          lower(display_name) ASC
        LIMIT ?
      `
    )
      .bind(
        usernamePrefix,
        displayNameMatch,
        normalizedQuery,
        usernamePrefix,
        displayNameMatch,
        boundedLimit
      )
      .all<ChatMentionUserRow>();

    return result.results.map(mapChatMentionUserRow);
  } catch (error) {
    if (isMissingUsernameColumnError(error)) {
      return [];
    }
    throw error;
  }
}

export async function loadLatestChatMessageForUser(
  env: Env,
  userId: string
): Promise<ChatMessageRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, user_display_name, body, created_at, deleted_at, deleted_by_user_id
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

export async function loadChatMessageById(
  env: Env,
  messageId: string
): Promise<ChatMessageRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT id, user_id, user_display_name, body, created_at, deleted_at, deleted_by_user_id
      FROM chat_messages
      WHERE id = ?
        AND deleted_at IS NULL
      LIMIT 1
    `
  )
    .bind(messageId)
    .first<ChatMessageRow>();

  return row ? mapChatMessageRow(row) : null;
}

export async function softDeleteChatMessage(
  env: Env,
  messageId: string,
  deletedByUserId: string,
  deletedAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE chat_messages
        SET deleted_at = ?, deleted_by_user_id = ?
        WHERE id = ?
          AND deleted_at IS NULL
      `
    ).bind(deletedAt, deletedByUserId, messageId),
  ]);
}

export async function isChatAdminUser(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT user_id
      FROM chat_admins
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ user_id: string }>();

  return Boolean(row?.user_id);
}

export async function loadChatAdminRecord(
  env: Env,
  userId: string
): Promise<ChatModerationUserRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        a.user_id,
        u.display_name,
        a.granted_by_user_id,
        grantor.display_name AS granted_by_display_name,
        a.created_at
      FROM chat_admins a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN users grantor ON grantor.id = a.granted_by_user_id
      WHERE a.user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<ChatAdminRow>();

  return row ? mapChatAdminRow(row) : null;
}

export async function listChatAdmins(env: Env): Promise<ChatModerationUserRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        a.user_id,
        u.display_name,
        a.granted_by_user_id,
        grantor.display_name AS granted_by_display_name,
        a.created_at
      FROM chat_admins a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN users grantor ON grantor.id = a.granted_by_user_id
      ORDER BY lower(u.display_name) ASC, a.created_at ASC
    `
  ).all<ChatAdminRow>();

  return result.results.map(mapChatAdminRow);
}

export async function createChatAdmin(
  env: Env,
  userId: string,
  grantedByUserId: string,
  createdAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO chat_admins (user_id, granted_by_user_id, created_at)
        VALUES (?, ?, ?)
      `
    ).bind(userId, grantedByUserId, createdAt),
  ]);
}

export async function deleteChatAdmin(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM chat_admins
        WHERE user_id = ?
      `
    ).bind(userId),
  ]);
}

export async function isChatBannedUser(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT user_id
      FROM chat_bans
      WHERE user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<{ user_id: string }>();

  return Boolean(row?.user_id);
}

export async function loadChatBanRecord(
  env: Env,
  userId: string
): Promise<ChatBanRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        b.user_id,
        u.display_name,
        b.banned_by_user_id,
        banner.display_name AS banned_by_display_name,
        b.created_at
      FROM chat_bans b
      JOIN users u ON u.id = b.user_id
      LEFT JOIN users banner ON banner.id = b.banned_by_user_id
      WHERE b.user_id = ?
      LIMIT 1
    `
  )
    .bind(userId)
    .first<ChatBanRow>();

  return row ? mapChatBanRow(row) : null;
}

export async function listChatBans(env: Env): Promise<ChatBanListResponse['bans']> {
  const result = await env.DB.prepare(
    `
      SELECT
        b.user_id,
        u.display_name,
        b.banned_by_user_id,
        banner.display_name AS banned_by_display_name,
        b.created_at
      FROM chat_bans b
      JOIN users u ON u.id = b.user_id
      LEFT JOIN users banner ON banner.id = b.banned_by_user_id
      ORDER BY b.created_at DESC, b.user_id ASC
    `
  ).all<ChatBanRow>();

  return result.results.map(mapChatBanRow);
}

export async function createChatBan(
  env: Env,
  userId: string,
  bannedByUserId: string,
  createdAt: string
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO chat_bans (user_id, banned_by_user_id, created_at)
        VALUES (?, ?, ?)
      `
    ).bind(userId, bannedByUserId, createdAt),
    env.DB.prepare(
      `
        INSERT INTO chat_ban_audit (id, user_id, banned_by_user_id, created_at)
        VALUES (?, ?, ?, ?)
      `
    ).bind(crypto.randomUUID(), userId, bannedByUserId, createdAt),
  ]);
}

export async function deleteChatBan(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `
        DELETE FROM chat_bans
        WHERE user_id = ?
      `
    ).bind(userId),
  ]);
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

interface ChatMentionUserRow {
  id: string;
  display_name: string;
  username: string;
}

function mapChatMentionUserRow(row: ChatMentionUserRow): ChatMentionUserRecord {
  return {
    userId: row.id,
    displayName: row.display_name,
    username: row.username,
  };
}

function mapChatAdminRow(row: ChatAdminRow): ChatModerationUserRecord {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    grantedByUserId: row.granted_by_user_id,
    grantedByDisplayName: row.granted_by_display_name,
  };
}

function mapChatBanRow(row: ChatBanRow): ChatBanRecord {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    bannedByUserId: row.banned_by_user_id,
    bannedByDisplayName: row.banned_by_display_name,
  };
}

function normalizeMentionSearchQuery(value: string): string {
  return value
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, 24);
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isMissingUsernameColumnError(error: unknown): boolean {
  return error instanceof Error && /no such column:\s*(u\.)?username|no such column:\s*username/i.test(error.message);
}
