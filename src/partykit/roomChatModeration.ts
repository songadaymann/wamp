/** A connected sender's chat ban and suspension are re-read at most this often. */
export const ROOM_CHAT_PERMISSION_RECHECK_MS = 60_000;

/** The slice of D1 the re-check needs; only the Cloudflare host binds it, PartyKit does not. */
export interface RoomChatModerationDatabase {
  prepare(query: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } };
}

export function resolveRoomChatModerationDatabase(env: Record<string, unknown>): RoomChatModerationDatabase | null {
  const db = env.DB as Partial<RoomChatModerationDatabase> | null | undefined;
  return db && typeof db.prepare === 'function' ? db as RoomChatModerationDatabase : null;
}

/** True when the account is chat-banned or suspended now (both are point lookups by primary key). */
export async function isRoomChatSenderMuted(db: RoomChatModerationDatabase, userId: string): Promise<boolean> {
  const row = await db.prepare(
    `SELECT EXISTS (SELECT 1 FROM chat_bans WHERE user_id = ?) AS banned,
       (SELECT suspended_at FROM users WHERE id = ?) AS suspended_at`,
  ).bind(userId, userId).first<{ banned: number; suspended_at: string | null }>();
  return Boolean(row?.banned) || Boolean(row?.suspended_at);
}
