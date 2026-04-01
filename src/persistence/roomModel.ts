import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  type LayerName,
  type PlacedObject,
} from '../config';
import { normalizeRoomGoal, type RoomGoal } from '../goals/roomGoals';
import {
  cloneRoomLightingSettings,
  normalizeRoomLightingSettings,
  type RoomLightingSettings,
} from '../lighting/model';

export interface RoomCoordinates {
  x: number;
  y: number;
}

export interface RoomSpawnPoint {
  x: number;
  y: number;
}

export type RoomStatus = 'draft' | 'published';
export type RoomAuthorPrincipalKind = 'user' | 'agent';
export type RoomTileData = Record<LayerName, (number | -1)[][]>;

export interface RoomPermissions {
  canSaveDraft: boolean;
  canPublish: boolean;
  canRevert: boolean;
  canMint: boolean;
}

export interface RoomTilesetHint {
  primaryTilesetKey: string;
  tilesetsUsed: string[];
  observedSurfaceGids: number[];
  observedFillGids: number[];
  recommendedBuildStyleId: string | null;
}

export interface RoomSnapshot {
  id: string;
  coordinates: RoomCoordinates;
  title: string | null;
  background: string;
  lighting: RoomLightingSettings;
  goal: RoomGoal | null;
  spawnPoint: RoomSpawnPoint | null;
  tileData: RoomTileData;
  placedObjects: PlacedObject[];
  version: number;
  status: RoomStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  tilesetHint?: RoomTilesetHint | null;
}

export interface RoomVersionRecord {
  version: number;
  snapshot: RoomSnapshot;
  createdAt: string;
  publishedByUserId: string | null;
  publishedByPrincipalKind: RoomAuthorPrincipalKind | null;
  publishedByAgentId: string | null;
  publishedByDisplayName: string | null;
  revertedFromVersion: number | null;
}

export interface RoomRecord {
  draft: RoomSnapshot;
  published: RoomSnapshot | null;
  versions: RoomVersionRecord[];
  claimerUserId: string | null;
  claimerPrincipalKind: RoomAuthorPrincipalKind | null;
  claimerAgentId: string | null;
  claimerDisplayName: string | null;
  claimedAt: string | null;
  lastPublishedByUserId: string | null;
  lastPublishedByPrincipalKind: RoomAuthorPrincipalKind | null;
  lastPublishedByAgentId: string | null;
  lastPublishedByDisplayName: string | null;
  mintedChainId: number | null;
  mintedContractAddress: string | null;
  mintedTokenId: string | null;
  mintedOwnerWalletAddress: string | null;
  mintedOwnerSyncedAt: string | null;
  mintedMetadataRoomVersion: number | null;
  mintedMetadataUpdatedAt: string | null;
  mintedMetadataHash: string | null;
  permissions: RoomPermissions;
}

export interface RoomRevertRequestBody {
  targetVersion: number;
}

export const DEFAULT_ROOM_COORDINATES: RoomCoordinates = { x: 0, y: 0 };
export const DEFAULT_ROOM_ID = `${DEFAULT_ROOM_COORDINATES.x},${DEFAULT_ROOM_COORDINATES.y}`;
export const MAX_ROOM_TITLE_LENGTH = 40;

export function roomIdFromCoordinates(coordinates: RoomCoordinates): string {
  return `${coordinates.x},${coordinates.y}`;
}

export function normalizeRoomTitle(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, MAX_ROOM_TITLE_LENGTH);
}

