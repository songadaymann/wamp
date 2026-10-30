import type { GuestbookEntry } from '../../../guestbook/model';
import type { Env, GuestbookEntryRow } from '../core/types';
import { isAccountGuestbookName } from './names';

export async function listGuestbookEntries(
  env: Env,
  limit: number,
): Promise<GuestbookEntry[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        guestbook_entries.id,
        guestbook_entries.display_name,
        guestbook_entries.body,
        guestbook_entries.user_id,
        guestbook_entries.created_at,
        users.display_name AS account_display_name
      FROM guestbook_entries
      LEFT JOIN users
        ON users.id = guestbook_entries.user_id
      WHERE guestbook_entries.hidden_at IS NULL
      ORDER BY guestbook_entries.created_at DESC, guestbook_entries.id DESC
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
    /** The signed-in account's display name now, for the signed-in mark in the reply. */
    accountDisplayName: string | null;
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
    signedIn: Boolean(input.userId) && isAccountGuestbookName(input.displayName, input.accountDisplayName),
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

function mapGuestbookEntryRow(row: GuestbookEntryRow): GuestbookEntry {
  return {
    id: row.id,
    displayName: row.display_name,
    body: row.body,
    createdAt: row.created_at,
    // Decided at read time, against the account's current name, in the same query.
    signedIn: Boolean(row.user_id) && isAccountGuestbookName(row.display_name, row.account_display_name),
  };
}
