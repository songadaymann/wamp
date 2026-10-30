import { createDefaultRoomSnapshot, type RoomRecord, type RoomSnapshot } from '../../../persistence/roomModel';
import { HttpError } from '../core/http';
import type { D1PreparedStatement, Env } from '../core/types';

export const HIDDEN_VERSION_TITLE = 'Hidden by moderation';

/** What players get instead of a hidden version: an empty room with the same identity. */
export function hiddenVersionSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  return {
    ...createDefaultRoomSnapshot(snapshot.id, snapshot.coordinates),
    title: HIDDEN_VERSION_TITLE,
    version: snapshot.version,
    status: snapshot.status,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    publishedAt: snapshot.publishedAt,
  };
}

/** A room record as players see it: hidden versions keep their place in History but not their content. */
export async function presentRoomRecordVersions<T extends Pick<RoomRecord, 'versions'>>(env: Env, roomId: string, record: T): Promise<T> {
  if (record.versions.length === 0) return record;
  const rows = await env.DB.prepare('SELECT version FROM room_versions WHERE room_id = ? AND redacted_at IS NOT NULL')
    .bind(roomId).all<{ version: number }>();
  if (rows.results.length === 0) return record;
  const hidden = new Set(rows.results.map((row) => Number(row.version)));
  return {
    ...record,
    versions: record.versions.map((entry) => (hidden.has(entry.version)
      ? { ...entry, snapshot: hiddenVersionSnapshot(entry.snapshot) }
      : entry)),
  };
}

/** SET clause shared by hiding and showing: the title column is swapped so every list shows the hidden title. */
const HIDE_SET = `redacted_at = ?,
  redacted_title = CASE WHEN redacted_at IS NULL THEN title ELSE redacted_title END,
  title = '${HIDDEN_VERSION_TITLE}'`;
const SHOW_SET = `redacted_at = NULL,
  title = CASE WHEN redacted_at IS NOT NULL THEN redacted_title ELSE title END,
  redacted_title = NULL`;

export async function isRoomVersionRedacted(env: Env, roomId: string, version: number): Promise<boolean> {
  const row = await env.DB.prepare('SELECT redacted_at FROM room_versions WHERE room_id = ? AND version = ? LIMIT 1')
    .bind(roomId, version)
    .first<{ redacted_at: string | null }>();
  return Boolean(row?.redacted_at);
}

export async function assertRoomVersionNotRedacted(env: Env, roomId: string, version: number): Promise<void> {
  if (await isRoomVersionRedacted(env, roomId, version)) {
    throw new HttpError(409, 'That version was hidden by moderation and cannot be restored.');
  }
}

/**
 * Hides one published version. The room's current published version cannot be hidden: restore an
 * earlier version first, so the room itself never points at hidden content.
 */
export async function prepareRoomVersionRedaction(
  env: Env,
  roomId: string,
  version: number,
  hidden: boolean,
  now: string,
): Promise<D1PreparedStatement> {
  const row = await env.DB.prepare(
    `SELECT v.version, json_extract(r.published_json, '$.version') AS current_version
     FROM room_versions v JOIN rooms r ON r.id = v.room_id WHERE v.room_id = ? AND v.version = ? LIMIT 1`,
  ).bind(roomId, version).first<{ version: number; current_version: number | null }>();
  if (!row) throw new HttpError(404, 'Room version not found.');
  if (hidden && Number(row.current_version) === version) {
    throw new HttpError(409, 'Restore an earlier version before hiding the current one.');
  }
  return hidden
    ? env.DB.prepare(`UPDATE room_versions SET ${HIDE_SET} WHERE room_id = ? AND version = ?`).bind(now, roomId, version)
    : env.DB.prepare(`UPDATE room_versions SET ${SHOW_SET} WHERE room_id = ? AND version = ?`).bind(roomId, version);
}

/** A room whose leaderboard was pinned to a version that is now hidden goes back to its default. */
export function prepareHiddenCanonicalVersionReset(env: Env, roomId: string): D1PreparedStatement {
  return env.DB.prepare(`UPDATE rooms SET canonical_version = NULL WHERE id = ? AND canonical_version IN
    (SELECT version FROM room_versions WHERE room_id = ? AND redacted_at IS NOT NULL)`).bind(roomId, roomId);
}

/**
 * After a bulk restore, that user's versions of the room are hidden too: every version of theirs
 * after the restore target, or (for rooms someone else has published over since) every version of
 * theirs from the undo window. The room's current version is never hidden.
 */
export function prepareUserVersionsRedaction(
  env: Env,
  roomId: string,
  userId: string,
  scope: { afterVersion: number } | { since: string },
  now: string,
): D1PreparedStatement {
  const [condition, value] = 'afterVersion' in scope ? ['version > ?', scope.afterVersion] : ['created_at >= ?', scope.since];
  return env.DB.prepare(`UPDATE room_versions SET ${HIDE_SET}
    WHERE room_id = ? AND published_by_user_id = ? AND ${condition} AND redacted_at IS NULL
      AND version <> COALESCE((SELECT json_extract(published_json, '$.version') FROM rooms WHERE id = ?), -1)`)
    .bind(now, roomId, userId, value, roomId);
}
