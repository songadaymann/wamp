import type { RoomCoordinates, RoomRecord, RoomSummary } from '../../../persistence/roomModel';
import type { WorldRoomSummary } from '../../../persistence/worldModel';
import {
  WAMP_PRIME_WORLD_ID,
  type WorldBuildPolicy,
  type WorldEntitlementStatus,
  type WorldMembershipStatus,
  type WorldPublishPolicy,
  type WorldViewerRole,
} from '../../../worlds/model';
import { resolveWorldPolicy, type WorldPolicyDecision } from '../../../worlds/policies';
import { HttpError } from '../core/http';
import type { D1PreparedStatement, Env } from '../core/types';

interface WorldAccessRow {
  id: string;
  number: number;
  approved_name: string | null;
  owner_user_id: string | null;
  origin_x: number;
  origin_y: number;
  build_policy: WorldBuildPolicy;
  publish_policy: WorldPublishPolicy;
  claim_limit_per_day: number;
  publish_limit_per_day: number;
  entitlement_status: WorldEntitlementStatus | null;
  membership_role: 'owner' | 'manager' | 'builder' | null;
  membership_status: WorldMembershipStatus | null;
}

export interface WorldAccess {
  id: string;
  number: number;
  displayName: string | null;
  ownerUserId: string | null;
  origin: RoomCoordinates;
  buildPolicy: WorldBuildPolicy;
  publishPolicy: WorldPublishPolicy;
  claimLimitPerDay: number;
  publishLimitPerDay: number;
  entitlementStatus: WorldEntitlementStatus;
  viewerRole: WorldViewerRole;
  membershipStatus: WorldMembershipStatus | null;
  policy: WorldPolicyDecision;
}

function worldAccessQuery(where: string): string {
  return `
    SELECT
      w.id,
      w.number,
      w.approved_name,
      w.owner_user_id,
      w.origin_x,
      w.origin_y,
      w.build_policy,
      w.publish_policy,
      w.claim_limit_per_day,
      w.publish_limit_per_day,
      e.status AS entitlement_status,
      m.role AS membership_role,
      m.status AS membership_status
    FROM worlds w
    LEFT JOIN world_entitlements e ON e.id = w.entitlement_id
    LEFT JOIN world_memberships m
      ON m.world_id = w.id
      AND m.user_id = ?
    ${where}
    LIMIT 1
  `;
}

export async function loadWorldAccessById(
  env: Env,
  worldId: string,
  viewerUserId: string | null,
  viewerIsAdmin = false,
): Promise<WorldAccess | null> {
  const row = await env.DB.prepare(worldAccessQuery('WHERE w.id = ?'))
    .bind(viewerUserId, worldId)
    .first<WorldAccessRow>();
  return row ? mapWorldAccess(row, viewerUserId, viewerIsAdmin) : null;
}

export async function loadWorldAccessByRoomId(
  env: Env,
  roomId: string,
  viewerUserId: string | null,
  viewerIsAdmin = false,
): Promise<WorldAccess | null> {
  const row = await env.DB.prepare(
    worldAccessQuery(`
      INNER JOIN world_room_claims c ON c.world_id = w.id
      WHERE c.room_id = ?
    `),
  )
    .bind(viewerUserId, roomId)
    .first<WorldAccessRow>();
  return row ? mapWorldAccess(row, viewerUserId, viewerIsAdmin) : null;
}

function mapWorldAccess(
  row: WorldAccessRow,
  viewerUserId: string | null,
  viewerIsAdmin: boolean,
): WorldAccess {
  const viewerRole: WorldViewerRole =
    viewerUserId !== null && row.owner_user_id === viewerUserId
      ? 'owner'
      : row.membership_role === 'owner' ? null : row.membership_role;
  const entitlementStatus = row.number === 0
    ? 'active'
    : row.entitlement_status ?? 'frozen';
  const membershipStatus = viewerRole === 'owner' ? 'active' : row.membership_status;
  return {
    id: row.id,
    number: row.number,
    displayName: row.approved_name,
    ownerUserId: row.owner_user_id,
    origin: { x: row.origin_x, y: row.origin_y },
    buildPolicy: row.build_policy,
    publishPolicy: row.publish_policy,
    claimLimitPerDay: row.claim_limit_per_day,
    publishLimitPerDay: row.publish_limit_per_day,
    entitlementStatus,
    viewerRole,
    membershipStatus,
    policy: resolveWorldPolicy({
      entitlementStatus,
      buildPolicy: row.build_policy,
      publishPolicy: row.publish_policy,
      viewerRole,
      membershipStatus,
      isAdmin: viewerIsAdmin,
    }),
  };
}

export async function applyWorldRoomPermissions(
  env: Env,
  roomId: string,
  record: RoomRecord,
  viewerUserId: string | null,
  viewerIsAdmin: boolean,
): Promise<RoomRecord> {
  const access = await loadWorldAccessByRoomId(env, roomId, viewerUserId, viewerIsAdmin);
  if (!access || access.id === WAMP_PRIME_WORLD_ID) return record;
  return {
    ...record,
    permissions: worldRoomPermissions(access),
    world: worldRoomContext(access),
  };
}

export async function applyWorldRoomSummaryPermissions(
  env: Env,
  roomId: string,
  summary: RoomSummary,
  viewerUserId: string | null,
  viewerIsAdmin: boolean,
): Promise<RoomSummary> {
  const access = await loadWorldAccessByRoomId(env, roomId, viewerUserId, viewerIsAdmin);
  if (!access || access.id === WAMP_PRIME_WORLD_ID) return summary;
  return {
    ...summary,
    permissions: worldRoomPermissions(access),
    world: worldRoomContext(access),
  };
}

