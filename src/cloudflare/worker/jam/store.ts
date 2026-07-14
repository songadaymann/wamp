import type { JamSubmissionPublic } from '../../../jam/model';
import type { Env } from '../core/types';

interface JamSubmissionRow {
  id: string;
  username: string;
  room_x: number;
  room_y: number;
  room_url: string;
  created_at: string;
  updated_at: string;
}

export async function upsertJamSubmission(
  env: Env,
  input: {
    jamSlug: string;
    userId: string;
    username: string;
    email: string;
    roomX: number;
    roomY: number;
    roomUrl: string;
    roomReferenceInput: string;
    roomClaimedAt: string;
    ipHash: string | null;
    userAgent: string | null;
    turnstileVerifiedAt: string | null;
    nowIso: string;
  },
): Promise<{ submission: JamSubmissionPublic; updated: boolean }> {
  const existing = await env.JAM_DB.prepare(
    'SELECT id, created_at FROM jam_submissions WHERE user_id = ? LIMIT 1',
  )
    .bind(input.userId)
    .first<{ id: string; created_at: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.created_at ?? input.nowIso;

  await env.JAM_DB.prepare(
    `
      INSERT INTO jam_submissions (
        id,
        jam_slug,
        user_id,
        username,
        email,
        room_x,
        room_y,
        room_url,
        room_reference_input,
        room_claimed_at,
        rules_accepted,
        ip_hash,
        user_agent,
        turnstile_verified_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        jam_slug = excluded.jam_slug,
        username = excluded.username,
        email = excluded.email,
        room_x = excluded.room_x,
        room_y = excluded.room_y,
        room_url = excluded.room_url,
        room_reference_input = excluded.room_reference_input,
        room_claimed_at = excluded.room_claimed_at,
        rules_accepted = 1,
        ip_hash = excluded.ip_hash,
        user_agent = excluded.user_agent,
        turnstile_verified_at = excluded.turnstile_verified_at,
        updated_at = excluded.updated_at
    `,
  )
    .bind(
      id,
      input.jamSlug,
      input.userId,
      input.username,
      input.email,
      input.roomX,
      input.roomY,
      input.roomUrl,
      input.roomReferenceInput,
      input.roomClaimedAt,
      input.ipHash,
      input.userAgent,
      input.turnstileVerifiedAt,
      createdAt,
      input.nowIso,
    )
    .all();

  const row = await env.JAM_DB.prepare(
    `
      SELECT id, username, room_x, room_y, room_url, created_at, updated_at
      FROM jam_submissions
      WHERE id = ?
      LIMIT 1
    `,
  )
    .bind(id)
    .first<JamSubmissionRow>();

  if (!row) {
    throw new Error('Jam submission was not saved.');
  }

  return {
    submission: {
      id: row.id,
      username: row.username,
      roomCoordinates: { x: Number(row.room_x), y: Number(row.room_y) },
      roomUrl: row.room_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    updated: Boolean(existing),
  };
}
