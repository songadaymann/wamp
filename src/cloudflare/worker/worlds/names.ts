import type { WorldNameRequest } from '../../../worlds/model';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadWorldAccessById } from './access';
import { prepareWorldActivityStatement } from './activity';

export async function submitWorldNameRequest(
  env: Env,
  worldId: string,
  proposedName: string,
  userId: string,
  isAdmin: boolean,
): Promise<WorldNameRequest> {
  const access = await loadWorldAccessById(env, worldId, userId, isAdmin);
  if (!access?.policy.canRequestName) throw new HttpError(403, 'Only the active World owner can request a name.');
  const name = proposedName.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 48) throw new HttpError(400, 'World names must be 2 to 48 characters.');
  const pending = await env.DB.prepare(
    `SELECT n.id, n.requested_at, w.number, w.approved_name
     FROM world_name_requests n
     INNER JOIN worlds w ON w.id = n.world_id
     WHERE n.world_id = ? AND n.status = 'pending' AND n.proposed_name = ?
     LIMIT 1`,
  ).bind(worldId, name).first<{
    id: string; requested_at: string; number: number; approved_name: string | null;
  }>();
  if (pending) {
    return {
      id: pending.id,
      worldId,
      worldNumber: pending.number,
      currentName: pending.approved_name,
      proposedName: name,
      status: 'pending',
      requestedAt: pending.requested_at,
      resolvedAt: null,
    };
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_name_requests SET status = 'rejected', resolved_at = ?
       WHERE world_id = ? AND status = 'pending'`,
    ).bind(now, worldId),
    env.DB.prepare(
      `INSERT INTO world_name_requests (
        id, world_id, requested_by_user_id, proposed_name, status,
        resolved_by_user_id, requested_at, resolved_at
      ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
    ).bind(id, worldId, userId, name, now),
    prepareWorldActivityStatement(env, {
      worldId,
      actorUserId: userId,
      eventType: 'name_requested',
      subjectId: id,
      metadata: { proposedName: name },
      occurredAt: now,
    }),
  ]);
  return {
    id,
    worldId,
    worldNumber: access.number,
    currentName: access.displayName,
    proposedName: name,
    status: 'pending',
    requestedAt: now,
    resolvedAt: null,
  };
}

export async function listPendingWorldNameRequests(env: Env): Promise<WorldNameRequest[]> {
  const result = await env.DB.prepare(
    `SELECT n.id, n.world_id, w.number, w.approved_name, n.proposed_name,
      n.status, n.requested_at, n.resolved_at
     FROM world_name_requests n
     INNER JOIN worlds w ON w.id = n.world_id
     WHERE n.status = 'pending'
     ORDER BY n.requested_at ASC`,
  ).all<{
    id: string; world_id: string; number: number; approved_name: string | null;
    proposed_name: string; status: 'pending'; requested_at: string; resolved_at: string | null;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    worldId: row.world_id,
    worldNumber: row.number,
    currentName: row.approved_name,
    proposedName: row.proposed_name,
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
  }));
}

export async function resolveWorldNameRequest(
  env: Env,
  requestId: string,
  decision: 'approve' | 'reject',
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id, world_id, proposed_name, status FROM world_name_requests
     WHERE id = ? LIMIT 1`,
  ).bind(requestId).first<{
    id: string; world_id: string; proposed_name: string;
    status: 'pending' | 'approved' | 'rejected';
  }>();
  if (!row) throw new HttpError(404, 'World name request was not found.');
  const resolvedStatus = decision === 'approve' ? 'approved' : 'rejected';
  if (row.status === resolvedStatus) return;
  if (row.status !== 'pending') throw new HttpError(409, 'This World name request was already resolved differently.');
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `UPDATE world_name_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'`,
    ).bind(resolvedStatus, now, requestId),
  ];
  if (decision === 'approve') {
    statements.push(
      env.DB.prepare(`UPDATE worlds SET approved_name = ?, updated_at = ? WHERE id = ?`)
        .bind(row.proposed_name, now, row.world_id),
    );
  }
  statements.push(prepareWorldActivityStatement(env, {
    worldId: row.world_id,
    actorUserId: null,
    eventType: decision === 'approve' ? 'name_approved' : 'name_rejected',
    subjectId: requestId,
    occurredAt: now,
  }));
  await env.DB.batch(statements);
}
