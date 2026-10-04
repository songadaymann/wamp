import { cloneRoomSnapshot, createRoomRecordFromCurrent, isRoomSnapshotBlank, roomIdFromCoordinates, type RoomCoordinates, type RoomSnapshot } from '../../../persistence/roomModel';
import type { GuestRoomDraftClaimBody, GuestRoomDraftClaimResponse } from '../../../guestRooms/model';
import { WAMP_PRIME_WORLD_ID } from '../../../worlds/model';
import { buildRoomMutationActor } from '../auth/actors';
import { HttpError, validateRoomSnapshotForWrite } from '../core/http';
import type { Env, RequestAuth } from '../core/types';
import type { GuestRunIdentity } from '../guestRuns/identity';
import { enforceRoomMutationGuardrails } from '../rooms/guardrails';
import { loadRoomCurrent, parseStoredSnapshot, saveDraft } from '../rooms/store';
import { rowToGuestRoomDraftSummary, type GuestRoomDraftRow } from './store';

interface ClaimRow { user_id: string; room_id: string; claimed_at: string; applied: number }
interface TargetRow { id: string; draft_json: string; claimer_user_id: string | null; published_json: string | null; minted_token_id: string | null }

/** The saved guest snapshot, room claim and retry receipt share one D1 transaction. */
export async function claimGuestRoomDraft(
  sourceEnv: Env, identity: GuestRunIdentity, auth: RequestAuth, draftId: string, body: GuestRoomDraftClaimBody,
): Promise<GuestRoomDraftClaimResponse> {
  if (body.expectedUserId !== auth.user.id) throw new HttpError(409, 'The signed-in account changed. Refresh before transferring your draft.');
  const env = { ...sourceEnv, DB: sourceEnv.DB.withSession?.('first-primary') ?? sourceEnv.DB };
  const guest = await env.DB.prepare(`SELECT * FROM guest_room_drafts WHERE id = ? AND guest_user_id = ?
    AND recovery_token_hash = ? AND hidden_at IS NULL`).bind(draftId, identity.guestUserId, identity.recoveryTokenHash).first<GuestRoomDraftRow>();
  if (!guest) throw new HttpError(404, 'Guest room draft not found.');
  const receipt = await loadReceipt(env, draftId, auth);
  if (receipt) return receipt;
  if (guest.status !== 'active') throw new HttpError(409, 'This guest draft is no longer available to transfer.');
  const draft = rowToGuestRoomDraftSummary(guest);
  if (!draft) throw new HttpError(400, 'The saved guest draft could not be read.');
  const coordinates = validateCoordinates(body.coordinates ?? { x: guest.room_x, y: guest.room_y });
  const roomId = roomIdFromCoordinates(coordinates);
  const snapshot = { ...draft.snapshot, id: roomId, coordinates, status: 'draft' as const, publishedAt: null };
  const target = await loadTarget(env, coordinates);
  const alreadySaved = isMatchingOwnedDraft(target, snapshot, auth.user.id);
  if ((!isAvailable(target) && !alreadySaved) || await isNumberedWorldSpot(env, roomId)) return conflict(env, auth, draftId, coordinates, 'occupied');
  if (!alreadySaved && !await isFrontier(env, coordinates)) return conflict(env, auth, draftId, coordinates, 'not_frontier');

  validateRoomSnapshotForWrite(snapshot, roomId);
  await enforceRoomMutationGuardrails(env, snapshot, auth.user.id, auth.source, null);
  const now = new Date().toISOString();
  const before = env.DB.prepare(`INSERT INTO guest_room_draft_claims
    (guest_draft_id, user_id, room_id, claimed_at, applied, eligible)
    VALUES (?, ?, ?, ?, 0, CASE WHEN
      EXISTS (SELECT 1 FROM guest_room_drafts WHERE id = ? AND guest_user_id = ? AND recovery_token_hash = ?
        AND status = 'active' AND hidden_at IS NULL AND updated_at = ? AND snapshot_json = ?)
      AND ((? IS NULL AND NOT EXISTS (SELECT 1 FROM rooms WHERE id = ? OR (x = ? AND y = ?))) OR
        EXISTS (SELECT 1 FROM rooms WHERE id = ? AND x = ? AND y = ? AND draft_json = ?
          AND claimer_user_id IS ? AND published_json IS NULL AND minted_token_id IS NULL))
      AND NOT EXISTS (SELECT 1 FROM world_room_claims WHERE room_id = ? AND world_id <> ?)
      THEN 1 ELSE 0 END)
    ON CONFLICT(guest_draft_id) DO UPDATE SET eligible = 0`)
    .bind(draftId, auth.user.id, roomId, now, draftId, identity.guestUserId, identity.recoveryTokenHash,
      guest.updated_at, guest.snapshot_json, target?.id ?? null, roomId, coordinates.x, coordinates.y,
      roomId, coordinates.x, coordinates.y, target?.draft_json ?? null, target?.claimer_user_id ?? null, roomId, WAMP_PRIME_WORLD_ID);
  try {
    await saveDraft(env, snapshot, buildRoomMutationActor(auth), false, {
      transactionStatementsBefore: [before],
      transactionStatementsAfter: [
        env.DB.prepare(`UPDATE guest_room_drafts SET status = 'claimed', claimed_by_user_id = ?,
          claimed_room_id = ?, claimed_at = ?, updated_at = ? WHERE id = ?`)
          .bind(auth.user.id, roomId, now, now, draftId),
        env.DB.prepare('UPDATE guest_room_draft_claims SET applied = 1 WHERE guest_draft_id = ?').bind(draftId),
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('guest_draft_claim_eligible') || error instanceof HttpError && (error.status === 409 || error.status === 403)) {
      const completed = await loadReceipt(env, draftId, auth);
      if (completed) return completed;
      const latestTarget = await loadTarget(env, coordinates);
      const latestAlreadySaved = isMatchingOwnedDraft(latestTarget, snapshot, auth.user.id);
      if ((!isAvailable(latestTarget) && !latestAlreadySaved) || await isNumberedWorldSpot(env, roomId)) {
        return conflict(env, auth, draftId, coordinates, 'occupied');
      }
      if (!latestAlreadySaved && !await isFrontier(env, coordinates)) return conflict(env, auth, draftId, coordinates, 'not_frontier');
      if (error instanceof HttpError && error.status === 403) throw error;
      throw new HttpError(409, 'Your guest draft changed in another tab. Reload it before transferring.');
    }
    throw error;
  }
  const completed = await loadReceipt(env, draftId, auth);
  if (!completed) throw new Error('The draft transfer receipt could not be loaded. Retry the same draft.');
  return completed;
}

async function loadReceipt(env: Env, draftId: string, auth: RequestAuth): Promise<Extract<GuestRoomDraftClaimResponse, { outcome: 'claimed' }> | null> {
  const claim = await env.DB.prepare('SELECT user_id, room_id, claimed_at, applied FROM guest_room_draft_claims WHERE guest_draft_id = ?')
    .bind(draftId).first<ClaimRow>();
  if (!claim?.applied) return null;
  if (claim.user_id !== auth.user.id) throw new HttpError(409, 'This guest draft has already been transferred to another account.');
  const coordinates = claim.room_id.split(',').map(Number);
  const room = createRoomRecordFromCurrent(await loadRoomCurrent(env, claim.room_id, { x: coordinates[0], y: coordinates[1] }, auth.user.id, auth.user.walletAddress));
  return { outcome: 'claimed', userId: auth.user.id, draftId, roomId: claim.room_id, claimedAt: claim.claimed_at, room };
}

function validateCoordinates(value: RoomCoordinates): RoomCoordinates {
  if (!value || !Number.isSafeInteger(value.x) || !Number.isSafeInteger(value.y)
    || Math.abs(value.x) >= Number.MAX_SAFE_INTEGER || Math.abs(value.y) >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, 'Choose a room with safe integer coordinates.');
  }
  return { x: value.x, y: value.y };
}

async function loadTarget(env: Env, coordinates: RoomCoordinates): Promise<TargetRow | null> {
  return env.DB.prepare(`SELECT id, draft_json, claimer_user_id, published_json, minted_token_id FROM rooms
    WHERE id = ? OR (x = ? AND y = ?) LIMIT 1`).bind(roomIdFromCoordinates(coordinates), coordinates.x, coordinates.y).first<TargetRow>();
}

function isAvailable(row: TargetRow | null): boolean {
  if (!row) return true;
  if (row.claimer_user_id || row.published_json || row.minted_token_id) return false;
  try { return isRoomSnapshotBlank(parseStoredSnapshot(row.draft_json, 'draft room')); } catch { return false; }
}

function isMatchingOwnedDraft(row: TargetRow | null, snapshot: RoomSnapshot, userId: string): boolean {
  if (!row || row.claimer_user_id !== userId || row.published_json || row.minted_token_id) return false;
  // Signing in inside the editor can save this very draft before recovery runs.
  // Ignore save bookkeeping, but require all authored content to match so a later edit is never replaced.
  const authoredContent = (room: RoomSnapshot) => JSON.stringify({
    ...cloneRoomSnapshot(room), createdAt: '', updatedAt: '', publishedAt: null, version: 0, status: 'draft',
  });
  try { return authoredContent(parseStoredSnapshot(row.draft_json, 'draft room')) === authoredContent(snapshot); }
  catch { return false; }
}

async function isNumberedWorldSpot(env: Env, roomId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare('SELECT 1 FROM world_room_claims WHERE room_id = ? AND world_id <> ?')
    .bind(roomId, WAMP_PRIME_WORLD_ID).first());
}

