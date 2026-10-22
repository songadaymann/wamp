import type {
  AdminBuildingModerationResponse,
  AdminRevertEditsResponse,
  AdminRevertEditsRoom,
} from '../../../admin/model';
import { requireAdminRequest } from '../auth/request';
import { HttpError, jsonResponse, parseJsonBody } from '../core/http';
import type { Env, WorkerExecutionContextLike } from '../core/types';
import { loadAccountSuspension, prepareModerationAuditStatement } from '../moderation/suspension';
import {
  refreshPlayableContentIndexForRoom,
  schedulePlayableContentIndexRefresh,
} from '../playableContentIndex/store';
import { revertRoom, type RoomMutationActor } from '../rooms/store';

/** Each revert is several D1 round trips, so one request stays well inside Worker limits. */
const MAX_REVERTS_PER_REQUEST = 25;
const MAX_PLANNED_ROOMS = 500;

const MODERATION_ACTOR: RoomMutationActor = {
  ownerUser: null,
  principalKind: 'user',
  principalAgentId: null,
  principalDisplayName: 'WAMP moderation',
  requestAuthSource: null,
};

interface SuspensionRequestBody {
  suspended?: unknown;
  reason?: unknown;
  operatorLabel?: unknown;
}

interface RevertEditsRequestBody {
  since?: unknown;
  execute?: unknown;
  reason?: unknown;
  operatorLabel?: unknown;
}

function optionalText(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : null;
}

