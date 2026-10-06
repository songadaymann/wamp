import { buildRunGhost, MAX_GHOST_BYTES, normalizeRunGhost, supportsGhostRace,
  type GhostOption, type RoomGhostResponse } from '../../../runs/ghostRace';
import { normalizeRankedRunVerificationTrace } from '../../../runs/verificationTrace';
import type { RoomRunRecord, RunFinishRequestBody } from '../../../runs/model';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { getCoordinatesFromRequest, jsonResponse, parseOptionalPositiveIntegerQueryParam } from '../core/http';
import { loadOptionalRequestAuth, requireOptionalScope } from '../auth/request';
import { loadRoomRecord } from '../rooms/store';
import { resolveAggregatedRoomLeaderboardSelection } from './roomLeaderboardAggregation';
import { loadRankedRoomLeaderboardRows, loadViewerRankedRoomLeaderboardRow } from './leaderboards';
import { verifyRoomRunTrace } from './verification';

export async function savePersonalBestGhost(
  env: Env, run: RoomRunRecord, room: RoomSnapshot, body: RunFinishRequestBody,
  avatarId: string, alreadyVerified: boolean, reportedElapsedMs: number,
): Promise<void> {
  if (!supportsGhostRace(room.goal) || !body.verificationTrace || run.elapsedMs === null) return;
  const trace = body.verificationTrace;
  if (!alreadyVerified) {
    // The leaderboard keeps its server-time floor; the recording follows the
    // client's reported simulation clock, as it did before finalization.
    const result = await verifyRoomRunTrace({ trace, room, elapsedMs: reportedElapsedMs, deaths: run.deaths,
      binding: { verificationNonce: run.verificationNonce ?? null, verificationSnapshotHash: run.verificationSnapshotHash ?? null } });
    if (result.status !== 'passed') return;
  }
  const ghost = buildRunGhost({ attemptId: run.attemptId, roomId: run.roomId, roomVersion: run.roomVersion,
    displayName: run.userDisplayName, avatarId, elapsedMs: run.elapsedMs }, trace);
  if (!ghost) return;
  await env.DB.batch([env.DB.prepare(`
    INSERT INTO run_ghosts (room_id, room_version, user_id, attempt_id, elapsed_ms, deaths, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (room_id, room_version, user_id) DO UPDATE SET
      attempt_id = excluded.attempt_id, elapsed_ms = excluded.elapsed_ms, deaths = excluded.deaths,
      payload_json = excluded.payload_json, created_at = excluded.created_at
    WHERE excluded.elapsed_ms < run_ghosts.elapsed_ms
      OR (excluded.elapsed_ms = run_ghosts.elapsed_ms AND excluded.deaths < run_ghosts.deaths)
  `).bind(run.roomId, run.roomVersion, run.userId, run.attemptId, run.elapsedMs, run.deaths,
    JSON.stringify(ghost), run.finishedAt)]);
}

type GhostEntry = { attempt_id: string; room_version: number; user_display_name: string; elapsed_ms: number };
export async function loadGhostOption(env: Env, roomId: string, equivalents: number[], entry: GhostEntry | null): Promise<GhostOption> {
  if (!entry) return { ghost: null, reason: 'no_run' };
  if (!equivalents.includes(entry.room_version)) return { ghost: null, reason: 'layout_changed' };
  const row = await env.DB.prepare('SELECT payload_json FROM run_ghosts WHERE attempt_id = ? AND length(payload_json) <= ? LIMIT 1')
    .bind(entry.attempt_id, MAX_GHOST_BYTES).first<{ payload_json: string }>();
  let ghost = null;
  try { ghost = row ? normalizeRunGhost(JSON.parse(row.payload_json)) : null; } catch { /* Unavailable, never break Play. */ }
  if (!ghost) {
    // Read only verified ranked breadcrumbs, never the private guest analytics replay table.
    const audit = await env.DB.prepare(`SELECT trace_json FROM run_verification_audit
      WHERE attempt_id = ? AND run_kind = 'room' AND status = 'passed'
        AND length(trace_json) <= 600000 ORDER BY created_at DESC LIMIT 1`)
      .bind(entry.attempt_id).first<{ trace_json: string }>();
    try {
      const trace = audit ? normalizeRankedRunVerificationTrace(JSON.parse(audit.trace_json)) : null;
      if (trace) ghost = buildRunGhost({ attemptId: entry.attempt_id, roomId,
        roomVersion: entry.room_version, displayName: entry.user_display_name, avatarId: 'default-player',
        elapsedMs: entry.elapsed_ms }, trace);
    } catch { /* Historical malformed recordings remain unavailable. */ }
  }
  if (ghost?.attemptId !== entry.attempt_id || ghost.roomId !== roomId
    || ghost.roomVersion !== entry.room_version || ghost.elapsedMs !== entry.elapsed_ms) ghost = null;
  return { ghost, reason: ghost ? null : 'no_recording' };
}

export async function handleRoomGhosts(request: Request, url: URL, env: Env, roomId: string): Promise<Response> {
  const auth = await loadOptionalRequestAuth(env, request);
  requireOptionalScope(auth, 'leaderboards:read', 'race room ghosts');
  const record = await loadRoomRecord(env, roomId, getCoordinatesFromRequest(roomId, url.searchParams),
    auth?.user.id ?? null, auth?.user.walletAddress ?? null);
  const selection = resolveAggregatedRoomLeaderboardSelection(record,
    parseOptionalPositiveIntegerQueryParam(url.searchParams, 'version'));
  const unavailable: GhostOption = { ghost: null, reason: 'unsupported' };
  const response: RoomGhostResponse = { roomId, roomVersion: selection.roomVersion, top: unavailable, personal: unavailable };
  if (supportsGhostRace(selection.snapshot.goal)) {
    const [topRows, best] = await Promise.all([
      loadRankedRoomLeaderboardRows(env, roomId, selection.leaderboardFamilyVersions, selection.snapshot.goal!, 1),
      auth ? loadViewerRankedRoomLeaderboardRow(env, roomId, selection.leaderboardFamilyVersions,
        selection.snapshot.goal!, auth.user.id) : Promise.resolve(null),
    ]);
    [response.top, response.personal] = await Promise.all([
      loadGhostOption(env, roomId, selection.equivalentRoomVersions, topRows[0] ?? null),
      auth ? loadGhostOption(env, roomId, selection.equivalentRoomVersions, best) : Promise.resolve({ ghost: null, reason: 'sign_in' } as GhostOption),
    ]);
  }
  return jsonResponse(request, response, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Origin, Cookie, Authorization' } });
}
