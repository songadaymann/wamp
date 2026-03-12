import type { AuthUser } from '../../../auth/model';
import {
  cloneRoomSnapshot,
  DEFAULT_ROOM_COORDINATES,
  createDefaultRoomRecord,
  createRoomVersionRecord,
  isRoomMinted,
  type RoomCoordinates,
  type RoomRecord,
  type RoomSnapshot,
  type RoomVersionRecord,
} from '../../../persistence/roomModel';
import { normalizeAddress } from '../auth/store';
import { HttpError } from '../core/http';
import type {
  D1PreparedStatement,
  Env,
  PersistRoomRecordInput,
  PersistRoomVersionInput,
  RoomRow,
  RoomVersionRow,
} from '../core/types';
import { syncRoomOwnershipFromChain } from '../mint/service';

const DEFAULT_DAILY_ROOM_CLAIM_LIMIT = 1;

export interface RoomClaimQuota {
  limit: number | null;
  claimsUsedToday: number;
  claimsRemainingToday: number | null;
}

export async function loadRoomRecord(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  viewerUserId: string | null = null,
  viewerWalletAddress: string | null = null,
  viewerIsAdmin = false
): Promise<RoomRecord> {
  const row = await env.DB.prepare(
    `
      SELECT
        id,
        x,
        y,
        draft_json,
        published_json,
        draft_title,
        published_title,
        claimer_user_id,
        claimer_display_name,
        claimed_at,
        last_published_by_user_id,
        last_published_by_display_name,
        minted_chain_id,
        minted_contract_address,
        minted_token_id,
        minted_owner_wallet_address,
        minted_owner_synced_at
      FROM rooms
      WHERE id = ? OR (x = ? AND y = ?)
      LIMIT 1
    `
  )
    .bind(roomId, coordinates.x, coordinates.y)
    .first<RoomRow>();

  if (!row) {
    const emptyRecord = createDefaultRoomRecord(roomId, coordinates);
    return {
      ...emptyRecord,
      permissions: buildRoomPermissions(
        emptyRecord,
        viewerUserId,
        viewerWalletAddress,
        viewerIsAdmin
      ),
    };
  }

  const draft = parseStoredSnapshot(row.draft_json, 'draft room');
  const published = row.published_json
    ? parseStoredSnapshot(row.published_json, 'published room')
    : null;
  const versions = await loadRoomVersions(env, row.id);

  const record: RoomRecord = {
    draft,
    published,
    versions,
    claimerUserId: row.claimer_user_id,
    claimerDisplayName: row.claimer_display_name,
    claimedAt: row.claimed_at,
    lastPublishedByUserId: row.last_published_by_user_id,
    lastPublishedByDisplayName: row.last_published_by_display_name,
    mintedChainId: row.minted_chain_id,
    mintedContractAddress: row.minted_contract_address,
    mintedTokenId: row.minted_token_id,
    mintedOwnerWalletAddress: row.minted_owner_wallet_address,
    mintedOwnerSyncedAt: row.minted_owner_synced_at,
    permissions: {
      canSaveDraft: true,
      canPublish: true,
      canRevert: false,
      canMint: true,
    },
  };

  return {
    ...record,
    permissions: buildRoomPermissions(record, viewerUserId, viewerWalletAddress, viewerIsAdmin),
  };
}

export async function loadRoomRecordForMutation(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  actor: AuthUser | null,
  actorIsAdmin = false
): Promise<RoomRecord> {
  const record = await loadRoomRecord(
    env,
    roomId,
    coordinates,
    actor?.id ?? null,
    actor?.walletAddress ?? null,
    actorIsAdmin
  );
  await syncRoomOwnershipFromChain(env, record, actor);
  return loadRoomRecord(
    env,
    roomId,
    coordinates,
    actor?.id ?? null,
    actor?.walletAddress ?? null,
    actorIsAdmin
  );
}

export async function loadPublishedRoom(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates
): Promise<RoomSnapshot | null> {
  const row = await env.DB.prepare(
    `
      SELECT published_json
      FROM rooms
      WHERE id = ? OR (x = ? AND y = ?)
      LIMIT 1
    `
  )
    .bind(roomId, coordinates.x, coordinates.y)
    .first<{ published_json: string | null }>();

  if (!row?.published_json) {
    return null;
  }

  return parseStoredSnapshot(row.published_json, 'published room');
}