async function loadModerationResponse(env: Env, userId: string): Promise<AdminBuildingModerationResponse> {
  const suspension = await loadAccountSuspension(env, userId);
  if (!suspension) {
    throw new HttpError(404, 'User not found.');
  }
  const audit = await env.DB.prepare(
    `SELECT action, operator_label, reason, details_json, created_at
     FROM moderation_audit WHERE target_user_id = ? ORDER BY created_at DESC, id DESC LIMIT 10`,
  )
    .bind(userId)
    .all<{ action: string; operator_label: string; reason: string | null; details_json: string; created_at: string }>();
  return {
    userId,
    suspendedAt: suspension.suspendedAt,
    suspendedReason: suspension.suspendedReason,
    recentActions: audit.results.map((row) => ({
      action: row.action,
      operatorLabel: row.operator_label,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  };
}

export async function handleAdminBuildingModeration(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  requireAdminRequest(env, request, `read building moderation for ${userId}`);
  return jsonResponse(request, await loadModerationResponse(env, userId));
}

export async function handleAdminUserSuspension(
  request: Request,
  env: Env,
  userId: string,
): Promise<Response> {
  requireAdminRequest(env, request, `change the suspension of ${userId}`);
  const body = await parseJsonBody<SuspensionRequestBody>(request);
  if (typeof body.suspended !== 'boolean') {
    throw new HttpError(400, 'suspended must be true or false.');
  }
  const reason = optionalText(body.reason, 500);
  if (body.suspended && !reason) {
    throw new HttpError(400, 'A reason is required to suspend an account.');
  }
  if (!(await loadAccountSuspension(env, userId))) {
    throw new HttpError(404, 'User not found.');
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ?')
      .bind(body.suspended ? now : null, body.suspended ? reason : null, userId),
    // A suspension also ends every bot and API token, so lifting it later does not revive them.
    ...(body.suspended ? [
      env.DB.prepare('UPDATE api_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId),
      env.DB.prepare(`UPDATE agent_tokens SET revoked_at = ? WHERE revoked_at IS NULL
        AND agent_id IN (SELECT id FROM agents WHERE owner_user_id = ?)`).bind(now, userId),
    ] : []),
    prepareModerationAuditStatement(env, {
      action: body.suspended ? 'suspend' : 'unsuspend',
      targetUserId: userId,
      operatorLabel: optionalText(body.operatorLabel, 80) ?? 'Admin',
      reason,
      createdAt: now,
    }),
  ]);
  return jsonResponse(request, await loadModerationResponse(env, userId));
}

interface EditedRoomRow {
  room_id: string;
  x: number;
  y: number;
  title: string | null;
  claimer_user_id: string | null;
  first_publisher: string | null;
  minted: number;
  first_version: number;
  edit_count: number;
  target_version: number | null;
  latest_version: number;
  latest_by: string | null;
  others_since: number;
  newer_draft: number;
}

/**
 * Rooms this user published to since `since`, and what undoing them means. A room goes back to
 * the newest version someone else published before the user's first edit in the window, and only
 * while every version since then is the user's and nobody has saved a newer draft, so later work
 * by anyone else is never discarded. Restorable rooms are listed first, so the cap never hides them.
 */
async function planEditReverts(env: Env, userId: string, since: string): Promise<AdminRevertEditsRoom[]> {
  const rows = await env.DB.prepare(
    `WITH edited AS (
       SELECT room_id, MIN(version) AS first_version, COUNT(*) AS edit_count
       FROM room_versions
       WHERE published_by_user_id = ? AND created_at >= ?
       GROUP BY room_id
     )
     SELECT e.room_id, r.x, r.y, r.published_title AS title, r.claimer_user_id,
       (SELECT f.published_by_user_id FROM room_versions f WHERE f.room_id = e.room_id
         ORDER BY f.version LIMIT 1) AS first_publisher,
       CASE WHEN r.minted_token_id IS NOT NULL OR r.minted_chain_id IS NOT NULL
         OR r.minted_contract_address IS NOT NULL THEN 1 ELSE 0 END AS minted,
       e.first_version, e.edit_count,
       (SELECT MAX(p.version) FROM room_versions p
         WHERE p.room_id = e.room_id AND p.version < e.first_version
           AND (p.published_by_user_id IS NULL OR p.published_by_user_id <> ?)) AS target_version,
       l.version AS latest_version, l.published_by_user_id AS latest_by,
       (SELECT COUNT(*) FROM room_versions m WHERE m.room_id = e.room_id AND m.version > e.first_version
         AND (m.published_by_user_id IS NULL OR m.published_by_user_id <> ?)) AS others_since,
       CASE WHEN json_extract(r.draft_json, '$.updatedAt') > l.created_at THEN 1 ELSE 0 END AS newer_draft
     FROM edited e
     JOIN rooms r ON r.id = e.room_id
     JOIN room_versions l ON l.room_id = e.room_id
       AND l.version = (SELECT MAX(version) FROM room_versions WHERE room_id = e.room_id)
     ORDER BY CASE WHEN l.published_by_user_id = ? THEN 0 ELSE 1 END, e.room_id
     LIMIT ?`,
  )
    .bind(userId, since, userId, userId, userId, MAX_PLANNED_ROOMS)
    .all<EditedRoomRow>();
  return rows.results.map((row) => {
    const base = {
      roomId: row.room_id,
      x: row.x,
      y: row.y,
      title: row.title,
      editCount: row.edit_count,
      latestVersion: row.latest_version,
      targetVersion: row.target_version,
    };
    // Publishing over an unclaimed room claims it, so "their own room" means they built it first.
    if (row.claimer_user_id === userId && row.first_publisher === userId) return { ...base, action: 'skip', reason: 'own_room' };
    if (row.minted === 1) return { ...base, action: 'skip', reason: 'minted' };
    if (row.target_version === null) return { ...base, action: 'skip', reason: 'no_earlier_version' };
    if (row.latest_by !== userId || row.others_since > 0) return { ...base, action: 'skip', reason: 'changed_since' };
    if (row.newer_draft === 1) return { ...base, action: 'skip', reason: 'newer_draft' };
    return { ...base, action: 'revert', reason: null, releaseClaim: row.claimer_user_id === userId };
  });
}

export async function handleAdminRevertUserEdits(
  request: Request,
  env: Env,
  userId: string,
  context?: WorkerExecutionContextLike,
): Promise<Response> {
  requireAdminRequest(env, request, `revert room edits by ${userId}`);
  const body = await parseJsonBody<RevertEditsRequestBody>(request);
  const sinceMs = typeof body.since === 'string' ? Date.parse(body.since) : Number.NaN;
  if (!Number.isFinite(sinceMs)) {
    throw new HttpError(400, 'since must be an ISO date and time.');
  }
  const since = new Date(sinceMs).toISOString();
  if (!(await loadAccountSuspension(env, userId))) {
    throw new HttpError(404, 'User not found.');
  }
  const rooms = await planEditReverts(env, userId, since);
  const pending = rooms.filter((room) => room.action === 'revert');
  const reverted: AdminRevertEditsResponse['reverted'] = [];
  const failed: AdminRevertEditsResponse['failed'] = [];
  if (body.execute === true) {
    for (const room of pending.slice(0, MAX_REVERTS_PER_REQUEST)) {
      try {
        await revertRoom(env, room.roomId, { x: room.x, y: room.y }, room.targetVersion!, MODERATION_ACTOR, true,
          { expectedLatestVersion: room.latestVersion });
        if (room.releaseClaim) {
          // They took the claim by publishing over an unclaimed room; give the room back to nobody.
          await env.DB.batch([env.DB.prepare(`UPDATE rooms SET claimer_user_id = NULL, claimer_principal_type = NULL,
            claimer_agent_id = NULL, claimer_display_name = NULL, claimed_at = NULL WHERE id = ? AND claimer_user_id = ?`)
            .bind(room.roomId, userId)]);
        }
        reverted.push({ roomId: room.roomId, fromVersion: room.latestVersion, toVersion: room.targetVersion! });
        schedulePlayableContentIndexRefresh(context, refreshPlayableContentIndexForRoom(env, room.roomId));
      } catch (error) {
        failed.push({ roomId: room.roomId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (reverted.length > 0 || failed.length > 0) {
      await env.DB.batch([prepareModerationAuditStatement(env, {
        action: 'revert_edits',
        targetUserId: userId,
        operatorLabel: optionalText(body.operatorLabel, 80) ?? 'Admin',
        reason: optionalText(body.reason, 500),
        details: { since, reverted, failed },
        createdAt: new Date().toISOString(),
      })]);
    }
  }
  const response: AdminRevertEditsResponse = {
    userId,
    since,
    rooms,
    reverted,
    failed,
    remaining: Math.max(0, pending.length - reverted.length - failed.length),
    truncated: rooms.length >= MAX_PLANNED_ROOMS,
  };
  return jsonResponse(request, response);
}
