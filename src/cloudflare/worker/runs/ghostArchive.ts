import { MAX_GHOST_BYTES, normalizeRunGhost, type RunGhost } from '../../../runs/ghostRace';
import type { D1PreparedStatement, Env, WorkerExecutionContextLike } from '../core/types';
import { recordGhostArchiveOperation } from './ghostArchiveCosts';

export interface GhostArchiveDetails {
  source: 'room' | 'guest_room';
  userId: string | null;
  deaths: number;
  createdAt: string;
}
interface ArchiveRow {
  attempt_id: string; room_id: string; room_version: number; elapsed_ms: number;
  object_key: string; payload_bytes: number; pending_payload_json: string | null;
}

/** Include this statement in the same transaction as successful finalization. */
export function prepareRunGhostArchive(env: Env, ghost: RunGhost, details: GhostArchiveDetails): D1PreparedStatement {
  const payload = JSON.stringify(ghost);
  const bytes = new TextEncoder().encode(payload).byteLength;
  if (bytes > MAX_GHOST_BYTES) throw new Error('Ghost archive payload exceeds its byte limit.');
  const confirmation = details.source === 'room'
    ? `SELECT 1 FROM room_runs WHERE attempt_id = ? AND result = 'completed'
        AND finished_at = ? AND elapsed_ms = ?
        AND COALESCE(verification_status, 'not_required') IN ('passed', 'not_required')`
    : `SELECT 1 FROM guest_run_attempts WHERE attempt_id = ? AND result = 'completed'
        AND verification_status = 'passed' AND finished_at = ?
        AND json_extract(metrics_json, '$.elapsedMs') = ?`;
  return env.DB.prepare(`INSERT OR IGNORE INTO run_ghost_archive
    (attempt_id, source_kind, room_id, room_version, user_id, elapsed_ms, deaths,
     object_key, payload_bytes, pending_payload_json, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${confirmation})`)
    .bind(ghost.attemptId, details.source, ghost.roomId, ghost.roomVersion, details.userId,
      ghost.elapsedMs, details.deaths,
      `v1/${details.source}/${encodeURIComponent(ghost.attemptId)}.json`,
      bytes, payload, details.createdAt, ghost.attemptId, details.createdAt, ghost.elapsedMs);
}

function readGhost(row: ArchiveRow, payload: string): RunGhost | null {
  if (new TextEncoder().encode(payload).byteLength !== row.payload_bytes || row.payload_bytes > MAX_GHOST_BYTES) return null;
  try {
    const ghost = normalizeRunGhost(JSON.parse(payload));
    return ghost?.attemptId === row.attempt_id && ghost.roomId === row.room_id
      && ghost.roomVersion === row.room_version && ghost.elapsedMs === row.elapsed_ms ? ghost : null;
  } catch { return null; }
}

export async function loadArchivedRunGhost(env: Env, attemptId: string): Promise<RunGhost | null> {
  const row = await env.DB.prepare(`SELECT attempt_id, room_id, room_version, elapsed_ms,
    object_key, payload_bytes, pending_payload_json FROM run_ghost_archive WHERE attempt_id = ?`)
    .bind(attemptId).first<ArchiveRow>();
  if (!row || row.payload_bytes > MAX_GHOST_BYTES) return null;
  if (row.pending_payload_json !== null) return readGhost(row, row.pending_payload_json);
  if (!env.RUN_GHOST_BUCKET) return null;
  await recordGhostArchiveOperation(env, 'downloads');
  const object = await env.RUN_GHOST_BUCKET.get(row.object_key);
  if (!object || object.size !== row.payload_bytes) return null;
  return readGhost(row, await object.text());
}

export async function flushRunGhostArchive(env: Env, attemptId?: string): Promise<{ archived: number; failed: number }> {
  const result = { archived: 0, failed: 0 };
  if (!env.RUN_GHOST_BUCKET) return result;
  const query = `SELECT attempt_id, room_id, room_version, elapsed_ms, object_key,
    payload_bytes, pending_payload_json FROM run_ghost_archive
    WHERE archived_at IS NULL ${attemptId ? 'AND attempt_id = ?' : ''}
    ORDER BY created_at, attempt_id LIMIT 25`;
  const statement = env.DB.prepare(query);
  const rows = await (attemptId ? statement.bind(attemptId) : statement).all<ArchiveRow>();
  for (const row of rows.results) {
    try {
      if (row.pending_payload_json === null || !readGhost(row, row.pending_payload_json)) {
        throw new Error('Ghost archive payload does not match its index.');
      }
      // A stable object key makes retries and concurrent uploads idempotent.
      await recordGhostArchiveOperation(env, 'uploads');
      await env.RUN_GHOST_BUCKET.put(row.object_key, row.pending_payload_json, {
        httpMetadata: { contentType: 'application/json' },
      });
      await env.DB.batch([env.DB.prepare(`UPDATE run_ghost_archive
        SET archived_at = ?, pending_payload_json = NULL
        WHERE attempt_id = ? AND archived_at IS NULL`).bind(new Date().toISOString(), row.attempt_id)]);
      result.archived++;
    } catch {
      result.failed++;
      console.error(JSON.stringify({ event: 'run-ghost-archive-upload-failed', attemptId: row.attempt_id }));
    }
  }
  return result;
}

export async function scheduleRunGhostArchive(env: Env, context?: WorkerExecutionContextLike, attemptId?: string): Promise<void> {
  const upload = flushRunGhostArchive(env, attemptId).catch(() => {
    console.error(JSON.stringify({ event: 'run-ghost-archive-retry-failed', attemptId: attemptId ?? null }));
  });
  if (context) context.waitUntil(upload);
  else await upload;
}
