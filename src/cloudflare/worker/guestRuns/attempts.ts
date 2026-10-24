import { deathLocationsJson } from '../insights/deathLocations';
import type { GuestRunFinishResponse, GuestRunStartBody, GuestRunStartResponse } from '../../../guestRooms/runModel';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody } from '../../../runs/model';
import { RANKED_RUN_TRACE_SCHEMA_VERSION } from '../../../runs/verificationTrace';
import { buildRunGhost, supportsGhostRace } from '../../../runs/ghostRace';
import { prepareRunGhostArchive, scheduleRunGhostArchive } from '../runs/ghostArchive';
import { HttpError, normalizePositiveInteger, parseJsonBody } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { normalizeFinalizedCourseRunBody } from '../courses/requestBodies';
import { getRunMetricCapsForSnapshot } from '../runs/points';
import { normalizeFinalizedRunBody, normalizeRunFinishRequestBody } from '../runs/requestBodies';
import { createRunVerificationNonce, verifyCourseRunTrace, verifyRoomRunTrace } from '../runs/verification';
import { hashGuestRunValue, type GuestRunIdentity } from './identity';
import { loadGuestRunSnapshot, type GuestRunSnapshot } from './snapshots';
import { assertSoloRoomRun } from '../runs/coopPolicy';

export const GUEST_RUN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_RUN_MS = 30 * 60 * 1000;
export interface GuestRunRow {
  attempt_id: string; client_run_id: string; content_type: GuestRunStartBody['contentType'];
  content_id: string; content_version: number; snapshot_json: string | null;
  verification_nonce: string; snapshot_hash: string; started_at: string; expires_at: string;
  result: 'active' | RunFinishRequestBody['result'];
  verification_status: 'pending' | GuestRunFinishResponse['verificationStatus'];
  verification_reason: string | null; finish_request_hash: string | null;
}

