import type { AuthUser } from '../../../auth/model';
import type { RoomCoordinates } from '../../../persistence/roomModel';
import type { WorldPublicationRequest } from '../../../worlds/model';
import { buildRoomMutationActor } from '../auth/actors';
import type { RequestAuth } from '../core/types';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadRoomRecord, publishRoom } from '../rooms/store';
import { loadWorldAccessById, loadWorldAccessByRoomId } from './access';
import { prepareWorldActivityStatement } from './activity';

interface PublicationRow {
  id: string;
  world_id: string;
  room_id: string;
  submitted_by_user_id: string;
  submitted_by_display_name: string | null;
  submitted_draft_updated_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'stale';
  rejection_reason: string | null;
  submitted_at: string;
  resolved_at: string | null;
  room_x: number;
  room_y: number;
  room_title: string | null;
}

export async function listWorldPublicationRequests(
  env: Env,
  worldId: string,
  viewerUserId: string,
  viewerIsAdmin: boolean,
): Promise<WorldPublicationRequest[]> {
  const access = await loadWorldAccessById(env, worldId, viewerUserId, viewerIsAdmin);
  if (!access?.policy.canReviewPublications) {
    throw new HttpError(403, 'World publication review is required.');
  }
  const result = await env.DB.prepare(publicationSelect('WHERE p.world_id = ? ORDER BY p.submitted_at DESC'))
    .bind(worldId)
    .all<PublicationRow>();
  return result.results.map(mapPublication);
}