async function isFrontier(env: Env, coordinates: RoomCoordinates): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT 1 WHERE
    (NOT EXISTS (SELECT 1 FROM rooms WHERE published_json IS NOT NULL) AND ? = 0 AND ? = 0) OR
    EXISTS (SELECT 1 FROM rooms WHERE published_json IS NOT NULL AND abs(x - ?) + abs(y - ?) = 1)`)
    .bind(coordinates.x, coordinates.y, coordinates.x, coordinates.y).first());
}

async function conflict(env: Env, auth: RequestAuth, draftId: string, coordinates: RoomCoordinates,
  reason: 'occupied' | 'not_frontier'): Promise<GuestRoomDraftClaimResponse> {
  const candidates = await env.DB.prepare(`WITH offsets(dx, dy) AS (VALUES (1, 0), (-1, 0), (0, 1), (0, -1)),
    candidates AS (SELECT DISTINCT p.x + dx AS x, p.y + dy AS y FROM rooms p CROSS JOIN offsets WHERE p.published_json IS NOT NULL
      UNION SELECT 0, 0 WHERE NOT EXISTS (SELECT 1 FROM rooms WHERE published_json IS NOT NULL))
    SELECT c.x, c.y FROM candidates c LEFT JOIN rooms r ON r.x = c.x AND r.y = c.y
      WHERE r.claimer_user_id IS NULL AND r.published_json IS NULL AND r.minted_token_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM world_room_claims w WHERE w.x = c.x AND w.y = c.y AND w.world_id <> ?)
      ORDER BY abs(c.x - ?) + abs(c.y - ?), c.x, c.y LIMIT 24`)
    .bind(WAMP_PRIME_WORLD_ID, coordinates.x, coordinates.y).all<RoomCoordinates>();
  const suggestedCoordinates: RoomCoordinates[] = [];
  for (const candidate of candidates.results) {
    if (Number.isSafeInteger(candidate.x) && Number.isSafeInteger(candidate.y)
      && isAvailable(await loadTarget(env, candidate))) suggestedCoordinates.push(candidate);
    if (suggestedCoordinates.length === 6) break;
  }
  return { outcome: 'conflict', userId: auth.user.id, draftId, reason, coordinates, suggestedCoordinates,
    message: reason === 'occupied' ? 'That spot is already in use. Your guest draft is still saved. Choose a new spot.'
      : 'That spot no longer touches a published room. Your guest draft is still saved. Choose a new spot.' };
}