function worldRoomPermissions(access: WorldAccess): RoomRecord['permissions'] {
  return {
    canSaveDraft: access.policy.canEditRooms,
    canPublish: access.policy.canPublishDirectly || access.policy.canSubmitForApproval,
    canRevert: access.policy.canManageHistory,
    canMint: false,
  };
}

function worldRoomContext(access: WorldAccess): NonNullable<RoomRecord['world']> {
  return {
    worldId: access.id,
    worldNumber: access.number,
    worldName: access.displayName,
    viewerRole: access.viewerRole,
    membershipStatus: access.membershipStatus,
    frozen: access.entitlementStatus !== 'active',
  };
}

export async function requireWorldForMutation(
  env: Env,
  worldId: string,
  viewerUserId: string | null,
  viewerIsAdmin = false,
): Promise<WorldAccess> {
  if (worldId === WAMP_PRIME_WORLD_ID) {
    throw new HttpError(400, 'WAMP 0 uses the standard room workflow.');
  }
  const access = await loadWorldAccessById(env, worldId, viewerUserId, viewerIsAdmin);
  if (!access) throw new HttpError(404, 'World was not found.');
  if (access.number === 0) throw new HttpError(400, 'WAMP 0 uses the standard room workflow.');
  if (access.entitlementStatus !== 'active') {
    throw new HttpError(403, 'This World is currently play-only.');
  }
  return access;
}

export async function assertWorldFrontierClaim(
  env: Env,
  worldId: string,
  coordinates: RoomCoordinates,
): Promise<void> {
  const row = await env.DB.prepare(
    `
      SELECT 1 AS found
      FROM world_room_claims c
      INNER JOIN rooms r ON r.id = c.room_id
      WHERE c.world_id = ?
        AND r.published_json IS NOT NULL
        AND (
          (c.x = ? AND c.y = ?)
          OR (c.x = ? AND c.y = ?)
          OR (c.x = ? AND c.y = ?)
          OR (c.x = ? AND c.y = ?)
        )
      LIMIT 1
    `,
  )
    .bind(
      worldId,
      coordinates.x + 1,
      coordinates.y,
      coordinates.x - 1,
      coordinates.y,
      coordinates.x,
      coordinates.y + 1,
      coordinates.x,
      coordinates.y - 1,
    )
    .first<{ found: number }>();
  if (!row) {
    throw new HttpError(409, 'New World rooms must touch a published room in the same World.');
  }
}

export async function assertPrimeOnlyAuthoringRooms(env: Env, roomIds: string[]): Promise<void> {
  if (env.WORLDS_ENABLED !== '1' || roomIds.length === 0) return;
  const uniqueRoomIds = [...new Set(roomIds)];
  const placeholders = uniqueRoomIds.map(() => '?').join(', ');
  const row = await env.DB.prepare(
    `SELECT w.number
     FROM world_room_claims c
     INNER JOIN worlds w ON w.id = c.world_id
     WHERE c.room_id IN (${placeholders}) AND w.number > 0
     LIMIT 1`,
  ).bind(...uniqueRoomIds).first<{ number: number }>();
  if (row) {
    throw new HttpError(403, 'Expanded Room and course authoring are disabled for numbered World rooms.');
  }
}

export async function annotateNumberedWorldRooms(
  env: Env,
  rooms: WorldRoomSummary[],
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): Promise<void> {
  if (env.WORLDS_ENABLED !== '1' || rooms.length === 0) return;
  const result = await env.DB.prepare(
    `SELECT c.room_id, w.id, w.number, w.approved_name, e.status
     FROM world_room_claims c
     INNER JOIN worlds w ON w.id = c.world_id
     LEFT JOIN world_entitlements e ON e.id = w.entitlement_id
     WHERE w.number > 0 AND c.x BETWEEN ? AND ? AND c.y BETWEEN ? AND ?`,
  ).bind(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY).all<{
    room_id: string; id: string; number: number; approved_name: string | null;
    status: WorldEntitlementStatus | null;
  }>();
  const byRoom = new Map(result.results.map((row) => [row.room_id, row]));
  for (const room of rooms) {
    const world = byRoom.get(room.id);
    if (!world) continue;
    room.world = {
      id: world.id,
      number: world.number,
      name: world.approved_name,
      frozen: world.status !== 'active',
    };
  }
}

export function prepareWorldRoomClaimStatement(
  env: Env,
  params: {
    roomId: string;
    coordinates: RoomCoordinates;
    worldId: string;
    builderUserId: string;
    claimedAt: string;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `
      INSERT INTO world_room_claims (
        room_id, x, y, world_id, first_builder_user_id, claimed_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).bind(
    params.roomId,
    params.coordinates.x,
    params.coordinates.y,
    params.worldId,
    params.builderUserId,
    params.claimedAt,
  );
}

export function prepareWorldDailyUsageStatement(
  env: Env,
  params: {
    world: Pick<WorldAccess, 'id' | 'claimLimitPerDay' | 'publishLimitPerDay'>;
    userId: string;
    now: string;
    claimDelta: 0 | 1;
    publishDelta: 0 | 1;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `
      INSERT INTO world_daily_usage (
        world_id, user_id, utc_day, claim_count, publish_count,
        claim_limit, publish_limit, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(world_id, user_id, utc_day) DO UPDATE SET
        claim_count = world_daily_usage.claim_count + excluded.claim_count,
        publish_count = world_daily_usage.publish_count + excluded.publish_count,
        claim_limit = excluded.claim_limit,
        publish_limit = excluded.publish_limit,
        updated_at = excluded.updated_at
    `,
  ).bind(
    params.world.id,
    params.userId,
    params.now.slice(0, 10),
    params.claimDelta,
    params.publishDelta,
    params.world.claimLimitPerDay,
    params.world.publishLimitPerDay,
    params.now,
  );
}
