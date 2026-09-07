import {
  cloneRoomSnapshot,
  getRoomPublishValidationError,
  roomIdFromCoordinates,
  type RoomRecord,
  type RoomSnapshot,
} from '../../../persistence/roomModel';
import { getWorldOrigin } from '../../../worlds/geometry';
import type { WorldDetail } from '../../../worlds/model';
import { assertCustomBackgroundApproved } from '../backgroundImages/routes';
import type { RequestAuth } from '../core/types';
import { HttpError } from '../core/http';
import type { Env } from '../core/types';
import { prepareMusicPhrasePublishStatements } from '../music/store';
import {
  loadRoomRecord,
  preparePersistRoomRecordStatement,
  preparePersistRoomVersionStatement,
} from '../rooms/store';
import { enforceRoomMutationGuardrails } from '../rooms/guardrails';
import { prepareWorldActivityStatement } from './activity';
import { loadWorldDetailById, requireOwnedUnactivatedEntitlement } from './store';

export interface ActivatedWorldResult {
  world: WorldDetail;
  room: RoomRecord;
}

export async function activateWorldFromSeed(
  env: Env,
  grantId: string,
  auth: RequestAuth,
): Promise<ActivatedWorldResult> {
  const entitlement = await requireOwnedUnactivatedEntitlement(env, grantId, auth.user.id);
  if (entitlement.status !== 'active') throw new HttpError(403, 'This World grant is frozen.');
  if (!entitlement.seedDraft) throw new HttpError(409, 'Save a seed-room draft before publishing your World.');

  await enforceRoomMutationGuardrails(
    env,
    entitlement.seedDraft,
    auth.user.id,
    auth.source,
    null,
  );
  const validationError = getRoomPublishValidationError(entitlement.seedDraft);
  if (validationError) throw new HttpError(409, validationError);
  await assertCustomBackgroundApproved(env, entitlement.seedDraft.background);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = await nextWorldNumber(env);
    try {
      return await persistActivation(env, grantId, entitlement.seedDraft, candidate, auth);
    } catch (error) {
      if (isNumberAllocationConflict(error) && attempt < 4) continue;
      if (isCoordinateClaimConflict(error)) {
        throw new HttpError(409, 'That World origin was claimed concurrently. Please publish again.');
      }
      throw error;
    }
  }
  throw new HttpError(409, 'A World number could not be allocated. Please publish again.');
}

