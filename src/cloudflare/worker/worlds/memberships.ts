import type { AuthUser } from '../../../auth/model';
import type {
  WorldMembership,
  WorldMembershipRole,
  WorldMembershipStatus,
} from '../../../worlds/model';
import { findUserByEmail, isValidEmail, normalizeEmail } from '../auth/store';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { loadWorldAccessById } from './access';
import { prepareWorldActivityStatement } from './activity';

interface MembershipRow {
  id: string;
  world_id: string;
  user_id: string | null;
  email: string;
  display_name: string | null;
  role: WorldMembershipRole;
  status: WorldMembershipStatus;
  created_at: string;
  updated_at: string;
}

export async function listWorldMemberships(
  env: Env,
  worldId: string,
  viewerUserId: string,
  viewerIsAdmin: boolean,
): Promise<WorldMembership[]> {
  const access = await loadWorldAccessById(env, worldId, viewerUserId, viewerIsAdmin);
  if (!access?.policy.canManageMembers) throw new HttpError(403, 'World member management is required.');
  const result = await env.DB.prepare(
    `SELECT id, world_id, user_id, email, display_name, role, status, created_at, updated_at
     FROM world_memberships WHERE world_id = ? ORDER BY updated_at DESC`,
  ).bind(worldId).all<MembershipRow>();
  return result.results.map(mapMembership);
}

export async function inviteWorldBuilder(
  env: Env,
  worldId: string,
  rawEmail: string,
  actor: AuthUser,
  actorIsAdmin: boolean,
): Promise<WorldMembership> {
  const access = await loadWorldAccessById(env, worldId, actor.id, actorIsAdmin);
  if (!access?.policy.canManageMembers) throw new HttpError(403, 'World member management is required.');
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new HttpError(400, 'A valid builder email is required.');
  const user = await findUserByEmail(env, email);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO world_memberships (
        id, world_id, user_id, email, display_name, role, status,
        invited_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'builder', 'invited', ?, ?, ?)
      ON CONFLICT(world_id, email) DO UPDATE SET
        user_id = COALESCE(excluded.user_id, world_memberships.user_id),
        display_name = COALESCE(excluded.display_name, world_memberships.display_name),
        role = CASE
          WHEN world_memberships.status = 'active' THEN world_memberships.role
          ELSE 'builder'
        END,
        status = CASE
          WHEN world_memberships.status IN ('active', 'blocked') THEN world_memberships.status
          ELSE 'invited'
        END,
        invited_by_user_id = excluded.invited_by_user_id,
        updated_at = excluded.updated_at`,
    ).bind(id, worldId, user?.id ?? null, email, user?.displayName ?? null, actor.id, now, now),
    prepareWorldActivityStatement(env, {
      worldId,
      actorUserId: actor.id,
      eventType: 'builder_invited',
      subjectId: email,
      occurredAt: now,
    }),
  ]);
  const membership = await loadMembershipByEmail(env, worldId, email);
  if (!membership) throw new HttpError(500, 'World invitation could not be loaded.');
  return membership;
}

export async function requestWorldMembership(
  env: Env,
  worldId: string,
  user: AuthUser,
  isAdmin: boolean,
): Promise<WorldMembership> {
  if (!user.email) throw new HttpError(403, 'Link and verify an email before requesting World access.');
  const access = await loadWorldAccessById(env, worldId, user.id, isAdmin);
  if (!access) throw new HttpError(404, 'World was not found.');
  if (!access.policy.canRequestMembership) throw new HttpError(403, 'This World is not accepting builder requests.');
  const email = normalizeEmail(user.email);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO world_memberships (
        id, world_id, user_id, email, display_name, role, status,
        invited_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'builder', 'requested', NULL, ?, ?)
      ON CONFLICT(world_id, email) DO UPDATE SET
        user_id = excluded.user_id,
        display_name = excluded.display_name,
        status = CASE WHEN world_memberships.status = 'blocked' THEN 'blocked' ELSE 'requested' END,
        updated_at = excluded.updated_at`,
    ).bind(id, worldId, user.id, email, user.displayName, now, now),
    prepareWorldActivityStatement(env, {
      worldId,
      actorUserId: user.id,
      eventType: 'membership_requested',
      subjectId: user.id,
      occurredAt: now,
    }),
  ]);
  const membership = await loadMembershipByEmail(env, worldId, email);
  if (!membership || membership.status === 'blocked') throw new HttpError(403, 'You are blocked from this World.');
  return membership;
}

