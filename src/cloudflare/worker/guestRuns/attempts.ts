import type { GuestRunFinishResponse, GuestRunStartBody, GuestRunStartResponse } from '../../../guestRooms/runModel';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { RunFinishRequestBody } from '../../../runs/model';
import { RANKED_RUN_TRACE_SCHEMA_VERSION } from '../../../runs/verificationTrace';
import { HttpError, normalizePositiveInteger, parseJsonBody } from '../core/http';
import type { Env } from '../core/types';
import { computeEffectiveElapsedMs, normalizeFinalizedCourseRunBody } from '../courses/requestBodies';
import { getRunMetricCapsForSnapshot } from '../runs/points';
import { normalizeFinalizedRunBody, normalizeRunFinishRequestBody } from '../runs/requestBodies';
import { createRunVerificationNonce, verifyCourseRunTrace, verifyRoomRunTrace } from '../runs/verification';
import { hashGuestRunValue, type GuestRunIdentity } from './identity';
import { loadGuestRunSnapshot, type GuestRunSnapshot } from './snapshots';

export const GUEST_RUN_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_RUN_MS = 30 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 1536 * 1024;
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
function snapshotJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new HttpError(409, 'This published snapshot is too large to save guest progress.');
  }
  return json;
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
  const snapshot = context.snapshot;
  const roomJson = snapshot.kind === 'course'
    ? snapshot.rooms.map(room => ({ roomId: room.id, json: snapshotJson(room) })) : [];
  const json = snapshotJson(snapshot.kind === 'course' ? { ...snapshot, rooms: [] } : snapshot);
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO guest_run_attempts
      (attempt_id, guest_user_id, recovery_token_hash, client_run_id, content_type, content_id, content_version,
       content_title, progress_source_type, progress_source_id, snapshot_json, verification_nonce, snapshot_hash, started_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM guest_run_attempts WHERE guest_user_id = ? AND recovery_token_hash = ?
        AND claim_id IS NULL AND expires_at > ? AND (result = 'completed' OR (result = 'active' AND started_at > ?))) < 100`)
      .bind(attemptId, identity.guestUserId, identity.recoveryTokenHash, body.clientRunId, body.contentType,
        body.contentId, body.version, context.title, context.progressSourceType, context.progressSourceId,
        json, createRunVerificationNonce(), context.snapshotHash, now, expiresAt,
        identity.guestUserId, identity.recoveryTokenHash, now, new Date(Date.parse(now) - MAX_RUN_MS).toISOString()),
    ...roomJson.map(room => env.DB.prepare(`INSERT INTO guest_run_snapshot_rooms (attempt_id, room_id, snapshot_json)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM guest_run_attempts WHERE attempt_id = ?)`)
      .bind(attemptId, room.roomId, room.json, attemptId)),
  ]);
  const row = await existingStart(env, identity, body);
  if (!row) throw new HttpError(429, 'Sign in to save your pending clears before starting more guest runs.');
  return startResponse(row);
}
function finishResponse(row: GuestRunRow): GuestRunFinishResponse {
  if (row.result === 'active' || row.verification_status === 'pending') throw new HttpError(409, 'The guest run has not finished.');
  return { attemptId: row.attempt_id, result: row.result, verificationStatus: row.verification_status,
    verificationReason: row.verification_reason, saved: row.result === 'completed' && row.verification_status === 'passed' };
}
export async function finishGuestRun(env: Env, identity: GuestRunIdentity, attemptId: string, request: Request): Promise<GuestRunFinishResponse> {
  const raw = await parseJsonBody<Partial<RunFinishRequestBody>>(request, { maxBytes: 1536 * 1024 });
  const body = normalizeRunFinishRequestBody(raw);
  const requestHash = await hashGuestRunValue(JSON.stringify(body));
  const load = () => env.DB.prepare(`SELECT * FROM guest_run_attempts
    WHERE attempt_id = ? AND guest_user_id = ? AND recovery_token_hash = ?`)
    .bind(attemptId, identity.guestUserId, identity.recoveryTokenHash).first<GuestRunRow>();
  const row = await load();
  if (!row) throw new HttpError(404, 'Guest run not found.');
  if (row.result !== 'active') {
    if (row.finish_request_hash !== requestHash) throw new HttpError(409, 'This guest run has already finished with a different result.');
    return finishResponse(row);
  }
  const now = new Date().toISOString();
  if (row.expires_at <= now || Date.parse(now) - Date.parse(row.started_at) > MAX_RUN_MS + 60_000) {
    throw new HttpError(410, 'This guest run expired. Replay the room to save a new clear.');
  }
  if (!row.snapshot_json) throw new HttpError(409, 'The guest run snapshot is unavailable.');
  const snapshot: GuestRunSnapshot = JSON.parse(row.snapshot_json);
  if (snapshot.kind === 'course') {
    const cells = await env.DB.prepare('SELECT snapshot_json FROM guest_run_snapshot_rooms WHERE attempt_id = ?')
      .bind(attemptId).all<{ snapshot_json: string }>();
    snapshot.rooms = cells.results.map(cell => JSON.parse(cell.snapshot_json) as RoomSnapshot);
  }
  const elapsedMs = computeEffectiveElapsedMs(row.started_at, now, body.elapsedMs);
  let verificationStatus: GuestRunFinishResponse['verificationStatus'] = 'failed';
  let reason: string | null = body.result === 'completed' ? 'missing_trace' : 'not_completed';
  let metrics = { elapsedMs, deaths: body.deaths, collectiblesCollected: 0, enemyCollectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 };
  if (body.result === 'completed' && body.verificationTrace) {
    const binding = { verificationNonce: row.verification_nonce, verificationSnapshotHash: row.snapshot_hash };
    const verified = snapshot.kind === 'room'
      ? await verifyRoomRunTrace({ trace: body.verificationTrace, binding, room: snapshot.room, elapsedMs })
      : await verifyCourseRunTrace({ trace: body.verificationTrace, binding, course: snapshot.course,
        roomsById: new Map(snapshot.rooms.map(room => [room.id, room])), elapsedMs });
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
  await env.DB.batch([
    env.DB.prepare(`UPDATE guest_run_attempts SET result = ?, verification_status = ?, verification_reason = ?,
      finish_request_hash = ?, finished_at = ?, expires_at = ?, metrics_json = ?, snapshot_json = NULL
      WHERE attempt_id = ? AND result = 'active'`)
      .bind(body.result, verificationStatus, reason, requestHash, now,
        new Date(Date.parse(now) + GUEST_RUN_RETENTION_MS).toISOString(), JSON.stringify(metrics), attemptId),
    env.DB.prepare('DELETE FROM guest_run_snapshot_rooms WHERE attempt_id = ?').bind(attemptId),
  ]);
  const final = await load();
  if (!final || final.finish_request_hash !== requestHash) throw new HttpError(409, 'Another request already finished this guest run.');
  return finishResponse(final);
}
export async function pruneGuestRuns(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM guest_run_attempts WHERE claim_id IS NULL AND
      (expires_at <= ? OR (result = 'active' AND started_at < ?) OR result IN ('failed', 'abandoned'))`)
      .bind(now, new Date(Date.parse(now) - MAX_RUN_MS - 60_000).toISOString()),
  ]);
}