export async function parseGuestRunStart(request: Request): Promise<GuestRunStartBody> {
  const body = await parseJsonBody<Partial<GuestRunStartBody>>(request, { maxBytes: 8192 });
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || !['room', 'course', 'expanded_room'].includes(body.contentType ?? '')
    || typeof body.contentId !== 'string' || !body.contentId.trim() || body.contentId.length > 128
    || typeof body.clientRunId !== 'string' || !validGuestRequestId(body.clientRunId)) {
    throw new HttpError(400, 'A content target and stable guest run id are required.');
  }
  return { clientRunId: body.clientRunId, contentType: body.contentType as GuestRunStartBody['contentType'],
    contentId: body.contentId.trim(), version: normalizePositiveInteger(body.version, 'version') };
}
export function validGuestRequestId(value: string): boolean {
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
}
function startResponse(row: GuestRunRow): GuestRunStartResponse {
  return { attemptId: row.attempt_id, clientRunId: row.client_run_id, contentType: row.content_type,
    contentId: row.content_id, version: row.content_version, startedAt: row.started_at,
    verificationSchemaVersion: RANKED_RUN_TRACE_SCHEMA_VERSION, verificationNonce: row.verification_nonce,
    snapshotHash: row.snapshot_hash };
}
export async function findGuestRunStart(env: Env, identity: GuestRunIdentity, clientRunId: string): Promise<GuestRunStartResponse> {
  const row = await env.DB.prepare(`SELECT * FROM guest_run_attempts
    WHERE guest_user_id = ? AND recovery_token_hash = ? AND client_run_id = ?`)
    .bind(identity.guestUserId, identity.recoveryTokenHash, clientRunId).first<GuestRunRow>();
  if (!row) throw new HttpError(404, 'Guest run start not found.');
  return startResponse(row);
}
async function existingStart(env: Env, identity: GuestRunIdentity, body: GuestRunStartBody): Promise<GuestRunRow | null> {
  const row = await env.DB.prepare(`SELECT * FROM guest_run_attempts
    WHERE guest_user_id = ? AND recovery_token_hash = ? AND client_run_id = ?`)
    .bind(identity.guestUserId, identity.recoveryTokenHash, body.clientRunId).first<GuestRunRow>();
  if (row && (row.content_type !== body.contentType || row.content_id !== body.contentId || row.content_version !== body.version)) {
    throw new HttpError(409, 'This guest run id already belongs to another target.');
  }
  return row;
}
export async function startGuestRun(env: Env, identity: GuestRunIdentity, body: GuestRunStartBody): Promise<GuestRunStartResponse> {
  const existing = await existingStart(env, identity, body);
  if (existing) return startResponse(existing);
  const context = await loadGuestRunSnapshot(env, body);
  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.parse(now) + GUEST_RUN_RETENTION_MS).toISOString();
  // Only the target version and its verification hash are kept: finish re-reads the immutable version (F330).
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO guest_run_attempts
    (attempt_id, guest_user_id, recovery_token_hash, client_run_id, content_type, content_id, content_version,
     content_title, progress_source_type, progress_source_id, verification_nonce, snapshot_hash, started_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM guest_run_attempts WHERE guest_user_id = ? AND recovery_token_hash = ?
      AND claim_id IS NULL AND expires_at > ? AND result IN ('completed', 'active')) < 100
    RETURNING *`)
    .bind(attemptId, identity.guestUserId, identity.recoveryTokenHash, body.clientRunId, body.contentType,
      body.contentId, body.version, context.title, context.progressSourceType, context.progressSourceId,
      createRunVerificationNonce(), context.snapshotHash, now, expiresAt,
      identity.guestUserId, identity.recoveryTokenHash, now).first<GuestRunRow>();
  if (inserted) return startResponse(inserted);
  // Nothing was inserted: a concurrent retry of this start won, or the pending cap is reached.
  const row = await existingStart(env, identity, body);
  if (!row) throw new HttpError(429, 'Sign in to save your pending clears before starting more guest runs.');
  return startResponse(row);
}
/**
 * The content a run was bound to at start, re-read from its immutable published version and
 * checked against the stored hash. Attempts started before F330 still carry their own copy.
 * A changed or removed version returns null, and the run fails verification.
 */
async function loadAttemptSnapshot(env: Env, row: GuestRunRow): Promise<GuestRunSnapshot | null> {
  if (row.snapshot_json) {
    const snapshot: GuestRunSnapshot = JSON.parse(row.snapshot_json);
    if (snapshot.kind === 'course') {
      const cells = await env.DB.prepare('SELECT snapshot_json FROM guest_run_snapshot_rooms WHERE attempt_id = ?')
        .bind(row.attempt_id).all<{ snapshot_json: string }>();
      snapshot.rooms = cells.results.map(cell => JSON.parse(cell.snapshot_json) as RoomSnapshot);
    }
    return snapshot;
  }
  try {
    const context = await loadGuestRunSnapshot(env, { clientRunId: row.client_run_id, contentType: row.content_type,
      contentId: row.content_id, version: row.content_version });
    return context.snapshotHash === row.snapshot_hash ? context.snapshot : null;
  } catch (error) {
    if (error instanceof HttpError) return null;
    throw error;
  }
}
function finishResponse(row: GuestRunRow): GuestRunFinishResponse {
  if (row.result === 'active' || row.verification_status === 'pending') throw new HttpError(409, 'The guest run has not finished.');
  return { attemptId: row.attempt_id, result: row.result, verificationStatus: row.verification_status,
    verificationReason: row.verification_reason, saved: row.result === 'completed' && row.verification_status === 'passed' };
}
export async function finishGuestRun(env: Env, identity: GuestRunIdentity, attemptId: string, request: Request,
  context?: WorkerExecutionContextLike): Promise<GuestRunFinishResponse> {
  const raw = await parseJsonBody<Partial<RunFinishRequestBody>>(request, { maxBytes: 1536 * 1024 });
  const body = normalizeRunFinishRequestBody(raw);
  const requestHash = await hashGuestRunValue(JSON.stringify(body));
  const select = () => env.DB.prepare(`SELECT * FROM guest_run_attempts
    WHERE attempt_id = ? AND guest_user_id = ? AND recovery_token_hash = ?`)
    .bind(attemptId, identity.guestUserId, identity.recoveryTokenHash);
  const row = await select().first<GuestRunRow>();
  if (!row) throw new HttpError(404, 'Guest run not found.');
  if (row.result !== 'active') {
    if (row.finish_request_hash !== requestHash) throw new HttpError(409, 'This guest run has already finished with a different result.');
    await scheduleRunGhostArchive(env, context, attemptId);
    return finishResponse(row);
  }
  const now = new Date().toISOString();
  if (row.expires_at <= now) {
    throw new HttpError(410, 'This guest run expired. Replay the room to save a new clear.');
  }
  const snapshot = await loadAttemptSnapshot(env, row);
  if (snapshot) for (const room of snapshot.kind === 'room' ? [snapshot.room] : snapshot.rooms) assertSoloRoomRun(room);
  // Guest clears can arrive after a lost reply or offline queue replay. Network wait is
  // not simulated play time. Use the captured duration with the same strict physics
  // verifier, bounded by the original server start and the 30-minute trace ceiling.
  // These attempts never enter ranked tables or receive time/PB bonuses.
  const elapsedMs = body.elapsedMs;
  const observedElapsedMs = Math.max(0, Date.parse(now) - Date.parse(row.started_at));
  const durationPossible = elapsedMs <= MAX_RUN_MS && elapsedMs <= observedElapsedMs + 600;
  let verificationStatus: GuestRunFinishResponse['verificationStatus'] = 'failed';
  let reason: string | null = body.result !== 'completed' ? 'not_completed' : snapshot ? 'missing_trace' : 'snapshot_changed';
  let metrics = { elapsedMs, deaths: body.deaths, collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 };
  if (snapshot && body.result === 'completed' && !durationPossible) reason = 'trace_duration';
  if (snapshot && body.result === 'completed' && body.verificationTrace && durationPossible) {
    const binding = { verificationNonce: row.verification_nonce, verificationSnapshotHash: row.snapshot_hash };
    const verified = snapshot.kind === 'room'
      ? await verifyRoomRunTrace({ trace: body.verificationTrace, binding, room: snapshot.room, elapsedMs, deaths: body.deaths })
      : await verifyCourseRunTrace({ trace: body.verificationTrace, binding, course: snapshot.course,
        roomsById: new Map(snapshot.rooms.map(room => [room.id, room])), elapsedMs, deaths: body.deaths });
    verificationStatus = verified.status; reason = verified.reason;
    if (verified.status === 'passed') {
      const derived = { ...body, elapsedMs, ...verified.derivedMetrics };
      try {
        if (snapshot.kind === 'room' && snapshot.room.goal) {
          normalizeFinalizedRunBody(snapshot.room.goal, derived, getRunMetricCapsForSnapshot(snapshot.room), body.elapsedMs);
        } else if (snapshot.kind === 'course') {
          normalizeFinalizedCourseRunBody(snapshot.course.goal, derived, body.elapsedMs);
        }
        metrics = { elapsedMs, deaths: body.deaths, ...verified.derivedMetrics };
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        verificationStatus = 'failed'; reason = 'trace_goal';
      }
    }
  }
  const ghost = body.result === 'completed' && verificationStatus === 'passed'
    && snapshot?.kind === 'room' && supportsGhostRace(snapshot.room.goal) && body.verificationTrace
    ? buildRunGhost({ attemptId, roomId: snapshot.room.id, roomVersion: row.content_version,
      displayName: 'Guest', avatarId: 'default-player', elapsedMs }, body.verificationTrace) : null;
  const results = await env.DB.batch<{ results?: GuestRunRow[] }>([
    env.DB.prepare(`UPDATE guest_run_attempts SET result = ?, verification_status = ?, verification_reason = ?,
      finish_request_hash = ?, finished_at = ?, expires_at = ?, metrics_json = ?, insight_deaths_json = ?, snapshot_json = NULL
      WHERE attempt_id = ? AND result = 'active'`)
      .bind(body.result, verificationStatus, reason, requestHash, now,
        new Date(Date.parse(now) + GUEST_RUN_RETENTION_MS).toISOString(), JSON.stringify(metrics), deathLocationsJson(body.verificationTrace, { verificationNonce: row.verification_nonce, snapshotHash: row.snapshot_hash },
          !snapshot ? [] : snapshot.kind === 'room' ? [snapshot.room.coordinates] : snapshot.course.roomRefs.map(ref => ref.coordinates), elapsedMs, metrics.deaths), attemptId),
    ...(ghost ? [prepareRunGhostArchive(env, ghost, {
      source: 'guest_room', userId: null, deaths: metrics.deaths, createdAt: now,
    })] : []),
    // Only attempts started before F330 have cell copies to discard.
    ...(row.snapshot_json ? [env.DB.prepare('DELETE FROM guest_run_snapshot_rooms WHERE attempt_id = ?').bind(attemptId)] : []),
    // The row as this batch leaves it: finished by this request, or by one that raced it (F333).
    select(),
  ]);
  const final = results.at(-1)?.results?.[0];
  if (!final || final.finish_request_hash !== requestHash) throw new HttpError(409, 'Another request already finished this guest run.');
  if (ghost) await scheduleRunGhostArchive(env, context, attemptId);
  return finishResponse(final);
}
export async function pruneGuestRuns(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM guest_run_attempts WHERE claim_id IS NULL AND
      (expires_at <= ? OR result IN ('failed', 'abandoned'))`).bind(now),
  ]);
}