export async function loadPublishedRoomsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<RoomSnapshot[]> {
  const result = await env.DB.prepare(
    `
      SELECT published_json
      FROM rooms
      WHERE published_json IS NOT NULL
        AND x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
    `
  )
    .bind(minX, maxX, minY, maxY)
    .all<{ published_json: string }>();

  return result.results.map((row) =>
    parseStoredSnapshot(row.published_json, 'published room')
  );
}

export async function loadRoomVersions(env: Env, roomId: string): Promise<RoomVersionRecord[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        version,
        snapshot_json,
        title,
        created_at,
        published_by_user_id,
        published_by_display_name,
        reverted_from_version
      FROM room_versions
      WHERE room_id = ?
      ORDER BY version ASC
    `
  )
    .bind(roomId)
    .all<RoomVersionRow>();

  return result.results.map((row) => {
    const snapshot = parseStoredSnapshot(row.snapshot_json, 'room version');
    return createRoomVersionRecord(snapshot, {
      version: row.version,
      createdAt: row.created_at,
      publishedByUserId: row.published_by_user_id,
      publishedByDisplayName: row.published_by_display_name,
      revertedFromVersion: row.reverted_from_version,
    });
  });
}

export async function saveDraft(
  env: Env,
  incomingRoom: RoomSnapshot,
  actor: AuthUser | null,
  actorIsAdmin = false
): Promise<RoomRecord> {
  const viewerUserId = actor?.id ?? null;
  const viewerWalletAddress = actor?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    incomingRoom.id,
    incomingRoom.coordinates,
    actor,
    actorIsAdmin
  );
  if (!existing.permissions.canSaveDraft) {
    throw new HttpError(403, 'Only the room token owner can save drafts for this minted room.');
  }
  const now = new Date().toISOString();

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(incomingRoom),
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: existing.published?.publishedAt ?? null,
    status: 'draft',
    version: existing.draft.version || 1,
  };

  await env.DB.batch([
    preparePersistRoomRecordStatement(env, {
      draft,
      published: existing.published,
      claimerUserId: existing.claimerUserId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
    }),
  ]);

  return loadRoomRecord(
    env,
    draft.id,
    draft.coordinates,
    viewerUserId,
    viewerWalletAddress,
    actorIsAdmin
  );
}

export async function publishRoom(
  env: Env,
  incomingRoom: RoomSnapshot,
  actor: AuthUser | null,
  actorIsAdmin = false
): Promise<RoomRecord> {
  const viewerUserId = actor?.id ?? null;
  const viewerWalletAddress = actor?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    incomingRoom.id,
    incomingRoom.coordinates,
    actor,
    actorIsAdmin
  );
  if (!existing.permissions.canPublish) {
    throw new HttpError(403, 'Only the room token owner can publish this minted room.');
  }

  const now = new Date().toISOString();
  const lastPublished = existing.versions[existing.versions.length - 1];
  const lastPublishedVersion = lastPublished ? lastPublished.version : 0;
  const nextVersion =
    lastPublishedVersion > 0 ? lastPublishedVersion + 1 : Math.max(1, incomingRoom.version);
  const publishedByUserId = actor?.id ?? null;
  const publishedByDisplayName = actor?.displayName ?? 'Guest';
  const shouldClaim = !existing.claimerUserId && actor !== null;
  if (shouldClaim && !actorIsAdmin) {
    await enforceFrontierClaimRule(env, incomingRoom.coordinates);
    await enforceDailyRoomClaimLimit(env, actor.id, now);
  }
  const claimerUserId = shouldClaim ? actor.id : existing.claimerUserId;
  const claimerDisplayName = shouldClaim ? actor.displayName : existing.claimerDisplayName;
  const claimedAt = shouldClaim ? now : existing.claimedAt;

  const published: RoomSnapshot = {
    ...cloneRoomSnapshot(incomingRoom),
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: now,
    status: 'published',
    version: nextVersion,
  };

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(published),
    status: 'draft',
  };

  await env.DB.batch([
    preparePersistRoomRecordStatement(env, {
      draft,
      published,
      claimerUserId,
      claimerDisplayName,
      claimedAt,
      lastPublishedByUserId: publishedByUserId,
      lastPublishedByDisplayName: publishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
    }),
    preparePersistRoomVersionStatement(env, {
      snapshot: published,
      createdAt: published.publishedAt ?? now,
      publishedByUserId,
      publishedByDisplayName,
      revertedFromVersion: null,
      onConflictUpdate: true,
    }),
  ]);

  return loadRoomRecord(
    env,
    draft.id,
    draft.coordinates,
    viewerUserId,
    viewerWalletAddress,
    actorIsAdmin
  );
}

export async function revertRoom(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  targetVersion: number,
  actor: AuthUser | null,
  actorIsAdmin = false
): Promise<RoomRecord> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new HttpError(400, 'targetVersion must be a positive integer.');
  }

  const viewerUserId = actor?.id ?? null;
  const viewerWalletAddress = actor?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    roomId,
    coordinates,
    actor,
    actorIsAdmin
  );
  if (!existing.permissions.canRevert) {
    if (isRoomMinted(existing)) {
      throw new HttpError(403, 'Only the room token owner can revert this minted room.');
    }

    throw new HttpError(403, 'Only the claimer can revert this room.');
  }

  const target = existing.versions.find((version) => version.version === targetVersion) ?? null;
  if (!target) {
    throw new HttpError(404, `Version ${targetVersion} was not found.`);
  }

  const now = new Date().toISOString();
  const lastPublished = existing.versions[existing.versions.length - 1];
  const nextVersion = (lastPublished?.version ?? 0) + 1;
  const publishedByDisplayName = actor?.displayName ?? existing.claimerDisplayName ?? 'Guest';
  const published: RoomSnapshot = {
    ...cloneRoomSnapshot(target.snapshot),
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: now,
    status: 'published',
    version: nextVersion,
  };

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(published),
    status: 'draft',
  };

  await env.DB.batch([
    preparePersistRoomRecordStatement(env, {
      draft,
      published,
      claimerUserId: existing.claimerUserId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: actor?.id ?? null,
      lastPublishedByDisplayName: publishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
    }),
    preparePersistRoomVersionStatement(env, {
      snapshot: published,
      createdAt: now,
      publishedByUserId: actor?.id ?? null,
      publishedByDisplayName,
      revertedFromVersion: target.version,
      onConflictUpdate: false,
    }),
  ]);

  return loadRoomRecord(
    env,
    draft.id,
    draft.coordinates,
    viewerUserId,
    viewerWalletAddress,
    actorIsAdmin
  );
}

export function parseStoredSnapshot(raw: string, label: string): RoomSnapshot {
  try {
    const parsed = JSON.parse(raw) as RoomSnapshot;
    return cloneRoomSnapshot(parsed);
  } catch {
    throw new HttpError(500, `Failed to parse ${label}.`);
  }
}

function getDailyRoomClaimLimit(env: Env): number | null {
  const raw = env.ROOM_DAILY_CLAIM_LIMIT?.trim();
  if (!raw) {
    return DEFAULT_DAILY_ROOM_CLAIM_LIMIT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return DEFAULT_DAILY_ROOM_CLAIM_LIMIT;
  }

  if (parsed <= 0) {
    return null;
  }

  return parsed;
}

export async function getRoomClaimQuota(
  env: Env,
  userId: string,
  nowIso: string = new Date().toISOString()
): Promise<RoomClaimQuota> {
  const limit = getDailyRoomClaimLimit(env);
  const claimsUsedToday = await countRoomClaimsSince(env, userId, getUtcDayStartIso(nowIso));

  return {
    limit,
    claimsUsedToday,
    claimsRemainingToday: limit === null ? null : Math.max(0, limit - claimsUsedToday),
  };
}

function getUtcDayStartIso(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

async function countRoomClaimsSince(env: Env, userId: string, startIso: string): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS claim_count
      FROM rooms
      WHERE claimer_user_id = ?
        AND claimed_at IS NOT NULL
        AND claimed_at >= ?
    `
  )
    .bind(userId, startIso)
    .first<{ claim_count: number | string | null }>();

  return Number(row?.claim_count ?? 0);
}

