import type { AuthUser } from '../../../auth/model';
import type { PrincipalKind, RequestAuthSource } from '../../../agents/model';
import {
  cloneRoomSnapshot,
  createEmptyTileData,
  DEFAULT_ROOM_COORDINATES,
  createDefaultRoomRecord,
  createRoomVersionRecord,
  getRoomPublishValidationError,
  isRoomMinted,
  type RoomCoordinates,
  type RoomCurrentRecord,
  type RoomRecord,
  type RoomSnapshotQueryReference,
  type RoomSnapshotQueryResponse,
  type RoomSnapshot,
  type RoomSummary,
  type RoomVersionRecord,
  type RoomVersionSummary,
  type RoomVersionsPage,
} from '../../../persistence/roomModel';
import type {
  ClaimedUnpublishedWorldRoomSource,
  PublishedWorldRoomSource,
  WorldRoomSummary,
} from '../../../persistence/worldModel';
import { buildRoomVersionLineage } from '../../../persistence/roomVersionLineage';
import { getManualRoomLeaderboardSourceValidationError } from '../../../persistence/roomLeaderboardLineage';
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
import { prepareMusicPhrasePublishStatements } from '../music/store';
import { assertCustomBackgroundApproved } from '../backgroundImages/routes';
import {
  enforceRoomMutationGuardrails,
  getDailyRoomClaimLimitForUser,
} from './guardrails';

export interface RoomClaimQuota {
  limit: number | null;
  claimsUsedToday: number;
  claimsRemainingToday: number | null;
}

export interface RoomMutationActor {
  ownerUser: AuthUser | null;
  principalKind: PrincipalKind;
  principalAgentId: string | null;
  principalDisplayName: string;
  requestAuthSource: RequestAuthSource | null;
}