export function parseRoomId(roomId: string): RoomCoordinates | null {
  const match = /^(-?\d+),(-?\d+)$/.exec(roomId);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function createEmptyLayer(): (number | -1)[][] {
  return Array.from({ length: ROOM_HEIGHT }, () =>
    Array.from({ length: ROOM_WIDTH }, () => -1 as const)
  );
}

export function createEmptyTileData(): RoomTileData {
  return {
    background: createEmptyLayer(),
    terrain: createEmptyLayer(),
    foreground: createEmptyLayer(),
  };
}

export function createDefaultRoomSnapshot(
  roomId: string = DEFAULT_ROOM_ID,
  coordinates: RoomCoordinates = DEFAULT_ROOM_COORDINATES
): RoomSnapshot {
  const now = new Date().toISOString();

  return {
    id: roomId,
    coordinates: { ...coordinates },
    title: null,
    background: 'none',
    lighting: cloneRoomLightingSettings(null),
    goal: null,
    spawnPoint: null,
    tileData: createEmptyTileData(),
    placedObjects: [],
    version: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
}

export function createDefaultRoomPermissions(): RoomPermissions {
  return {
    canSaveDraft: true,
    canPublish: true,
    canRevert: false,
    canMint: true,
  };
}

function cloneTileData(tileData: RoomTileData): RoomTileData {
  const next = {} as RoomTileData;

  for (const layerName of LAYER_NAMES) {
    next[layerName] = tileData[layerName].map((row) => [...row]);
  }

  return next;
}

export function cloneRoomSnapshot(room: RoomSnapshot): RoomSnapshot {
  return {
    id: room.id,
    coordinates: { ...room.coordinates },
    title: normalizeRoomTitle(room.title),
    background: room.background,
    lighting: normalizeRoomLightingSettings(room.lighting),
    goal: normalizeRoomGoal(room.goal),
    spawnPoint: room.spawnPoint ? { ...room.spawnPoint } : null,
    tileData: cloneTileData(room.tileData),
    placedObjects: room.placedObjects.map((placed) => ({ ...placed })),
    version: room.version,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    publishedAt: room.publishedAt,
  };
}

function isRoomSnapshotLike(value: unknown): value is RoomSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<RoomSnapshot>;
  return Boolean(
    typeof snapshot.id === 'string' &&
      snapshot.coordinates &&
      typeof snapshot.coordinates.x === 'number' &&
      typeof snapshot.coordinates.y === 'number' &&
      (snapshot.title === undefined || snapshot.title === null || typeof snapshot.title === 'string') &&
      typeof snapshot.background === 'string' &&
      typeof snapshot.version === 'number' &&
      snapshot.tileData &&
      snapshot.placedObjects
  );
}

export function createRoomVersionRecord(
  snapshot: RoomSnapshot,
  overrides: Partial<Omit<RoomVersionRecord, 'snapshot'>> = {}
): RoomVersionRecord {
  return {
    version: overrides.version ?? snapshot.version,
    snapshot: cloneRoomSnapshot(snapshot),
    createdAt: overrides.createdAt ?? snapshot.publishedAt ?? snapshot.updatedAt,
    publishedByUserId: overrides.publishedByUserId ?? null,
    publishedByPrincipalKind: overrides.publishedByPrincipalKind ?? null,
    publishedByAgentId: overrides.publishedByAgentId ?? null,
    publishedByDisplayName: overrides.publishedByDisplayName ?? null,
    revertedFromVersion: overrides.revertedFromVersion ?? null,
  };
}

export function cloneRoomVersionRecord(version: RoomVersionRecord): RoomVersionRecord {
  return {
    ...version,
    snapshot: cloneRoomSnapshot(version.snapshot),
  };
}

function normalizeRoomPermissions(value: unknown): RoomPermissions {
  const permissions = value as Partial<RoomPermissions> | null | undefined;
  return {
    canSaveDraft: permissions?.canSaveDraft ?? true,
    canPublish: permissions?.canPublish ?? true,
    canRevert: permissions?.canRevert ?? false,
    canMint: permissions?.canMint ?? true,
  };
}

function normalizeRoomVersionRecord(value: unknown): RoomVersionRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const versionRecord = value as Partial<RoomVersionRecord> & Partial<RoomSnapshot>;

  if (isRoomSnapshotLike(versionRecord.snapshot)) {
    const snapshot = cloneRoomSnapshot(versionRecord.snapshot);
    return createRoomVersionRecord(snapshot, {
      version: typeof versionRecord.version === 'number' ? versionRecord.version : snapshot.version,
      createdAt:
        typeof versionRecord.createdAt === 'string'
          ? versionRecord.createdAt
          : snapshot.publishedAt ?? snapshot.updatedAt,
      publishedByUserId:
        typeof versionRecord.publishedByUserId === 'string'
          ? versionRecord.publishedByUserId
          : null,
      publishedByPrincipalKind:
        versionRecord.publishedByPrincipalKind === 'user' ||
        versionRecord.publishedByPrincipalKind === 'agent'
          ? versionRecord.publishedByPrincipalKind
          : null,
      publishedByAgentId:
        typeof versionRecord.publishedByAgentId === 'string'
          ? versionRecord.publishedByAgentId
          : null,
      publishedByDisplayName:
        typeof versionRecord.publishedByDisplayName === 'string'
          ? versionRecord.publishedByDisplayName
          : null,
      revertedFromVersion:
        typeof versionRecord.revertedFromVersion === 'number'
          ? versionRecord.revertedFromVersion
          : null,
    });
  }

  if (isRoomSnapshotLike(versionRecord)) {
    return createRoomVersionRecord(versionRecord);
  }

  return null;
}