export async function acceptWorldInvitation(
  env: Env,
  worldId: string,
  user: AuthUser,
): Promise<WorldMembership> {
  if (!user.email) throw new HttpError(403, 'Link and verify the invited email first.');
  const email = normalizeEmail(user.email);
  const now = new Date().toISOString();
  const access = await loadWorldAccessById(env, worldId, user.id, false);
  if (!access) throw new HttpError(404, 'World was not found.');
  if (access.entitlementStatus !== 'active') throw new HttpError(403, 'This World is currently play-only.');
  const existing = await loadMembershipByEmail(env, worldId, email);
  if (existing?.status === 'active' && existing.userId === user.id) return existing;
  if (!existing || existing.status !== 'invited') throw new HttpError(404, 'World invitation was not found.');
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_memberships
       SET user_id = ?, display_name = ?, status = 'active', updated_at = ?
       WHERE world_id = ? AND email = ? AND status = 'invited'`,
    ).bind(user.id, user.displayName, now, worldId, email),
    prepareWorldActivityStatement(env, {
      worldId,
      actorUserId: user.id,
      eventType: 'invitation_accepted',
      subjectId: user.id,
      occurredAt: now,
    }),
  ]);
  const membership = await loadMembershipByEmail(env, worldId, email);
  if (!membership) throw new HttpError(404, 'World invitation was not found.');
  return membership;
}

export type MembershipAction = 'approve' | 'remove' | 'block' | 'promote' | 'demote';

export async function updateWorldMembership(
  env: Env,
  worldId: string,
  membershipId: string,
  action: MembershipAction,
  actor: AuthUser,
  actorIsAdmin: boolean,
): Promise<WorldMembership> {
  const access = await loadWorldAccessById(env, worldId, actor.id, actorIsAdmin);
  if (!access?.policy.canManageMembers) throw new HttpError(403, 'World member management is required.');
  const target = await loadMembershipById(env, worldId, membershipId);
  if (!target) throw new HttpError(404, 'World membership was not found.');
  if (target.role === 'owner') throw new HttpError(409, 'The World owner membership cannot be changed.');
  if ((action === 'promote' || action === 'demote') && !access.policy.canManageManagers) {
    throw new HttpError(403, 'Only the World owner can manage managers.');
  }
  if (target.role === 'manager' && !access.policy.canManageManagers) {
    throw new HttpError(403, 'Only the World owner can change a manager.');
  }
  const next = resolveMembershipAction(target, action);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE world_memberships SET role = ?, status = ?, updated_at = ?
       WHERE id = ? AND world_id = ?`,
    ).bind(next.role, next.status, now, membershipId, worldId),
    prepareWorldActivityStatement(env, {
      worldId,
      actorUserId: actor.id,
      eventType: `membership_${action}`,
      subjectId: membershipId,
      occurredAt: now,
    }),
  ]);
  const updated = await loadMembershipById(env, worldId, membershipId);
  if (!updated) throw new HttpError(404, 'World membership was not found.');
  return updated;
}

function resolveMembershipAction(
  membership: WorldMembership,
  action: MembershipAction,
): Pick<WorldMembership, 'role' | 'status'> {
  switch (action) {
    case 'approve':
      if (membership.status !== 'requested') throw new HttpError(409, 'Only requested memberships can be approved.');
      return { role: membership.role, status: 'active' };
    case 'remove': return { role: 'builder', status: 'removed' };
    case 'block': return { role: 'builder', status: 'blocked' };
    case 'promote':
      if (membership.status !== 'active') throw new HttpError(409, 'Only active builders can become managers.');
      return { role: 'manager', status: 'active' };
    case 'demote': return { role: 'builder', status: membership.status };
  }
}

async function loadMembershipByEmail(env: Env, worldId: string, email: string): Promise<WorldMembership | null> {
  const row = await env.DB.prepare(
    `SELECT id, world_id, user_id, email, display_name, role, status, created_at, updated_at
     FROM world_memberships WHERE world_id = ? AND email = ? LIMIT 1`,
  ).bind(worldId, email).first<MembershipRow>();
  return row ? mapMembership(row) : null;
}

async function loadMembershipById(env: Env, worldId: string, id: string): Promise<WorldMembership | null> {
  const row = await env.DB.prepare(
    `SELECT id, world_id, user_id, email, display_name, role, status, created_at, updated_at
     FROM world_memberships WHERE world_id = ? AND id = ? LIMIT 1`,
  ).bind(worldId, id).first<MembershipRow>();
  return row ? mapMembership(row) : null;
}

function mapMembership(row: MembershipRow): WorldMembership {
  return {
    id: row.id,
    worldId: row.world_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
