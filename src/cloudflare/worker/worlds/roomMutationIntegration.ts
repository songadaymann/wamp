import type { PrincipalKind } from '../../../agents/model';
import type { RoomCoordinates, RoomRecord } from '../../../persistence/roomModel';
import { WAMP_PRIME_WORLD_ID } from '../../../worlds/model';
import { HttpError } from '../core/http';
import type { D1PreparedStatement, Env } from '../core/types';
import {
  loadWorldAccessById,
  loadWorldAccessByRoomId,
  prepareWorldDailyUsageStatement,
  prepareWorldRoomClaimStatement,
  type WorldAccess,
} from './access';
import { prepareWorldActivityStatement } from './activity';

export async function resolveWorldMutationAccess(
  env: Env,
  existing: RoomRecord,
  requestedWorldId: string | null | undefined,
  viewerUserId: string | null,
  viewerIsAdmin: boolean,
): Promise<WorldAccess | null> {
  if (env.WORLDS_ENABLED !== '1') {
    if (requestedWorldId) throw new HttpError(404, 'Worlds are not enabled.');
    return null;
  }
  const claimedWorld = existing.claimerUserId || existing.published
    ? await loadWorldAccessByRoomId(env, existing.draft.id, viewerUserId, viewerIsAdmin)
    : null;
  const numberedClaimedWorld = claimedWorld?.id === WAMP_PRIME_WORLD_ID ? null : claimedWorld;
  const requestedWorld = requestedWorldId
    ? await loadWorldAccessById(env, requestedWorldId, viewerUserId, viewerIsAdmin)
    : null;
  if (requestedWorldId && !requestedWorld) throw new HttpError(404, 'World was not found.');
  if (requestedWorld?.id === WAMP_PRIME_WORLD_ID) {
    throw new HttpError(400, 'WAMP 0 uses the standard room workflow.');
  }
  if (numberedClaimedWorld && requestedWorld && numberedClaimedWorld.id !== requestedWorld.id) {
    throw new HttpError(409, 'This room belongs to a different World.');
  }
  const world = numberedClaimedWorld ?? requestedWorld;
  if (world && world.entitlementStatus !== 'active') {
    throw new HttpError(403, 'This World is currently play-only.');
  }
  return world;
}

export function appendWorldDraftClaimStatements(input: {
  statements: D1PreparedStatement[];
  env: Env;
  world: WorldAccess | null;
  shouldClaim: boolean;
  roomId: string;
  coordinates: RoomCoordinates;
  builderUserId: string | null;
  principalKind: PrincipalKind;
  now: string;
}): void {
  const { statements, env, world, shouldClaim, roomId, coordinates, builderUserId, principalKind, now } = input;
  if (!shouldClaim || !builderUserId || env.WORLDS_ENABLED !== '1') return;
  statements.push(prepareWorldRoomClaimStatement(env, {
    roomId,
    coordinates,
    worldId: world?.id ?? WAMP_PRIME_WORLD_ID,
    builderUserId,
    claimedAt: now,
  }));
  if (!world) return;
  statements.push(
    prepareWorldDailyUsageStatement(env, {
      world,
      userId: builderUserId,
      now,
      claimDelta: 1,
      publishDelta: 0,
    }),
    prepareWorldActivityStatement(env, {
      worldId: world.id,
      actorUserId: builderUserId,
      eventType: 'room_claimed',
      subjectId: roomId,
      metadata: { coordinates, principalKind },
      occurredAt: now,
    }),
  );
}

export function appendWorldPublishStatements(input: {
  statements: D1PreparedStatement[];
  env: Env;
  world: WorldAccess | null;
  shouldClaim: boolean;
  roomId: string;
  roomVersion: number;
  coordinates: RoomCoordinates;
  actorUserId: string | null;
  usageUserId: string | null;
  principalKind: PrincipalKind;
  now: string;
}): void {
  const {
    statements,
    env,
    world,
    shouldClaim,
    roomId,
    roomVersion,
    coordinates,
    actorUserId,
    usageUserId,
    principalKind,
    now,
  } = input;
  if (shouldClaim && actorUserId && env.WORLDS_ENABLED === '1') {
    statements.push(prepareWorldRoomClaimStatement(env, {
      roomId,
      coordinates,
      worldId: world?.id ?? WAMP_PRIME_WORLD_ID,
      builderUserId: actorUserId,
      claimedAt: now,
    }));
  }
  if (!world || !usageUserId) return;
  statements.push(prepareWorldDailyUsageStatement(env, {
    world,
    userId: usageUserId,
    now,
    claimDelta: shouldClaim ? 1 : 0,
    publishDelta: 1,
  }));
  if (shouldClaim) {
    statements.push(prepareWorldActivityStatement(env, {
      worldId: world.id,
      actorUserId: actorUserId ?? usageUserId,
      eventType: 'room_claimed',
      subjectId: roomId,
      metadata: { coordinates, principalKind },
      occurredAt: now,
    }));
  }
  statements.push(prepareWorldActivityStatement(env, {
    worldId: world.id,
    actorUserId: actorUserId ?? usageUserId,
    eventType: 'room_published',
    subjectId: roomId,
    metadata: { roomVersion, usageUserId },
    occurredAt: now,
  }));
}

export function appendWorldRevertStatements(input: {
  statements: D1PreparedStatement[];
  env: Env;
  world: WorldAccess | null;
  actorUserId: string | null;
  roomId: string;
  targetVersion: number;
  publishedVersion: number;
  now: string;
}): void {
  const { statements, env, world, actorUserId, roomId, targetVersion, publishedVersion, now } = input;
  if (!world || !actorUserId) return;
  statements.push(
    prepareWorldDailyUsageStatement(env, {
      world,
      userId: actorUserId,
      now,
      claimDelta: 0,
      publishDelta: 1,
    }),
    prepareWorldActivityStatement(env, {
      worldId: world.id,
      actorUserId,
      eventType: 'room_reverted',
      subjectId: roomId,
      metadata: { targetVersion, publishedVersion },
      occurredAt: now,
    }),
  );
}

export async function runWorldAwareRoomMutationBatch(
  env: Env,
  statements: D1PreparedStatement[],
): Promise<void> {
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('world_daily_usage')) {
      throw new HttpError(429, 'This builder has reached the World daily limit.');
    }
    if (
      message.includes('world_room_claims.room_id')
      || message.includes('world_room_claims.x, world_room_claims.y')
      || message.includes('rooms.x, rooms.y')
    ) {
      throw new HttpError(409, 'That room coordinate was claimed first.');
    }
    throw error;
  }
}

export type { WorldAccess } from './access';