export function isRoomSnapshotBlank(room: RoomSnapshot): boolean {
  if (room.title) {
    return false;
  }

  if (room.background !== 'none') {
    return false;
  }

  if (room.lighting.mode !== 'off') {
    return false;
  }

  if (room.spawnPoint) {
    return false;
  }

  if (room.goal) {
    return false;
  }

  if (room.placedObjects.length > 0) {
    return false;
  }

  for (const layerName of LAYER_NAMES) {
    for (const row of room.tileData[layerName]) {
      for (const gid of row) {
        if (gid > 0) {
          return false;
        }
      }
    }
  }

  return true;
}

export function createDefaultRoomRecord(
  roomId: string = DEFAULT_ROOM_ID,
  coordinates: RoomCoordinates = DEFAULT_ROOM_COORDINATES
): RoomRecord {
  return {
    draft: createDefaultRoomSnapshot(roomId, coordinates),
    published: null,
    versions: [],
    claimerUserId: null,
    claimerPrincipalKind: null,
    claimerAgentId: null,
    claimerDisplayName: null,
    claimedAt: null,
    lastPublishedByUserId: null,
    lastPublishedByPrincipalKind: null,
    lastPublishedByAgentId: null,
    lastPublishedByDisplayName: null,
    mintedChainId: null,
    mintedContractAddress: null,
    mintedTokenId: null,
    mintedOwnerWalletAddress: null,
    mintedOwnerSyncedAt: null,
    mintedMetadataRoomVersion: null,
    mintedMetadataUpdatedAt: null,
    mintedMetadataHash: null,
    permissions: createDefaultRoomPermissions(),
  };
}

