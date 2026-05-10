import type { GuestbookEntry } from '../../../guestbook/model';
import type { Env, GuestbookEntryRow } from '../core/types';

export async function listGuestbookEntries(
  env: Env,
  limit: number,
): Promise<GuestbookEntry[]> {
  const result = await env.DB.prepare(
    `
      SELECT id, display_name, body, user_id, created_at
      FROM guestbook_entries
      WHERE hidden_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `
  )
    .bind(limit)
    .all<GuestbookEntryRow>();

  return result.results.map(mapGuestbookEntryRow);
}

export async function createGuestbookEntry(
  env: Env,
  input: {
    displayName: string;
    body: string;
    userId: string | null;
    guestSessionId: string | null;
    ipHash: string | null;
    userAgent: string | null;
    turnstileVerifiedAt: string | null;
    createdAt: string;
  },
): Promise<GuestbookEntry> {
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO guestbook_entries (
          id,
          display_name,
          body,
          user_id,
          guest_session_id,
          ip_hash,
          user_agent,
          turnstile_verified_at,
          created_at,
          hidden_at,
          hidden_by_user_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `
    ).bind(
      id,
      input.displayName,
      input.body,
      input.userId,
      input.guestSessionId,
      input.ipHash,
      input.userAgent,
      input.turnstileVerifiedAt,
      input.createdAt,
    ),
  ]);

  return {
    id,
    displayName: input.displayName,
    body: input.body,
    createdAt: input.createdAt,
    signedIn: Boolean(input.userId),
  };
}

export async function hideGuestbookEntry(
  env: Env,
  entryId: string,
  hiddenByUserId: string | null,
  hiddenAt: string,
): Promise<boolean> {
  const existing = await env.DB.prepare(
    `
      SELECT id
      FROM guestbook_entries
      WHERE id = ?
        AND hidden_at IS NULL
      LIMIT 1
    `
  )
    .bind(entryId)
    .first<{ id: string }>();
  if (!existing) {
    return false;
  }

  await env.DB.prepare(
    `
      UPDATE guestbook_entries
      SET hidden_at = ?, hidden_by_user_id = ?
      WHERE id = ?
        AND hidden_at IS NULL
    `
  )
    .bind(hiddenAt, hiddenByUserId, entryId)
    .all();

  return true;
}

export async function countRecentGuestbookEntriesForIp(
  env: Env,
  ipHash: string,
  sinceIso: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM guestbook_entries
      WHERE ip_hash = ?
        AND created_at >= ?
    `
  )
    .bind(ipHash, sinceIso)
    .first<{ count: number }>();

  return Number(row?.count ?? 0);
}

export async function countRecentGuestbookEntriesForSession(
  env: Env,
  guestSessionId: string,
  sinceIso: string,
): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS count
      FROM guestbook_entries
      WHERE guest_session_id = ?
        AND created_at >= ?
    `
  )
    .bind(guestSessionId, sinceIso)
    .first<{ count: number }>();

  return Number(row?.count ?? 0);
}

function mapGuestbookEntryRow(row: GuestbookEntryRow): GuestbookEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    body: row.body,
    createdAt: row.created_at,
    signedIn: Boolean(row.user_id),
  };
}