export async function submitWorldPublicationRequest(
  env: Env,
  worldId: string,
  roomId: string,
  coordinates: RoomCoordinates,
  user: AuthUser,
  isAdmin: boolean,
): Promise<WorldPublicationRequest> {
  const access = await loadWorldAccessByRoomId(env, roomId, user.id, isAdmin);
  if (!access || access.id !== worldId) throw new HttpError(404, 'This room does not belong to that World.');
  if (!access.policy.canSubmitForApproval) {
    throw new HttpError(403, 'This account cannot submit World rooms for approval.');
  }
  const record = await loadRoomRecord(env, roomId, coordinates, user.id, user.walletAddress, isAdmin);
  const duplicate = await env.DB.prepare(
    `SELECT id FROM world_publication_requests
     WHERE world_id = ? AND room_id = ? AND submitted_by_user_id = ?
       AND submitted_draft_updated_at = ? AND status = 'pending'
     LIMIT 1`,
  ).bind(worldId, roomId, user.id, record.draft.updatedAt).first<{ id: string }>();
  if (duplicate) {
    const existing = await loadPublicationById(env, worldId, duplicate.id);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_publication_requests
       SET status = 'stale', resolved_at = ?
       WHERE room_id = ? AND status = 'pending'`,
    ).bind(now, roomId),
    env.DB.prepare(
      `INSERT INTO world_publication_requests (
        id, world_id, room_id, submitted_by_user_id,
        submitted_draft_updated_at, status, rejection_reason,
        resolved_by_user_id, submitted_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, NULL)`,
    ).bind(id, worldId, roomId, user.id, record.draft.updatedAt, now),
    prepareWorldActivityStatement(env, {
      worldId,
      actorUserId: user.id,
      eventType: 'publication_requested',
      subjectId: id,
      metadata: { roomId },
      occurredAt: now,
    }),
  ]);
  const row = await loadPublicationById(env, worldId, id);
  if (!row) throw new HttpError(500, 'Publication request could not be loaded.');
  return row;
}

export async function resolveWorldPublicationRequest(
  env: Env,
  worldId: string,
  requestId: string,
  decision: 'approve' | 'reject',
  rejectionReason: string | null,
  auth: RequestAuth,
): Promise<WorldPublicationRequest> {
  const access = await loadWorldAccessById(env, worldId, auth.user.id, auth.isAdmin);
  if (!access?.policy.canReviewPublications) throw new HttpError(403, 'World publication review is required.');
  const request = await loadPublicationById(env, worldId, requestId);
  if (!request) throw new HttpError(404, 'Publication request was not found.');
  const resolvedStatus = decision === 'approve' ? 'approved' : 'rejected';
  if (request.status === resolvedStatus) return request;
  if (request.status !== 'pending') {
    throw new HttpError(409, 'This publication request is no longer pending.');
  }
  const record = await loadRoomRecord(
    env,
    request.roomId,
    request.roomCoordinates,
    auth.user.id,
    auth.user.walletAddress,
    auth.isAdmin,
  );
  const now = new Date().toISOString();
  if (record.draft.updatedAt !== request.submittedDraftUpdatedAt) {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE world_publication_requests SET status = 'stale', resolved_at = ? WHERE id = ?`,
      ).bind(now, requestId),
    ]);
    throw new HttpError(409, 'This draft changed after submission and must be submitted again.');
  }

  if (decision === 'approve') {
    try {
      await publishRoom(
        env,
        record.draft,
        buildRoomMutationActor(auth),
        auth.isAdmin,
        {
          worldId,
          usageUserId: request.submittedByUserId,
          transactionStatementsBefore: [
            env.DB.prepare(
              `UPDATE world_publication_requests
               SET status = 'approved', rejection_reason = NULL,
                 resolved_by_user_id = ?, resolved_at = ?
               WHERE id = ?`,
            ).bind(auth.user.id, now, requestId),
            prepareWorldActivityStatement(env, {
              worldId,
              actorUserId: auth.user.id,
              eventType: 'publication_approved',
              subjectId: requestId,
              metadata: { roomId: request.roomId },
              occurredAt: now,
            }),
          ],
        },
      );
    } catch (error) {
      if (isStalePublicationError(error)) {
        await markPublicationStale(env, requestId, new Date().toISOString());
        throw new HttpError(409, 'This draft changed after submission and must be submitted again.');
      }
      if (isResolutionConflictError(error)) {
        throw new HttpError(409, 'This publication request is no longer pending.');
      }
      throw error;
    }
    const updated = await loadPublicationById(env, worldId, requestId);
    if (!updated) throw new HttpError(404, 'Publication request was not found.');
    return updated;
  }
  const reason = normalizeRejectionReason(rejectionReason);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE world_publication_requests
         SET status = ?, rejection_reason = ?, resolved_by_user_id = ?, resolved_at = ?
         WHERE id = ?`,
      ).bind('rejected', reason, auth.user.id, now, requestId),
      prepareWorldActivityStatement(env, {
        worldId,
        actorUserId: auth.user.id,
        eventType: 'publication_rejected',
        subjectId: requestId,
        metadata: { roomId: request.roomId, rejectionReason: reason },
        occurredAt: now,
      }),
    ]);
  } catch (error) {
    if (isResolutionConflictError(error)) {
      throw new HttpError(409, 'This publication request is no longer pending.');
    }
    throw error;
  }
  const updated = await loadPublicationById(env, worldId, requestId);
  if (!updated) throw new HttpError(404, 'Publication request was not found.');
  return updated;
}

async function markPublicationStale(env: Env, requestId: string, now: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_publication_requests SET status = 'stale', resolved_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(now, requestId),
  ]);
}

function isStalePublicationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('World publication draft is stale');
}

function isResolutionConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('World publication request is no longer pending');
}

async function loadPublicationById(
  env: Env,
  worldId: string,
  id: string,
): Promise<WorldPublicationRequest | null> {
  const row = await env.DB.prepare(publicationSelect('WHERE p.world_id = ? AND p.id = ? LIMIT 1'))
    .bind(worldId, id)
    .first<PublicationRow>();
  return row ? mapPublication(row) : null;
}

function publicationSelect(suffix: string): string {
  return `
    SELECT
      p.id, p.world_id, p.room_id, p.submitted_by_user_id,
      u.display_name AS submitted_by_display_name,
      p.submitted_draft_updated_at, p.status, p.rejection_reason,
      p.submitted_at, p.resolved_at,
      r.x AS room_x, r.y AS room_y, r.draft_title AS room_title
    FROM world_publication_requests p
    INNER JOIN rooms r ON r.id = p.room_id
    LEFT JOIN users u ON u.id = p.submitted_by_user_id
    ${suffix}
  `;
}

function mapPublication(row: PublicationRow): WorldPublicationRequest {
  return {
    id: row.id,
    worldId: row.world_id,
    roomId: row.room_id,
    roomCoordinates: { x: row.room_x, y: row.room_y },
    roomTitle: row.room_title,
    submittedByUserId: row.submitted_by_user_id,
    submittedByDisplayName: row.submitted_by_display_name,
    submittedDraftUpdatedAt: row.submitted_draft_updated_at,
    status: row.status,
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
    resolvedAt: row.resolved_at,
  };
}

function normalizeRejectionReason(value: string | null): string | null {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) return null;
  if (normalized.length > 500) throw new HttpError(400, 'Rejection reason must be 500 characters or fewer.');
  return normalized;
}