export function normalizeRoomRecord(
  value: unknown,
  roomId: string = DEFAULT_ROOM_ID,
  coordinates: RoomCoordinates = DEFAULT_ROOM_COORDINATES
): RoomRecord {
  if (!value || typeof value !== 'object') {
    return createDefaultRoomRecord(roomId, coordinates);
  }

  const record = value as Partial<RoomRecord>;
  const fallback = createDefaultRoomRecord(roomId, coordinates);
  const draft = isRoomSnapshotLike(record.draft) ? cloneRoomSnapshot(record.draft) : fallback.draft;
  const published = isRoomSnapshotLike(record.published) ? cloneRoomSnapshot(record.published) : null;

  return {
    draft,
    published,
    versions: Array.isArray(record.versions)
      ? record.versions
          .map((version) => normalizeRoomVersionRecord(version))
          .filter((version): version is RoomVersionRecord => version !== null)
      : [],
    claimerUserId: typeof record.claimerUserId === 'string' ? record.claimerUserId : null,
    claimerPrincipalKind:
      record.claimerPrincipalKind === 'user' || record.claimerPrincipalKind === 'agent'
        ? record.claimerPrincipalKind
        : null,
    claimerAgentId: typeof record.claimerAgentId === 'string' ? record.claimerAgentId : null,
    claimerDisplayName:
      typeof record.claimerDisplayName === 'string' ? record.claimerDisplayName : null,
    claimedAt: typeof record.claimedAt === 'string' ? record.claimedAt : null,
    lastPublishedByUserId:
      typeof record.lastPublishedByUserId === 'string' ? record.lastPublishedByUserId : null,
    lastPublishedByPrincipalKind:
      record.lastPublishedByPrincipalKind === 'user' ||
      record.lastPublishedByPrincipalKind === 'agent'
        ? record.lastPublishedByPrincipalKind
        : null,
    lastPublishedByAgentId:
      typeof record.lastPublishedByAgentId === 'string' ? record.lastPublishedByAgentId : null,
    lastPublishedByDisplayName:
      typeof record.lastPublishedByDisplayName === 'string'
        ? record.lastPublishedByDisplayName
        : null,
    mintedChainId:
      typeof record.mintedChainId === 'number' && Number.isInteger(record.mintedChainId)
        ? record.mintedChainId
        : null,
    mintedContractAddress:
      typeof record.mintedContractAddress === 'string' ? record.mintedContractAddress : null,
    mintedTokenId: typeof record.mintedTokenId === 'string' ? record.mintedTokenId : null,
    mintedOwnerWalletAddress:
      typeof record.mintedOwnerWalletAddress === 'string' ? record.mintedOwnerWalletAddress : null,
    mintedOwnerSyncedAt:
      typeof record.mintedOwnerSyncedAt === 'string' ? record.mintedOwnerSyncedAt : null,
    mintedMetadataRoomVersion:
      typeof record.mintedMetadataRoomVersion === 'number' &&
      Number.isInteger(record.mintedMetadataRoomVersion)
        ? record.mintedMetadataRoomVersion
        : null,
    mintedMetadataUpdatedAt:
      typeof record.mintedMetadataUpdatedAt === 'string'
        ? record.mintedMetadataUpdatedAt
        : null,
    mintedMetadataHash:
      typeof record.mintedMetadataHash === 'string' ? record.mintedMetadataHash : null,
    permissions: normalizeRoomPermissions(record.permissions),
  };
}

export function cloneRoomRecord(record: RoomRecord): RoomRecord {
  const normalized = normalizeRoomRecord(record, record.draft.id, record.draft.coordinates);
  return {
    draft: cloneRoomSnapshot(normalized.draft),
    published: normalized.published ? cloneRoomSnapshot(normalized.published) : null,
    versions: normalized.versions.map((version) => cloneRoomVersionRecord(version)),
    claimerUserId: normalized.claimerUserId,
    claimerPrincipalKind: normalized.claimerPrincipalKind,
    claimerAgentId: normalized.claimerAgentId,
    claimerDisplayName: normalized.claimerDisplayName,
    claimedAt: normalized.claimedAt,
    lastPublishedByUserId: normalized.lastPublishedByUserId,
    lastPublishedByPrincipalKind: normalized.lastPublishedByPrincipalKind,
    lastPublishedByAgentId: normalized.lastPublishedByAgentId,
    lastPublishedByDisplayName: normalized.lastPublishedByDisplayName,
    mintedChainId: normalized.mintedChainId,
    mintedContractAddress: normalized.mintedContractAddress,
    mintedTokenId: normalized.mintedTokenId,
    mintedOwnerWalletAddress: normalized.mintedOwnerWalletAddress,
    mintedOwnerSyncedAt: normalized.mintedOwnerSyncedAt,
    mintedMetadataRoomVersion: normalized.mintedMetadataRoomVersion,
    mintedMetadataUpdatedAt: normalized.mintedMetadataUpdatedAt,
    mintedMetadataHash: normalized.mintedMetadataHash,
    permissions: { ...normalized.permissions },
  };
}

export function isRoomMinted(
  room: Pick<RoomRecord, 'mintedChainId' | 'mintedContractAddress' | 'mintedTokenId'>
): boolean {
  return room.mintedChainId !== null || room.mintedContractAddress !== null || room.mintedTokenId !== null;
}