async function countPublishedRooms(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    `
      SELECT COUNT(*) AS published_count
      FROM rooms
      WHERE published_json IS NOT NULL
    `
  ).first<{ published_count: number | string | null }>();

  return Number(row?.published_count ?? 0);
}

async function hasPublishedOrthogonalNeighbor(
  env: Env,
  coordinates: RoomCoordinates
): Promise<boolean> {
  const row = await env.DB.prepare(
    `
      SELECT 1
      FROM rooms
      WHERE published_json IS NOT NULL
        AND (
          (x = ? AND y = ?)
          OR (x = ? AND y = ?)
          OR (x = ? AND y = ?)
          OR (x = ? AND y = ?)
        )
      LIMIT 1
    `
  )
    .bind(
      coordinates.x + 1,
      coordinates.y,
      coordinates.x - 1,
      coordinates.y,
      coordinates.x,
      coordinates.y + 1,
      coordinates.x,
      coordinates.y - 1
    )
    .first<Record<string, never>>();

  return Boolean(row);
}

async function enforceFrontierClaimRule(env: Env, coordinates: RoomCoordinates): Promise<void> {
  const publishedCount = await countPublishedRooms(env);
  if (publishedCount === 0) {
    if (
      coordinates.x === DEFAULT_ROOM_COORDINATES.x &&
      coordinates.y === DEFAULT_ROOM_COORDINATES.y
    ) {
      return;
    }

    throw new HttpError(409, 'The first published room must be at 0,0.');
  }

  if (await hasPublishedOrthogonalNeighbor(env, coordinates)) {
    return;
  }

  throw new HttpError(
    409,
    'New rooms can only be claimed directly adjacent to an existing published room.'
  );
}

