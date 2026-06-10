import {
  LAYER_NAMES,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  SPECIAL_TILE_BREAKABLE_BRICK_GID,
  TILE_SIZE,
  canObjectBeStoredInContainer,
  canPlacedObjectBeContainer,
  canPlacedObjectBeLinkedObjectTarget,
  canPlacedObjectUseObjectLink,
  decodeTileDataValue,
  getPlacedObjectInstanceId,
  getObjectById,
  placedObjectContributesToCategory,
  type LayerName,
  type PlacedObject,
} from '../config';
import { DEFAULT_ROOM_BACKGROUND, normalizeRoomBackground } from '../backgrounds/model';
import {
  getRoomGoalPublishValidationError,
  normalizeRoomGoalIntroText,
  normalizeRoomGoal,
  type RoomGoal,
} from '../goals/roomGoals';
import {
  cloneRoomLightingSettings,
  normalizeRoomLightingSettings,
  type RoomLightingSettings,
} from '../lighting/model';
import {
  cloneRoomWeatherSettings,
  normalizeRoomWeatherSettings,
  type RoomWeatherSettings,
} from '../weather/model';
import {
  isRoomMusicEmpty,
  normalizeRoomMusic,
  type RoomMusic,
} from '../music/model';
import { SWORDSMAN_AI_OBJECT_ID } from '../enemies/swordsmanAi';
import {
  normalizeSwordsmanDefeatMode,
  normalizeSwordsmanObjectiveMode,
} from '../enemies/swordsmanObjectives';
import { canPlacedObjectHaveSignText, normalizeSignText } from '../signs/model';
import {
  normalizeCustomSpriteDefinitions,
  normalizeCustomSpriteKind,
  type CustomSpriteDefinition,
} from '../customSprites/model';
import {
  normalizeCustomRoomTileDefinitions,
  type CustomRoomTileDefinition,
} from '../customTiles/model';
import {
  dedupePlacedObjectsByAnchorCell,
  resolvePlacedObjectInstanceAlias,
} from '../placedObjects/occupancy';
import {
  canPlacedObjectUseObjectPath,
  getPlacedObjectPathTargetIds,
  normalizePlacedObjectPathTargetIds,
  validatePlacedObjectPathTargetIds,
} from '../placedObjects/objectPaths';

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
  goalIntroText: string | null;
  background: string;
  lighting: RoomLightingSettings;
  weather: RoomWeatherSettings;
  music: RoomMusic | null;
  goal: RoomGoal | null;
  spawnPoint: RoomSpawnPoint | null;
  tileData: RoomTileData;
  placedObjects: PlacedObject[];
  customSprites?: CustomSpriteDefinition[];
  customTiles?: CustomRoomTileDefinition[];
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
  leaderboardSourceVersion: number | null;
}