async function nextWorldNumber(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COALESCE(MAX(number), 0) + 1 AS next_number FROM worlds`,
  ).first<{ next_number: number }>();
  const candidate = Number(row?.next_number);
  if (!Number.isSafeInteger(candidate) || candidate < 1) {
    throw new HttpError(500, 'World number allocation returned an invalid value.');
  }
  return candidate;
}

async function persistActivation(
  env: Env,
  grantId: string,
  seed: RoomSnapshot,
  worldNumber: number,
  auth: RequestAuth,
): Promise<ActivatedWorldResult> {
  const now = new Date().toISOString();
  const worldId = crypto.randomUUID();
  const origin = getWorldOrigin(worldNumber);
  const roomId = roomIdFromCoordinates(origin);
  const published: RoomSnapshot = {
    ...cloneRoomSnapshot(seed),
    id: roomId,
    coordinates: origin,
    version: 1,
    status: 'published',
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
  const draft: RoomSnapshot = { ...cloneRoomSnapshot(published), status: 'draft' };
  const displayName = auth.principal.displayName || auth.user.displayName || 'Builder';
  const musicStatements = await prepareMusicPhrasePublishStatements(env, published, {
    userId: auth.user.id,
    principalKind: auth.principal.kind,
    agentId: auth.principal.agentId,
    displayName,
  });

  await env.DB.batch([
    env.DB.prepare(
      `
        INSERT INTO worlds (
          id, number, origin_x, origin_y, owner_user_id, entitlement_id,
          approved_name, build_policy, publish_policy, claim_limit_per_day,
          publish_limit_per_day, activated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'request_to_join', 'approval_required', 5, 10, ?, ?, ?)
      `,
    ).bind(worldId, worldNumber, origin.x, origin.y, auth.user.id, grantId, now, now, now),
    preparePersistRoomRecordStatement(env, {
      draft,
      published,
      canonicalVersion: null,
      claimerUserId: auth.user.id,
      claimerPrincipalType: auth.principal.kind,
      claimerAgentId: auth.principal.agentId,
      claimerDisplayName: displayName,
      claimedAt: now,
      lastPublishedByUserId: auth.user.id,
      lastPublishedByPrincipalType: auth.principal.kind,
      lastPublishedByAgentId: auth.principal.agentId,
      lastPublishedByDisplayName: displayName,
      mintedChainId: null,
      mintedContractAddress: null,
      mintedTokenId: null,
      mintedOwnerWalletAddress: null,
      mintedOwnerSyncedAt: null,
      mintedMetadataRoomVersion: null,
      mintedMetadataUpdatedAt: null,
      mintedMetadataHash: null,
    }),
    preparePersistRoomVersionStatement(env, {
      snapshot: published,
      createdAt: now,
      publishedByUserId: auth.user.id,
      publishedByPrincipalType: auth.principal.kind,
      publishedByAgentId: auth.principal.agentId,
      publishedByDisplayName: displayName,
      revertedFromVersion: null,
      leaderboardSourceVersion: null,
      onConflictUpdate: false,
    }),
    ...musicStatements,
    env.DB.prepare(
      `INSERT INTO world_room_claims (
        room_id, x, y, world_id, first_builder_user_id, claimed_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(roomId, origin.x, origin.y, worldId, auth.user.id, now),
    env.DB.prepare(
      `INSERT INTO world_memberships (
        id, world_id, user_id, email, display_name, role, status,
        invited_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'owner', 'active', NULL, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      worldId,
      auth.user.id,
      auth.user.email ?? `owner-${auth.user.id}@identity.invalid`,
      auth.user.displayName,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO world_daily_usage (
        world_id, user_id, utc_day, claim_count, publish_count,
        claim_limit, publish_limit, updated_at
      ) VALUES (?, ?, ?, 1, 1, 5, 10, ?)`,
    ).bind(worldId, auth.user.id, now.slice(0, 10), now),
    env.DB.prepare(
      `INSERT INTO world_ownership_events (
        id, world_id, owner_user_id, event_type, source, external_ref, occurred_at
      ) VALUES (?, ?, ?, 'activated', 'complimentary', NULL, ?)`,
    ).bind(crypto.randomUUID(), worldId, auth.user.id, now),
    env.DB.prepare(
      `UPDATE world_entitlements
       SET seed_draft_json = NULL, seed_updated_at = NULL, updated_at = ?
       WHERE id = ? AND owner_user_id = ? AND status = 'active'`,
    ).bind(now, grantId, auth.user.id),
    prepareWorldActivityStatement(env, {
      worldId,
      entitlementId: grantId,
      actorUserId: auth.user.id,
      eventType: 'world_activated',
      subjectId: roomId,
      metadata: { worldNumber, origin },
      idempotencyKey: `activate:${grantId}`,
      occurredAt: now,
    }),
  ]);

  const world = await loadWorldDetailById(env, worldId, auth.user.id, auth.isAdmin);
  if (!world) throw new HttpError(500, 'World could not be loaded after activation.');
  const room = await loadRoomRecord(
    env,
    roomId,
    origin,
    auth.user.id,
    auth.user.walletAddress,
    auth.isAdmin,
  );
  return { world, room };
}

function isNumberAllocationConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed: worlds.number')
    || message.includes('UNIQUE constraint failed: worlds.origin_x, worlds.origin_y');
}

function isCoordinateClaimConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed: rooms.id')
    || message.includes('UNIQUE constraint failed: rooms.x, rooms.y')
    || message.includes('UNIQUE constraint failed: world_room_claims');
}