async function enforceDailyRoomClaimLimit(
  env: Env,
  userId: string,
  nowIso: string
): Promise<void> {
  const limit = getDailyRoomClaimLimit(env);
  if (limit === null) {
    return;
  }

  const claimsToday = await countRoomClaimsSince(env, userId, getUtcDayStartIso(nowIso));
  if (claimsToday < limit) {
    return;
  }

  const roomWord = limit === 1 ? 'room' : 'rooms';
  throw new HttpError(
    429,
    `Daily room claim limit reached. You can claim ${limit} new ${roomWord} per UTC day.`
  );
}

export const UPSERT_ROOM_RECORD_SQL = `
  INSERT INTO rooms (
    id,
    x,
    y,
    draft_json,
    published_json,
    draft_title,
    published_title,
    draft_goal_type,
    draft_goal_json,
    draft_spawn_x,
    draft_spawn_y,
    published_goal_type,
    published_goal_json,
    published_spawn_x,
    published_spawn_y,
    claimer_user_id,
    claimer_display_name,
    claimed_at,
    last_published_by_user_id,
    last_published_by_display_name,
    minted_chain_id,
    minted_contract_address,
    minted_token_id,
    minted_owner_wallet_address,
    minted_owner_synced_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    x = excluded.x,
    y = excluded.y,
    draft_json = excluded.draft_json,
    published_json = excluded.published_json,
    draft_title = excluded.draft_title,
    published_title = excluded.published_title,
    draft_goal_type = excluded.draft_goal_type,
    draft_goal_json = excluded.draft_goal_json,
    draft_spawn_x = excluded.draft_spawn_x,
    draft_spawn_y = excluded.draft_spawn_y,
    published_goal_type = excluded.published_goal_type,
    published_goal_json = excluded.published_goal_json,
    published_spawn_x = excluded.published_spawn_x,
    published_spawn_y = excluded.published_spawn_y,
    claimer_user_id = excluded.claimer_user_id,
    claimer_display_name = excluded.claimer_display_name,
    claimed_at = excluded.claimed_at,
    last_published_by_user_id = excluded.last_published_by_user_id,
    last_published_by_display_name = excluded.last_published_by_display_name,
    minted_chain_id = excluded.minted_chain_id,
    minted_contract_address = excluded.minted_contract_address,
    minted_token_id = excluded.minted_token_id,
    minted_owner_wallet_address = excluded.minted_owner_wallet_address,
    minted_owner_synced_at = excluded.minted_owner_synced_at
`;

export const INSERT_ROOM_VERSION_SQL = `
  INSERT INTO room_versions (
    room_id,
    version,
    snapshot_json,
    title,
    goal_type,
    goal_json,
    spawn_x,
    spawn_y,
    created_at,
    published_by_user_id,
    published_by_display_name,
    reverted_from_version
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export const UPSERT_ROOM_VERSION_SQL = `
  ${INSERT_ROOM_VERSION_SQL}
  ON CONFLICT(room_id, version) DO UPDATE SET
    snapshot_json = excluded.snapshot_json,
    title = excluded.title,
    goal_type = excluded.goal_type,
    goal_json = excluded.goal_json,
    spawn_x = excluded.spawn_x,
    spawn_y = excluded.spawn_y,
    created_at = excluded.created_at,
    published_by_user_id = excluded.published_by_user_id,
    published_by_display_name = excluded.published_by_display_name,
    reverted_from_version = excluded.reverted_from_version