export interface RoomRecord {
  draft: RoomSnapshot;
  published: RoomSnapshot | null;
  versions: RoomVersionRecord[];
  canonicalVersion: number | null;
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

export interface RoomCanonicalVersionRequestBody {
  targetVersion: number;
}

export interface RoomLeaderboardLineageRequestBody {
  targetVersion: number;
  sourceVersion: number | null;
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
    goalIntroText: null,
    background: DEFAULT_ROOM_BACKGROUND,
    lighting: cloneRoomLightingSettings(null),
    weather: cloneRoomWeatherSettings(null),
    music: null,
    goal: null,
    spawnPoint: null,
    tileData: createEmptyTileData(),
    placedObjects: [],
    customSprites: [],
    customTiles: [],
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

function normalizePlacedObject(
  placed: Partial<PlacedObject> | null | undefined,
  index: number,
): PlacedObject | null {
  if (
    !placed ||
    typeof placed.id !== 'string' ||
    typeof placed.x !== 'number' ||
    typeof placed.y !== 'number'
  ) {
    return null;
  }

  const customSpriteKind = placed.customSpriteKind
    ? normalizeCustomSpriteKind(placed.customSpriteKind)
    : null;
  const triggerTargetInstanceId =
    typeof placed.triggerTargetInstanceId === 'string' && placed.triggerTargetInstanceId.trim()
      ? placed.triggerTargetInstanceId
      : null;
  const linkedTargetInstanceIds = canPlacedObjectUseObjectPath({ id: placed.id })
    ? normalizePlacedObjectPathTargetIds(
        normalizePlacedObjectPathTargetIds(placed.linkedTargetInstanceIds).length > 0
          ? placed.linkedTargetInstanceIds
          : [triggerTargetInstanceId],
      )
    : [];

  const normalized: PlacedObject = {
    id: placed.id,
    x: placed.x,
    y: placed.y,
    instanceId: getPlacedObjectInstanceId(
      {
        id: placed.id,
        x: placed.x,
        y: placed.y,
        facing: placed.facing,
        layer: placed.layer,
        instanceId: placed.instanceId ?? '',
      },
      index,
    ),
    customSpriteKind,
    facing: placed.facing === 'left' || placed.facing === 'right' ? placed.facing : undefined,
    layer:
      placed.layer === 'background' || placed.layer === 'terrain' || placed.layer === 'foreground'
        ? placed.layer
        : undefined,
    triggerTargetInstanceId: linkedTargetInstanceIds[0] ?? triggerTargetInstanceId,
    linkedTargetInstanceIds:
      canPlacedObjectUseObjectPath({ id: placed.id }) && linkedTargetInstanceIds.length > 0
        ? linkedTargetInstanceIds
        : null,
    containedObjectId:
      typeof placed.containedObjectId === 'string' && placed.containedObjectId.trim()
        ? placed.containedObjectId
        : null,
    signText: canPlacedObjectHaveSignText({ id: placed.id, customSpriteKind })
      ? normalizeSignText(placed.signText)
      : null,
    swordsmanObjectiveMode:
      placed.id === SWORDSMAN_AI_OBJECT_ID
        ? normalizeSwordsmanObjectiveMode(placed.swordsmanObjectiveMode)
        : null,
    swordsmanDefeatMode:
      placed.id === SWORDSMAN_AI_OBJECT_ID
        ? normalizeSwordsmanDefeatMode(placed.swordsmanDefeatMode)
        : null,
  };

  if (
    normalized.id === 'brick_box' &&
    normalized.x % TILE_SIZE === 0 &&
    normalized.y % TILE_SIZE === 0
  ) {
    normalized.x -= TILE_SIZE / 2;
    normalized.y += TILE_SIZE / 2;
  }

  return normalized;
}

function clonePlacedObjects(placedObjects: PlacedObject[]): PlacedObject[] {
  const normalized = placedObjects
    .map((placed, index) => normalizePlacedObject(placed, index))
    .filter((placed): placed is PlacedObject => placed !== null);
  const { placedObjects: deduped, replacedInstanceIds } = dedupePlacedObjectsByAnchorCell(normalized);
  const ids = new Set(deduped.map((placed) => placed.instanceId));

  return deduped.map((placed) => {
    const pathTargetIds = canPlacedObjectUseObjectPath(placed)
      ? getPlacedObjectPathTargetIds(placed).map((targetId) =>
          resolvePlacedObjectInstanceAlias(targetId, replacedInstanceIds),
        )
      : [];
    const validPathTargetIds = validatePlacedObjectPathTargetIds(
      placed,
      pathTargetIds.filter((targetId): targetId is string => Boolean(targetId)),
      (targetId) => deduped.find((candidate) => candidate.instanceId === targetId) ?? null,
    );
    const target = resolvePlacedObjectInstanceAlias(
      placed.triggerTargetInstanceId,
      replacedInstanceIds,
    );
    const targetPlaced = deduped.find((candidate) => candidate.instanceId === target) ?? null;
    const containedObjectId = placed.containedObjectId;
    const validTarget =
      canPlacedObjectUseObjectLink(placed) &&
      typeof target === 'string' &&
      target.trim().length > 0 &&
      target !== placed.instanceId &&
      ids.has(target) &&
      canPlacedObjectBeLinkedObjectTarget(placed, targetPlaced);
    const validContainedObjectId =
      canPlacedObjectBeContainer(placed) &&
      typeof containedObjectId === 'string' &&
      containedObjectId.trim().length > 0 &&
      canObjectBeStoredInContainer(placed.id, getObjectById(containedObjectId));
    const nextTargetInstanceIds = canPlacedObjectUseObjectPath(placed)
      ? validPathTargetIds
      : validTarget
        ? [target]
        : [];
    const primaryTargetInstanceId = nextTargetInstanceIds[0] ?? null;

    return {
      ...placed,
      triggerTargetInstanceId: primaryTargetInstanceId,
      linkedTargetInstanceIds:
        canPlacedObjectUseObjectPath(placed) && nextTargetInstanceIds.length > 0
          ? nextTargetInstanceIds
          : null,
      containedObjectId: validContainedObjectId ? containedObjectId : null,
      signText: canPlacedObjectHaveSignText(placed) ? normalizeSignText(placed.signText) : null,
      swordsmanObjectiveMode:
        placed.id === SWORDSMAN_AI_OBJECT_ID
          ? normalizeSwordsmanObjectiveMode(placed.swordsmanObjectiveMode)
          : null,
      swordsmanDefeatMode:
        placed.id === SWORDSMAN_AI_OBJECT_ID
          ? normalizeSwordsmanDefeatMode(placed.swordsmanDefeatMode)
          : null,
    };
  });
}

function getLegacyBrickBoxTerrainCell(
  placed: PlacedObject,
): { x: number; y: number } | null {
  const tileXFloat = (placed.x - TILE_SIZE / 2) / TILE_SIZE;
  const tileYFloat = (placed.y - TILE_SIZE / 2) / TILE_SIZE;
  const tileX = Math.round(tileXFloat);
  const tileY = Math.round(tileYFloat);
  const isAligned =
    Math.abs(tileXFloat - tileX) < 0.001 &&
    Math.abs(tileYFloat - tileY) < 0.001;

  if (
    !isAligned ||
    tileX < 0 ||
    tileX >= ROOM_WIDTH ||
    tileY < 0 ||
    tileY >= ROOM_HEIGHT
  ) {
    return null;
  }

  return { x: tileX, y: tileY };
}

function migrateLegacyBrickBoxesToSpecialTerrain(
  tileData: RoomTileData,
  placedObjects: PlacedObject[],
): PlacedObject[] {
  const nextPlacedObjects: PlacedObject[] = [];

  for (const placed of placedObjects) {
    if (placed.id !== 'brick_box') {
      nextPlacedObjects.push(placed);
      continue;
    }

    if (placed.containedObjectId) {
      nextPlacedObjects.push(placed);
      continue;
    }

    const cell = getLegacyBrickBoxTerrainCell(placed);
    if (!cell) {
      nextPlacedObjects.push(placed);
      continue;
    }

    const currentTile = tileData.terrain[cell.y]?.[cell.x] ?? -1;
    const currentGid = decodeTileDataValue(currentTile).gid;
    if (currentGid === SPECIAL_TILE_BREAKABLE_BRICK_GID) {
      continue;
    }

    if (currentGid > 0) {
      nextPlacedObjects.push(placed);
      continue;
    }

    tileData.terrain[cell.y][cell.x] = SPECIAL_TILE_BREAKABLE_BRICK_GID;
  }

  return nextPlacedObjects;
}

export function cloneRoomSnapshot(room: RoomSnapshot): RoomSnapshot {
  const tileData = cloneTileData(room.tileData);
  const placedObjects = migrateLegacyBrickBoxesToSpecialTerrain(
    tileData,
    clonePlacedObjects(room.placedObjects),
  );

  return {
    id: room.id,
    coordinates: { ...room.coordinates },
    title: normalizeRoomTitle(room.title),
    goalIntroText: normalizeRoomGoalIntroText(room.goalIntroText),
    background: normalizeRoomBackground(room.background),
    lighting: normalizeRoomLightingSettings(room.lighting),
    weather: normalizeRoomWeatherSettings(room.weather),
    music: normalizeRoomMusic(room.music),
    goal: normalizeRoomGoal(room.goal),
    spawnPoint: room.spawnPoint ? { ...room.spawnPoint } : null,
    tileData,
    placedObjects,
    customSprites: normalizeCustomSpriteDefinitions(room.customSprites),
    customTiles: normalizeCustomRoomTileDefinitions(room.customTiles),
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
      (snapshot.goalIntroText === undefined || snapshot.goalIntroText === null || typeof snapshot.goalIntroText === 'string') &&
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
    leaderboardSourceVersion: overrides.leaderboardSourceVersion ?? null,
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
      leaderboardSourceVersion:
        typeof versionRecord.leaderboardSourceVersion === 'number'
          ? versionRecord.leaderboardSourceVersion
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

  if (room.goalIntroText) {
    return false;
  }

  if (normalizeRoomBackground(room.background) !== DEFAULT_ROOM_BACKGROUND) {
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

  if (!isRoomMusicEmpty(room.music)) {
    return false;
  }

  if (room.placedObjects.length > 0) {
    return false;
  }

  if (normalizeCustomRoomTileDefinitions(room.customTiles).length > 0) {
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

export function countRoomPlacedObjectsByCategory(
  placedObjects: PlacedObject[],
  category: 'collectible' | 'enemy',
): number {
  let count = 0;
  for (const placed of placedObjects) {
    if (placedObjectContributesToCategory(placed, category)) {
      count += 1;
    }
  }
  return count;
}

export function getRoomPublishValidationError(
  room: Pick<RoomSnapshot, 'goal' | 'placedObjects'>,
): string | null {
  return getRoomGoalPublishValidationError(room.goal, {
    collectiblesPlaced: countRoomPlacedObjectsByCategory(room.placedObjects, 'collectible'),
    collectModeEnemyCount: room.placedObjects.filter(
      (placed) =>
        placed.id === SWORDSMAN_AI_OBJECT_ID &&
        normalizeSwordsmanObjectiveMode(placed.swordsmanObjectiveMode) === 'collect',
    ).length,
  });
}

export function createDefaultRoomRecord(
  roomId: string = DEFAULT_ROOM_ID,
  coordinates: RoomCoordinates = DEFAULT_ROOM_COORDINATES
): RoomRecord {
  return {
    draft: createDefaultRoomSnapshot(roomId, coordinates),
    published: null,
    versions: [],
    canonicalVersion: null,
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
    canonicalVersion:
      typeof record.canonicalVersion === 'number' && Number.isInteger(record.canonicalVersion)
        ? record.canonicalVersion
        : null,
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
    canonicalVersion: normalized.canonicalVersion,
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