export async function loadRoomRecord(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  viewerUserId: string | null = null,
  viewerWalletAddress: string | null = null,
  viewerIsAdmin = false
): Promise<RoomRecord> {
  const roomStatement = env.DB.prepare(
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
        claimer_principal_type,
        claimer_agent_id,
        claimer_display_name,
        claimed_at,
        last_published_by_user_id,
        last_published_by_principal_type,
        last_published_by_agent_id,
        last_published_by_display_name,
        minted_chain_id,
        minted_contract_address,
        minted_token_id,
        minted_owner_wallet_address,
        minted_owner_synced_at,
        minted_metadata_room_version,
        minted_metadata_updated_at,
        minted_metadata_hash,
        canonical_version
      FROM rooms
      WHERE id = ? OR (x = ? AND y = ?)
      LIMIT 1
    `
  )
    .bind(roomId, coordinates.x, coordinates.y);
  const versionsStatement = prepareLoadRoomVersionsStatement(env, roomId);
  const [roomResult, versionsResult] = await env.DB.batch<{
    results: Array<RoomRow | RoomVersionRow>;
  }>([roomStatement, versionsStatement]);
  const rowCandidate = roomResult?.results[0];
  const row = rowCandidate && 'draft_json' in rowCandidate ? rowCandidate : null;

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
  const batchedVersionRows = (versionsResult?.results ?? []).filter(
    (candidate): candidate is RoomVersionRow => 'snapshot_json' in candidate,
  );
  const versions = row.id === roomId
    ? mapStoredRoomVersions(batchedVersionRows)
    : await loadRoomVersions(env, row.id);

  const record: RoomRecord = {
    draft,
    published,
    versions,
    canonicalVersion: row.canonical_version,
    claimerUserId: row.claimer_user_id,
    claimerPrincipalKind: row.claimer_principal_type,
    claimerAgentId: row.claimer_agent_id,
    claimerDisplayName: row.claimer_display_name,
    claimedAt: row.claimed_at,
    lastPublishedByUserId: row.last_published_by_user_id,
    lastPublishedByPrincipalKind: row.last_published_by_principal_type,
    lastPublishedByAgentId: row.last_published_by_agent_id,
    lastPublishedByDisplayName: row.last_published_by_display_name,
    mintedChainId: row.minted_chain_id,
    mintedContractAddress: row.minted_contract_address,
    mintedTokenId: row.minted_token_id,
    mintedOwnerWalletAddress: row.minted_owner_wallet_address,
    mintedOwnerSyncedAt: row.minted_owner_synced_at,
    mintedMetadataRoomVersion: row.minted_metadata_room_version,
    mintedMetadataUpdatedAt: row.minted_metadata_updated_at,
    mintedMetadataHash: row.minted_metadata_hash,
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

interface CompactRoomRow extends RoomRow {
  draft_version: number | null;
  published_version: number | null;
  draft_updated_at: string | null;
  published_updated_at: string | null;
}

const COMPACT_ROOM_COLUMNS = `
  id,
  x,
  y,
  draft_title,
  published_title,
  claimer_user_id,
  claimer_principal_type,
  claimer_agent_id,
  claimer_display_name,
  claimed_at,
  last_published_by_user_id,
  last_published_by_principal_type,
  last_published_by_agent_id,
  last_published_by_display_name,
  minted_chain_id,
  minted_contract_address,
  minted_token_id,
  minted_owner_wallet_address,
  minted_owner_synced_at,
  minted_metadata_room_version,
  minted_metadata_updated_at,
  minted_metadata_hash,
  canonical_version,
  CAST(json_extract(draft_json, '$.version') AS INTEGER) AS draft_version,
  CAST(json_extract(published_json, '$.version') AS INTEGER) AS published_version,
  json_extract(draft_json, '$.updatedAt') AS draft_updated_at,
  json_extract(published_json, '$.updatedAt') AS published_updated_at
`;

export async function loadRoomSummary(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  viewerUserId: string | null = null,
  viewerWalletAddress: string | null = null,
  viewerIsAdmin = false,
): Promise<RoomSummary> {
  const row = await env.DB.prepare(
    `SELECT ${COMPACT_ROOM_COLUMNS} FROM rooms WHERE id = ? OR (x = ? AND y = ?) LIMIT 1`,
  ).bind(roomId, coordinates.x, coordinates.y).first<CompactRoomRow>();

  if (!row) {
    return roomSummaryFromRecord(
      createDefaultRoomRecord(roomId, coordinates),
      viewerUserId,
      viewerWalletAddress,
      viewerIsAdmin,
    );
  }

  return roomSummaryFromCompactRow(row, viewerUserId, viewerWalletAddress, viewerIsAdmin);
}

export async function loadRoomCurrent(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  viewerUserId: string | null = null,
  viewerWalletAddress: string | null = null,
  viewerIsAdmin = false,
): Promise<RoomCurrentRecord> {
  const row = await env.DB.prepare(
    `SELECT draft_json, published_json, ${COMPACT_ROOM_COLUMNS} FROM rooms WHERE id = ? OR (x = ? AND y = ?) LIMIT 1`,
  ).bind(roomId, coordinates.x, coordinates.y).first<CompactRoomRow>();

  if (!row) {
    const record = createDefaultRoomRecord(roomId, coordinates);
    return {
      summary: roomSummaryFromRecord(record, viewerUserId, viewerWalletAddress, viewerIsAdmin),
      draft: record.draft,
      published: null,
    };
  }

  return {
    summary: roomSummaryFromCompactRow(row, viewerUserId, viewerWalletAddress, viewerIsAdmin),
    draft: parseStoredSnapshot(row.draft_json, 'draft room'),
    published: row.published_json ? parseStoredSnapshot(row.published_json, 'published room') : null,
  };
}

export async function loadRoomVersionPage(
  env: Env,
  roomId: string,
  limit: number,
  cursor: string | null,
): Promise<RoomVersionsPage> {
  const beforeVersion = cursor ? decodeRoomVersionCursor(cursor) : null;
  const result = await env.DB.prepare(
    `
      SELECT
        version,
        title,
        created_at,
        published_by_user_id,
        published_by_principal_type,
        published_by_agent_id,
        published_by_display_name,
        reverted_from_version,
        leaderboard_source_version
      FROM room_versions
      WHERE room_id = ? AND (? IS NULL OR version < ?)
      ORDER BY version DESC
      LIMIT ?
    `,
  ).bind(roomId, beforeVersion, beforeVersion, limit + 1).all<Omit<RoomVersionRow, 'snapshot_json'>>();
  const hasMore = result.results.length > limit;
  const rows = result.results.slice(0, limit);
  const versions: RoomVersionSummary[] = rows.map((row) => ({
    version: row.version,
    title: row.title,
    createdAt: row.created_at,
    publishedByUserId: row.published_by_user_id,
    publishedByPrincipalKind: row.published_by_principal_type,
    publishedByAgentId: row.published_by_agent_id,
    publishedByDisplayName: row.published_by_display_name,
    revertedFromVersion: row.reverted_from_version,
    leaderboardSourceVersion: row.leaderboard_source_version,
  }));
  const last = versions.at(-1);
  return {
    versions,
    ...(hasMore && last ? { nextCursor: encodeRoomVersionCursor(last.version) } : {}),
  };
}

export async function loadExactRoomVersion(
  env: Env,
  roomId: string,
  version: number,
): Promise<RoomVersionRecord | null> {
  const row = await env.DB.prepare(
    `
      SELECT
        version,
        snapshot_json,
        title,
        created_at,
        published_by_user_id,
        published_by_principal_type,
        published_by_agent_id,
        published_by_display_name,
        reverted_from_version,
        leaderboard_source_version
      FROM room_versions
      WHERE room_id = ? AND version = ?
      LIMIT 1
    `,
  ).bind(roomId, version).first<RoomVersionRow>();
  return row ? mapStoredRoomVersions([row])[0] ?? null : null;
}

export async function loadRoomSnapshotsByReferences(
  env: Env,
  references: RoomSnapshotQueryReference[],
): Promise<RoomSnapshotQueryResponse> {
  if (references.length > 128) {
    throw new HttpError(400, 'A maximum of 128 room snapshot references is allowed.');
  }

  const uniqueReferences = dedupeSnapshotReferences(references);
  const versionReferences = uniqueReferences.filter(
    (reference): reference is Extract<RoomSnapshotQueryReference, { kind: 'version' }> => reference.kind === 'version',
  );
  const currentReferences = uniqueReferences.filter(
    (reference): reference is Extract<RoomSnapshotQueryReference, { kind: 'current_preview' }> => reference.kind === 'current_preview',
  );
  const versionStatements = chunkArray(versionReferences, 40).map((chunk) => env.DB.prepare(
    `SELECT room_id, version, snapshot_json FROM room_versions WHERE (room_id, version) IN (${chunk.map(() => '(?, ?)').join(', ')})`,
  ).bind(...chunk.flatMap((reference) => [reference.roomId, reference.version])));
  const currentStatements = chunkArray(currentReferences, 60).map((chunk) => env.DB.prepare(
    `SELECT id, x, y, draft_json, published_json FROM rooms WHERE id IN (${chunk.map(() => '?').join(', ')})`,
  ).bind(...chunk.map((reference) => reference.roomId)));
  const results = versionStatements.length + currentStatements.length > 0
    ? await env.DB.batch<{ results: Record<string, unknown>[] }>([...versionStatements, ...currentStatements])
    : [];
  const snapshotsByKey = new Map<string, RoomSnapshot>();

  for (const result of results.slice(0, versionStatements.length)) {
    for (const row of result?.results ?? []) {
      const roomId = String(row.room_id);
      const version = Number(row.version);
      snapshotsByKey.set(
        snapshotReferenceKey({ kind: 'version', roomId, version }),
        parseStoredSnapshot(String(row.snapshot_json), 'room version'),
      );
    }
  }

  const currentRows = results.slice(versionStatements.length).flatMap((result) => result?.results ?? []);
  for (const reference of currentReferences) {
    const row = currentRows.find((candidate) => String(candidate.id) === reference.roomId);
    if (!row) continue;
    if (reference.state === 'claimed_unpublished' && typeof row.published_json === 'string') continue;
    const raw = reference.state === 'claimed_unpublished' ? row.draft_json : row.published_json;
    if (typeof raw !== 'string') continue;
    const snapshot = parseStoredSnapshot(raw, 'current preview room');
    if (reference.coordinates && (
      snapshot.coordinates.x !== reference.coordinates.x || snapshot.coordinates.y !== reference.coordinates.y
    )) continue;
    if (reference.updatedAt && snapshot.updatedAt !== reference.updatedAt) continue;
    snapshotsByKey.set(snapshotReferenceKey(reference), snapshot);
  }

  return {
    snapshots: uniqueReferences.flatMap((reference) => {
      const key = snapshotReferenceKey(reference);
      const snapshot = snapshotsByKey.get(key);
      return snapshot ? [{ key, reference, snapshot }] : [];
    }),
    missing: uniqueReferences.filter((reference) => !snapshotsByKey.has(snapshotReferenceKey(reference))),
  };
}

export function createOverviewRoomSnapshot(snapshot: RoomSnapshot): RoomSnapshot {
  const tileData = createEmptyTileData();
  tileData.background = snapshot.tileData.background;
  tileData.terrain = snapshot.tileData.terrain;
  tileData.foreground = [];
  return {
    ...snapshot,
    goalIntroText: null,
    music: null,
    goal: null,
    spawnPoint: null,
    tileData,
    placedObjects: [],
    customSprites: [],
    tilesetHint: null,
  };
}

export async function loadUnavailableRoomIdsForClaim(
  env: Env,
  roomIds: string[],
): Promise<Set<string>> {
  const uniqueIds = [...new Set(roomIds)];
  const statements = chunkArray(uniqueIds, 80).map((chunk) => env.DB.prepare(
    `
      SELECT id
      FROM rooms
      WHERE id IN (${chunk.map(() => '?').join(', ')})
        AND (
          published_json IS NOT NULL
          OR claimer_user_id IS NOT NULL
          OR claimed_at IS NOT NULL
          OR minted_chain_id IS NOT NULL
          OR minted_contract_address IS NOT NULL
          OR minted_token_id IS NOT NULL
        )
    `,
  ).bind(...chunk));
  if (statements.length === 0) return new Set();
  const results = await env.DB.batch<{ results: Array<{ id: string }> }>(statements);
  return new Set(results.flatMap((result) => result?.results ?? []).map((row) => row.id));
}

export function encodeRoomVersionCursor(version: number): string {
  return btoa(`room-version:${version}`);
}

export function decodeRoomVersionCursor(cursor: string): number {
  try {
    const decoded = atob(cursor);
    const match = /^room-version:(\d+)$/.exec(decoded);
    const version = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid');
    return version;
  } catch {
    throw new HttpError(400, 'Invalid room version cursor.');
  }
}

export function snapshotReferenceKey(reference: RoomSnapshotQueryReference): string {
  if (reference.kind === 'version') return `version:${reference.roomId}:${reference.version}`;
  return `current:${reference.roomId}:${reference.state ?? 'published'}:${reference.updatedAt ?? ''}`;
}

export function dedupeSnapshotReferences(references: RoomSnapshotQueryReference[]): RoomSnapshotQueryReference[] {
  const byKey = new Map<string, RoomSnapshotQueryReference>();
  for (const reference of references) byKey.set(snapshotReferenceKey(reference), reference);
  return [...byKey.values()];
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function roomSummaryFromCompactRow(
  row: CompactRoomRow,
  viewerUserId: string | null,
  viewerWalletAddress: string | null,
  viewerIsAdmin: boolean,
): RoomSummary {
  const shell = {
    ...createDefaultRoomRecord(row.id, { x: row.x, y: row.y }),
    canonicalVersion: row.canonical_version,
    claimerUserId: row.claimer_user_id,
    claimerPrincipalKind: row.claimer_principal_type,
    claimerAgentId: row.claimer_agent_id,
    claimerDisplayName: row.claimer_display_name,
    claimedAt: row.claimed_at,
    lastPublishedByUserId: row.last_published_by_user_id,
    lastPublishedByPrincipalKind: row.last_published_by_principal_type,
    lastPublishedByAgentId: row.last_published_by_agent_id,
    lastPublishedByDisplayName: row.last_published_by_display_name,
    mintedChainId: row.minted_chain_id,
    mintedContractAddress: row.minted_contract_address,
    mintedTokenId: row.minted_token_id,
    mintedOwnerWalletAddress: row.minted_owner_wallet_address,
    mintedOwnerSyncedAt: row.minted_owner_synced_at,
    mintedMetadataRoomVersion: row.minted_metadata_room_version,
    mintedMetadataUpdatedAt: row.minted_metadata_updated_at,
    mintedMetadataHash: row.minted_metadata_hash,
  } satisfies RoomRecord;
  return {
    id: row.id,
    coordinates: { x: row.x, y: row.y },
    draftTitle: row.draft_title,
    publishedTitle: row.published_title,
    draftVersion: row.draft_version ?? 1,
    publishedVersion: row.published_version,
    draftUpdatedAt: row.draft_updated_at ?? shell.draft.updatedAt,
    publishedUpdatedAt: row.published_updated_at,
    canonicalVersion: row.canonical_version,
    claimerUserId: row.claimer_user_id,
    claimerPrincipalKind: row.claimer_principal_type,
    claimerAgentId: row.claimer_agent_id,
    claimerDisplayName: row.claimer_display_name,
    claimedAt: row.claimed_at,
    lastPublishedByUserId: row.last_published_by_user_id,
    lastPublishedByPrincipalKind: row.last_published_by_principal_type,
    lastPublishedByAgentId: row.last_published_by_agent_id,
    lastPublishedByDisplayName: row.last_published_by_display_name,
    mintedChainId: row.minted_chain_id,
    mintedContractAddress: row.minted_contract_address,
    mintedTokenId: row.minted_token_id,
    mintedOwnerWalletAddress: row.minted_owner_wallet_address,
    mintedOwnerSyncedAt: row.minted_owner_synced_at,
    mintedMetadataRoomVersion: row.minted_metadata_room_version,
    mintedMetadataUpdatedAt: row.minted_metadata_updated_at,
    mintedMetadataHash: row.minted_metadata_hash,
    permissions: buildRoomPermissions(shell, viewerUserId, viewerWalletAddress, viewerIsAdmin),
  };
}

function roomSummaryFromRecord(
  record: RoomRecord,
  viewerUserId: string | null,
  viewerWalletAddress: string | null,
  viewerIsAdmin: boolean,
): RoomSummary {
  return {
    id: record.draft.id,
    coordinates: record.draft.coordinates,
    draftTitle: record.draft.title,
    publishedTitle: record.published?.title ?? null,
    draftVersion: record.draft.version,
    publishedVersion: record.published?.version ?? null,
    draftUpdatedAt: record.draft.updatedAt,
    publishedUpdatedAt: record.published?.updatedAt ?? null,
    canonicalVersion: record.canonicalVersion,
    claimerUserId: record.claimerUserId,
    claimerPrincipalKind: record.claimerPrincipalKind,
    claimerAgentId: record.claimerAgentId,
    claimerDisplayName: record.claimerDisplayName,
    claimedAt: record.claimedAt,
    lastPublishedByUserId: record.lastPublishedByUserId,
    lastPublishedByPrincipalKind: record.lastPublishedByPrincipalKind,
    lastPublishedByAgentId: record.lastPublishedByAgentId,
    lastPublishedByDisplayName: record.lastPublishedByDisplayName,
    mintedChainId: record.mintedChainId,
    mintedContractAddress: record.mintedContractAddress,
    mintedTokenId: record.mintedTokenId,
    mintedOwnerWalletAddress: record.mintedOwnerWalletAddress,
    mintedOwnerSyncedAt: record.mintedOwnerSyncedAt,
    mintedMetadataRoomVersion: record.mintedMetadataRoomVersion,
    mintedMetadataUpdatedAt: record.mintedMetadataUpdatedAt,
    mintedMetadataHash: record.mintedMetadataHash,
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

export async function loadConstructionRoom(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates
): Promise<RoomSnapshot | null> {
  const row = await env.DB.prepare(
    `
      SELECT draft_json
      FROM rooms
      WHERE (id = ? OR (x = ? AND y = ?))
        AND published_json IS NULL
        AND claimer_user_id IS NOT NULL
        AND claimed_at IS NOT NULL
      LIMIT 1
    `
  )
    .bind(roomId, coordinates.x, coordinates.y)
    .first<{ draft_json: string | null }>();

  if (!row?.draft_json) {
    return null;
  }

  return parseStoredSnapshot(row.draft_json, 'construction room');
}

export async function loadPublishedRoomsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<PublishedWorldRoomSource[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        published_json,
        claimer_user_id,
        claimer_display_name,
        last_published_by_user_id,
        last_published_by_display_name
      FROM rooms
      WHERE published_json IS NOT NULL
        AND x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
    `
  )
    .bind(minX, maxX, minY, maxY)
    .all<{
      published_json: string;
      claimer_user_id: string | null;
      claimer_display_name: string | null;
      last_published_by_user_id: string | null;
      last_published_by_display_name: string | null;
    }>();

  return result.results.map((row) => ({
    state: 'published',
    snapshot: parseStoredSnapshot(row.published_json, 'published room'),
    creatorUserId: row.claimer_user_id ?? row.last_published_by_user_id,
    creatorDisplayName: row.claimer_display_name ?? row.last_published_by_display_name,
  }));
}

export async function loadClaimedUnpublishedRoomsInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): Promise<ClaimedUnpublishedWorldRoomSource[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        draft_json,
        claimer_user_id,
        claimer_display_name
      FROM rooms
      WHERE published_json IS NULL
        AND claimer_user_id IS NOT NULL
        AND claimed_at IS NOT NULL
        AND x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
    `
  )
    .bind(minX, maxX, minY, maxY)
    .all<{
      draft_json: string;
      claimer_user_id: string | null;
      claimer_display_name: string | null;
    }>();

  return result.results.map((row) => ({
    state: 'claimed_unpublished',
    snapshot: parseStoredSnapshot(row.draft_json, 'claimed unpublished room'),
    claimerUserId: row.claimer_user_id,
    claimerDisplayName: row.claimer_display_name,
  }));
}

export async function loadWorldRoomSummariesInBounds(
  env: Env,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): Promise<WorldRoomSummary[]> {
  const result = await env.DB.prepare(
    `
      SELECT
        id,
        x,
        y,
        CASE WHEN published_json IS NOT NULL THEN 'published' ELSE 'claimed_unpublished' END AS state,
        CASE WHEN published_json IS NOT NULL THEN published_title ELSE draft_title END AS title,
        CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.background')
          ELSE json_extract(draft_json, '$.background') END AS background,
        CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.goal.type')
          ELSE json_extract(draft_json, '$.goal.type') END AS goal_type,
        CAST(CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.version')
          ELSE json_extract(draft_json, '$.version') END AS INTEGER) AS version,
        CASE WHEN published_json IS NOT NULL THEN json_extract(published_json, '$.publishedAt') ELSE NULL END AS published_at,
        CASE WHEN published_json IS NOT NULL
          THEN json_extract(published_json, '$.updatedAt')
          ELSE json_extract(draft_json, '$.updatedAt') END AS preview_updated_at,
        claimer_user_id,
        claimer_display_name,
        last_published_by_user_id,
        last_published_by_display_name
      FROM rooms
      WHERE x BETWEEN ? AND ?
        AND y BETWEEN ? AND ?
        AND (published_json IS NOT NULL OR (claimer_user_id IS NOT NULL AND claimed_at IS NOT NULL))
    `,
  ).bind(minX, maxX, minY, maxY).all<{
    id: string;
    x: number;
    y: number;
    state: 'published' | 'claimed_unpublished';
    title: string | null;
    background: string | null;
    goal_type: WorldRoomSummary['goalType'];
    version: number | null;
    published_at: string | null;
    preview_updated_at: string | null;
    claimer_user_id: string | null;
    claimer_display_name: string | null;
    last_published_by_user_id: string | null;
    last_published_by_display_name: string | null;
  }>();
  return result.results.map((row) => ({
    id: row.id,
    coordinates: { x: Number(row.x), y: Number(row.y) },
    title: row.title,
    state: row.state,
    background: row.background,
    goalType: row.goal_type,
    version: row.version === null ? null : Number(row.version),
    publishedAt: row.published_at,
    previewUpdatedAt: row.preview_updated_at,
    creatorUserId: row.claimer_user_id ?? (row.state === 'published' ? row.last_published_by_user_id : null),
    creatorDisplayName: row.claimer_display_name ?? (row.state === 'published' ? row.last_published_by_display_name : null),
    publishedByUserId: row.state === 'published' ? row.last_published_by_user_id : null,
    publishedByDisplayName: row.state === 'published' ? row.last_published_by_display_name : null,
    course: null,
    expandedRoom: null,
  }));
}

export async function loadRoomVersions(env: Env, roomId: string): Promise<RoomVersionRecord[]> {
  const result = await prepareLoadRoomVersionsStatement(env, roomId).all<RoomVersionRow>();
  return mapStoredRoomVersions(result.results);
}

function prepareLoadRoomVersionsStatement(env: Env, roomId: string): D1PreparedStatement {
  return env.DB.prepare(
    `
      SELECT
        version,
        snapshot_json,
        title,
        created_at,
        published_by_user_id,
        published_by_principal_type,
        published_by_agent_id,
        published_by_display_name,
        reverted_from_version,
        leaderboard_source_version
      FROM room_versions
      WHERE room_id = ?
      ORDER BY version ASC
    `
  )
    .bind(roomId);
}

function mapStoredRoomVersions(rows: RoomVersionRow[]): RoomVersionRecord[] {
  return rows.map((row) => {
    const snapshot = parseStoredSnapshot(row.snapshot_json, 'room version');
    return createRoomVersionRecord(snapshot, {
      version: row.version,
      createdAt: row.created_at,
      publishedByUserId: row.published_by_user_id,
      publishedByPrincipalKind: row.published_by_principal_type,
      publishedByAgentId: row.published_by_agent_id,
      publishedByDisplayName: row.published_by_display_name,
      revertedFromVersion: row.reverted_from_version,
      leaderboardSourceVersion: row.leaderboard_source_version,
    });
  });
}

export async function saveDraft(
  env: Env,
  incomingRoom: RoomSnapshot,
  actor: RoomMutationActor,
  actorIsAdmin = false
): Promise<RoomRecord> {
  const viewerUserId = actor.ownerUser?.id ?? null;
  const viewerWalletAddress = actor.ownerUser?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    incomingRoom.id,
    incomingRoom.coordinates,
    actor.ownerUser,
    actorIsAdmin
  );
  if (!existing.permissions.canSaveDraft) {
    if (isRoomMinted(existing)) {
      throw new HttpError(403, 'Only the room token owner can save drafts for this minted room.');
    }

    throw new HttpError(403, 'Only the room claimer can save drafts for this unpublished room.');
  }
  const now = new Date().toISOString();
  if (!actorIsAdmin) {
    if (!actor.ownerUser) {
      throw new HttpError(401, 'Sign in to save room drafts.');
    }
  }
  const draftOwnerDisplayName =
    actor.principalDisplayName || actor.ownerUser?.displayName || existing.claimerDisplayName || 'Guest';
  const shouldClaimDraft =
    !existing.claimerUserId && actor.ownerUser !== null && existing.published === null;
  if (shouldClaimDraft && !actorIsAdmin) {
    await enforceFrontierClaimRule(env, incomingRoom.coordinates);
    await enforceDailyRoomClaimLimit(env, actor.ownerUser!.id, now, actor.requestAuthSource);
  }
  const claimerUserId = shouldClaimDraft ? actor.ownerUser!.id : existing.claimerUserId;
  const claimerPrincipalType = shouldClaimDraft ? actor.principalKind : existing.claimerPrincipalKind;
  const claimerAgentId = shouldClaimDraft ? actor.principalAgentId : existing.claimerAgentId;
  const claimerDisplayName = shouldClaimDraft ? draftOwnerDisplayName : existing.claimerDisplayName;
  const claimedAt = shouldClaimDraft ? now : existing.claimedAt;

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(incomingRoom),
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: existing.published?.publishedAt ?? null,
    status: 'draft',
    version: existing.draft.version || 1,
  };
  await assertCustomBackgroundApproved(env, draft.background);

  await env.DB.batch([
    preparePersistRoomRecordStatement(env, {
      draft,
      published: existing.published,
      canonicalVersion: existing.canonicalVersion,
      claimerUserId,
      claimerPrincipalType,
      claimerAgentId,
      claimerDisplayName,
      claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByPrincipalType: existing.lastPublishedByPrincipalKind,
      lastPublishedByAgentId: existing.lastPublishedByAgentId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
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
  actor: RoomMutationActor,
  actorIsAdmin = false
): Promise<RoomRecord> {
  const viewerUserId = actor.ownerUser?.id ?? null;
  const viewerWalletAddress = actor.ownerUser?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    incomingRoom.id,
    incomingRoom.coordinates,
    actor.ownerUser,
    actorIsAdmin
  );
  if (!existing.permissions.canPublish) {
    if (isRoomMinted(existing)) {
      throw new HttpError(403, 'Only the room token owner can publish this minted room.');
    }

    throw new HttpError(403, 'Only the room claimer can publish this unpublished room.');
  }
  if (!actorIsAdmin) {
    if (!actor.ownerUser) {
      throw new HttpError(401, 'Sign in to publish rooms.');
    }
    await enforceRoomMutationGuardrails(
      env,
      incomingRoom,
      actor.ownerUser.id,
      actor.requestAuthSource,
      existing.published,
    );
  }
  const normalizedIncomingRoom = cloneRoomSnapshot(incomingRoom);
  const publishValidationError = getRoomPublishValidationError(normalizedIncomingRoom);
  if (publishValidationError) {
    throw new HttpError(409, publishValidationError);
  }

  const now = new Date().toISOString();
  const lastPublished = existing.versions[existing.versions.length - 1];
  const lastPublishedVersion = lastPublished ? lastPublished.version : 0;
  const nextVersion =
    lastPublishedVersion > 0 ? lastPublishedVersion + 1 : Math.max(1, normalizedIncomingRoom.version);
  const publishedByUserId = actor.ownerUser?.id ?? null;
  const publishedByDisplayName = actor.principalDisplayName || actor.ownerUser?.displayName || 'Guest';
  const shouldClaim = !existing.claimerUserId && actor.ownerUser !== null;
  if (shouldClaim && !actorIsAdmin) {
    await enforceFrontierClaimRule(env, incomingRoom.coordinates);
    await enforceDailyRoomClaimLimit(env, actor.ownerUser!.id, now, actor.requestAuthSource);
  }
  const claimerUserId = shouldClaim ? actor.ownerUser!.id : existing.claimerUserId;
  const claimerPrincipalType = shouldClaim ? actor.principalKind : existing.claimerPrincipalKind;
  const claimerAgentId = shouldClaim ? actor.principalAgentId : existing.claimerAgentId;
  const claimerDisplayName = shouldClaim ? publishedByDisplayName : existing.claimerDisplayName;
  const claimedAt = shouldClaim ? now : existing.claimedAt;

  const published: RoomSnapshot = {
    ...normalizedIncomingRoom,
    createdAt: existing.draft.createdAt,
    updatedAt: now,
    publishedAt: now,
    status: 'published',
    version: nextVersion,
  };
  await assertCustomBackgroundApproved(env, published.background);

  const draft: RoomSnapshot = {
    ...cloneRoomSnapshot(published),
    status: 'draft',
  };

  const musicPhraseStatements = await prepareMusicPhrasePublishStatements(env, published, {
    userId: publishedByUserId,
    principalKind: actor.principalKind,
    agentId: actor.principalAgentId,
    displayName: publishedByDisplayName,
  });

  await env.DB.batch([
    preparePersistRoomRecordStatement(env, {
      draft,
      published,
      canonicalVersion: existing.canonicalVersion,
      claimerUserId,
      claimerPrincipalType,
      claimerAgentId,
      claimerDisplayName,
      claimedAt,
      lastPublishedByUserId: publishedByUserId,
      lastPublishedByPrincipalType: actor.principalKind,
      lastPublishedByAgentId: actor.principalAgentId,
      lastPublishedByDisplayName: publishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
    }),
    preparePersistRoomVersionStatement(env, {
      snapshot: published,
      createdAt: published.publishedAt ?? now,
      publishedByUserId,
      publishedByPrincipalType: actor.principalKind,
      publishedByAgentId: actor.principalAgentId,
      publishedByDisplayName,
      revertedFromVersion: null,
      leaderboardSourceVersion: null,
      onConflictUpdate: true,
    }),
    ...musicPhraseStatements,
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
  actor: RoomMutationActor,
  actorIsAdmin = false
): Promise<RoomRecord> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new HttpError(400, 'targetVersion must be a positive integer.');
  }

  const viewerUserId = actor.ownerUser?.id ?? null;
  const viewerWalletAddress = actor.ownerUser?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    roomId,
    coordinates,
    actor.ownerUser,
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
  const publishedByDisplayName =
    actor.principalDisplayName || existing.claimerDisplayName || actor.ownerUser?.displayName || 'Guest';
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
      canonicalVersion: existing.canonicalVersion,
      claimerUserId: existing.claimerUserId,
      claimerPrincipalType: existing.claimerPrincipalKind,
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: actor.ownerUser?.id ?? null,
      lastPublishedByPrincipalType: actor.principalKind,
      lastPublishedByAgentId: actor.principalAgentId,
      lastPublishedByDisplayName: publishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
    }),
    preparePersistRoomVersionStatement(env, {
      snapshot: published,
      createdAt: now,
      publishedByUserId: actor.ownerUser?.id ?? null,
      publishedByPrincipalType: actor.principalKind,
      publishedByAgentId: actor.principalAgentId,
      publishedByDisplayName,
      revertedFromVersion: target.version,
      leaderboardSourceVersion: null,
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

export async function setCanonicalRoomVersion(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  targetVersion: number,
  actor: RoomMutationActor,
  actorIsAdmin = false
): Promise<RoomRecord> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new HttpError(400, 'targetVersion must be a positive integer.');
  }

  const viewerUserId = actor.ownerUser?.id ?? null;
  const viewerWalletAddress = actor.ownerUser?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    roomId,
    coordinates,
    actor.ownerUser,
    actorIsAdmin
  );

  if (!existing.permissions.canRevert) {
    if (isRoomMinted(existing)) {
      throw new HttpError(403, 'Only the room token owner can set the canonical version for this room.');
    }

    throw new HttpError(403, 'Only the claimer can set the canonical version for this room.');
  }

  const target = existing.versions.find((version) => version.version === targetVersion) ?? null;
  if (!target) {
    throw new HttpError(404, `Version ${targetVersion} was not found.`);
  }

  await env.DB.batch([
    preparePersistRoomRecordStatement(env, {
      draft: existing.draft,
      published: existing.published,
      canonicalVersion: target.version,
      claimerUserId: existing.claimerUserId,
      claimerPrincipalType: existing.claimerPrincipalKind,
      claimerAgentId: existing.claimerAgentId,
      claimerDisplayName: existing.claimerDisplayName,
      claimedAt: existing.claimedAt,
      lastPublishedByUserId: existing.lastPublishedByUserId,
      lastPublishedByPrincipalType: existing.lastPublishedByPrincipalKind,
      lastPublishedByAgentId: existing.lastPublishedByAgentId,
      lastPublishedByDisplayName: existing.lastPublishedByDisplayName,
      mintedChainId: existing.mintedChainId,
      mintedContractAddress: existing.mintedContractAddress,
      mintedTokenId: existing.mintedTokenId,
      mintedOwnerWalletAddress: existing.mintedOwnerWalletAddress,
      mintedOwnerSyncedAt: existing.mintedOwnerSyncedAt,
      mintedMetadataRoomVersion: existing.mintedMetadataRoomVersion,
      mintedMetadataUpdatedAt: existing.mintedMetadataUpdatedAt,
      mintedMetadataHash: existing.mintedMetadataHash,
    }),
  ]);

  return loadRoomRecord(
    env,
    roomId,
    coordinates,
    viewerUserId,
    viewerWalletAddress,
    actorIsAdmin
  );
}

export async function setRoomVersionLeaderboardSource(
  env: Env,
  roomId: string,
  coordinates: RoomCoordinates,
  targetVersion: number,
  sourceVersion: number | null,
  actor: RoomMutationActor,
  actorIsAdmin = false
): Promise<RoomRecord> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new HttpError(400, 'targetVersion must be a positive integer.');
  }

  if (sourceVersion !== null && (!Number.isInteger(sourceVersion) || sourceVersion < 1)) {
    throw new HttpError(400, 'sourceVersion must be null or a positive integer.');
  }

  const viewerUserId = actor.ownerUser?.id ?? null;
  const viewerWalletAddress = actor.ownerUser?.walletAddress ?? null;
  const existing = await loadRoomRecordForMutation(
    env,
    roomId,
    coordinates,
    actor.ownerUser,
    actorIsAdmin
  );

  if (!existing.permissions.canRevert) {
    if (isRoomMinted(existing)) {
      throw new HttpError(403, 'Only the room token owner can manage leaderboard lineage for this room.');
    }

    throw new HttpError(403, 'Only the claimer can manage leaderboard lineage for this room.');
  }

  const target = existing.versions.find((version) => version.version === targetVersion) ?? null;
  if (!target) {
    throw new HttpError(404, `Version ${targetVersion} was not found.`);
  }

  let nextSourceVersion: number | null = null;
  if (sourceVersion !== null) {
    const source = existing.versions.find((version) => version.version === sourceVersion) ?? null;
    if (!source) {
      throw new HttpError(404, `Version ${sourceVersion} was not found.`);
    }

    const exactLineage = buildRoomVersionLineage(
      existing.versions,
      existing.canonicalVersion,
      existing.published?.version ?? null
    );
    const validationError = getManualRoomLeaderboardSourceValidationError(
      target,
      source,
      exactLineage
    );
    if (validationError) {
      throw new HttpError(409, validationError);
    }

    if (wouldCreateLeaderboardSourceCycle(existing.versions, target.version, source.version)) {
      throw new HttpError(409, 'This leaderboard source would create a version cycle.');
    }

    nextSourceVersion = source.version;
  }

  await env.DB.batch([
    env.DB.prepare(
      `
        UPDATE room_versions
        SET leaderboard_source_version = ?
        WHERE room_id = ?
          AND version = ?
      `
    ).bind(nextSourceVersion, roomId, target.version),
  ]);

  return loadRoomRecord(
    env,
    roomId,
    coordinates,
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

export async function getRoomClaimQuota(
  env: Env,
  userId: string,
  requestAuthSource: RequestAuthSource | null = 'session',
  nowIso: string = new Date().toISOString()
): Promise<RoomClaimQuota> {
  const limit = await getDailyRoomClaimLimitForUser(env, userId, requestAuthSource);
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
        AND (
          published_json IS NULL
          OR json_extract(published_json, '$.publishedAt') IS NULL
          OR json_extract(published_json, '$.publishedAt') >= claimed_at
        )
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
  nowIso: string,
  requestAuthSource: RequestAuthSource | null,
): Promise<void> {
  const limit = await getDailyRoomClaimLimitForUser(env, userId, requestAuthSource);
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
    claimer_principal_type,
    claimer_agent_id,
    claimer_display_name,
    claimed_at,
    last_published_by_user_id,
    last_published_by_principal_type,
    last_published_by_agent_id,
    last_published_by_display_name,
    minted_chain_id,
    minted_contract_address,
    minted_token_id,
    minted_owner_wallet_address,
    minted_owner_synced_at,
    minted_metadata_room_version,
    minted_metadata_updated_at,
    minted_metadata_hash,
    canonical_version
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    claimer_principal_type = excluded.claimer_principal_type,
    claimer_agent_id = excluded.claimer_agent_id,
    claimer_display_name = excluded.claimer_display_name,
    claimed_at = excluded.claimed_at,
    last_published_by_user_id = excluded.last_published_by_user_id,
    last_published_by_principal_type = excluded.last_published_by_principal_type,
    last_published_by_agent_id = excluded.last_published_by_agent_id,
    last_published_by_display_name = excluded.last_published_by_display_name,
    minted_chain_id = excluded.minted_chain_id,
    minted_contract_address = excluded.minted_contract_address,
    minted_token_id = excluded.minted_token_id,
    minted_owner_wallet_address = excluded.minted_owner_wallet_address,
    minted_owner_synced_at = excluded.minted_owner_synced_at,
    minted_metadata_room_version = excluded.minted_metadata_room_version,
    minted_metadata_updated_at = excluded.minted_metadata_updated_at,
    minted_metadata_hash = excluded.minted_metadata_hash,
    canonical_version = excluded.canonical_version
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
    published_by_principal_type,
    published_by_agent_id,
    published_by_display_name,
    reverted_from_version,
    leaderboard_source_version
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    published_by_principal_type = excluded.published_by_principal_type,
    published_by_agent_id = excluded.published_by_agent_id,
    published_by_display_name = excluded.published_by_display_name,
    reverted_from_version = excluded.reverted_from_version,
    leaderboard_source_version = excluded.leaderboard_source_version
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
    input.claimerPrincipalType,
    input.claimerAgentId,
    input.claimerDisplayName,
    input.claimedAt,
    input.lastPublishedByUserId,
    input.lastPublishedByPrincipalType,
    input.lastPublishedByAgentId,
    input.lastPublishedByDisplayName,
    input.mintedChainId,
    input.mintedContractAddress,
    input.mintedTokenId,
    input.mintedOwnerWalletAddress,
    input.mintedOwnerSyncedAt,
    input.mintedMetadataRoomVersion,
    input.mintedMetadataUpdatedAt,
    input.mintedMetadataHash,
    input.canonicalVersion
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
    input.publishedByPrincipalType,
    input.publishedByAgentId,
    input.publishedByDisplayName,
    input.revertedFromVersion,
    input.leaderboardSourceVersion
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
    canSaveDraft:
      minted
        ? ownsMintedRoom
        : record.published === null && record.claimerUserId !== null
          ? viewerUserId !== null && viewerUserId === record.claimerUserId
          : true,
    canPublish:
      minted
        ? ownsMintedRoom
        : record.published === null && record.claimerUserId !== null
          ? viewerUserId !== null && viewerUserId === record.claimerUserId
          : true,
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

function wouldCreateLeaderboardSourceCycle(
  versions: RoomVersionRecord[],
  targetVersion: number,
  sourceVersion: number
): boolean {
  const sourceByVersion = new Map<number, number | null>();
  for (const version of versions) {
    sourceByVersion.set(version.version, version.leaderboardSourceVersion);
  }

  const visited = new Set<number>();
  let currentVersion: number | null = sourceVersion;
  while (currentVersion !== null && !visited.has(currentVersion)) {
    if (currentVersion === targetVersion) {
      return true;
    }

    visited.add(currentVersion);
    currentVersion = sourceByVersion.get(currentVersion) ?? null;
  }

  return false;
}