`;

export function preparePersistRoomRecordStatement(
  env: Env,
  input: PersistRoomRecordInput
): D1PreparedStatement {
  const draftMetadata = getRoomSnapshotStorageMetadata(input.draft);
  const publishedMetadata = getRoomSnapshotStorageMetadata(input.published);

  return env.DB.prepare(UPSERT_ROOM_RECORD_SQL).bind(
    input.draft.id,
    input.draft.coordinates.x,
    input.draft.coordinates.y,
    JSON.stringify(input.draft),
    input.published ? JSON.stringify(input.published) : null,
    draftMetadata.title,
    publishedMetadata.title,
    draftMetadata.goalType,
    draftMetadata.goalJson,
    draftMetadata.spawnX,
    draftMetadata.spawnY,
    publishedMetadata.goalType,
    publishedMetadata.goalJson,
    publishedMetadata.spawnX,
    publishedMetadata.spawnY,
    input.claimerUserId,
    input.claimerDisplayName,
    input.claimedAt,
    input.lastPublishedByUserId,
    input.lastPublishedByDisplayName,
    input.mintedChainId,
    input.mintedContractAddress,
    input.mintedTokenId,
    input.mintedOwnerWalletAddress,
    input.mintedOwnerSyncedAt
  );
}

export function preparePersistRoomVersionStatement(
  env: Env,
  input: PersistRoomVersionInput
): D1PreparedStatement {
  const metadata = getRoomSnapshotStorageMetadata(input.snapshot);
  const query = input.onConflictUpdate ? UPSERT_ROOM_VERSION_SQL : INSERT_ROOM_VERSION_SQL;

  return env.DB.prepare(query).bind(
    input.snapshot.id,
    input.snapshot.version,
    JSON.stringify(input.snapshot),
    metadata.title,
    metadata.goalType,
    metadata.goalJson,
    metadata.spawnX,
    metadata.spawnY,
    input.createdAt,
    input.publishedByUserId,
    input.publishedByDisplayName,
    input.revertedFromVersion
  );
}

export function getRoomSnapshotStorageMetadata(snapshot: RoomSnapshot | null): {
  title: string | null;
  goalType: string | null;
  goalJson: string | null;
  spawnX: number | null;
  spawnY: number | null;
} {
  return {
    title: snapshot?.title ?? null,
    goalType: snapshot?.goal?.type ?? null,
    goalJson: snapshot?.goal ? JSON.stringify(snapshot.goal) : null,
    spawnX: snapshot?.spawnPoint?.x ?? null,
    spawnY: snapshot?.spawnPoint?.y ?? null,
  };
}

export function buildRoomPermissions(
  record: RoomRecord,
  viewerUserId: string | null,
  viewerWalletAddress: string | null,
  viewerIsAdmin = false
): RoomRecord['permissions'] {
  if (viewerIsAdmin) {
    return {
      canSaveDraft: true,
      canPublish: true,
      canRevert: true,
      canMint:
        !isRoomMinted(record) &&
        record.published !== null &&
        viewerUserId !== null &&
        viewerWalletAddress !== null,
    };
  }

  const minted = isRoomMinted(record);
  const ownsMintedRoom =
    minted &&
    viewerWalletAddress !== null &&
    record.mintedOwnerWalletAddress !== null &&
    normalizeAddress(viewerWalletAddress) === normalizeAddress(record.mintedOwnerWalletAddress);

  return {
    canSaveDraft: !minted || ownsMintedRoom,
    canPublish: !minted || ownsMintedRoom,
    canRevert: minted
      ? ownsMintedRoom
      : viewerUserId !== null && viewerUserId === record.claimerUserId,
    canMint:
      !minted &&
      record.published !== null &&
      viewerUserId !== null &&
      viewerWalletAddress !== null &&
      (record.claimerUserId === null || viewerUserId === record.claimerUserId),
  };
}
