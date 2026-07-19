import {
  WORLD_TILE_IMAGE_HEIGHT,
  WORLD_TILE_IMAGE_WIDTH,
  WORLD_TILE_OVERLAP,
  assertWorldTileLevel,
} from './geometry';
import type {
  WorldTileBounds,
  WorldTileConfig,
  WorldTileManifest,
  WorldTileManifestEntry,
  WorldTileRoomSummary,
} from './types';

export class WorldTileManifestCompatibilityError extends Error {}

export type WorldTileManifestRendererRole = 'active' | 'previous' | 'reject';

export function getWorldTileManifestRendererRole(input: {
  activeRendererVersion: string | null;
  previousRendererVersion: string | null;
  manifestRendererVersion: string;
}): WorldTileManifestRendererRole {
  if (input.manifestRendererVersion === input.activeRendererVersion) return 'active';
  if (input.manifestRendererVersion === input.previousRendererVersion) return 'previous';
  return 'reject';
}

export function parseWorldTileConfig(value: unknown): WorldTileConfig {
  const record = requireRecord(value, 'world tile config');
  if (record.schemaVersion !== 1) {
    throw new WorldTileManifestCompatibilityError('Unsupported world tile config schema.');
  }
  const rolloutPercentage = requireFiniteNumber(record.rolloutPercentage, 'rolloutPercentage');
  if (rolloutPercentage < 0 || rolloutPercentage > 100) {
    throw new WorldTileManifestCompatibilityError('World tile rollout percentage must be between 0 and 100.');
  }
  return {
    schemaVersion: 1,
    available: requireBoolean(record.available, 'available'),
    rolloutPercentage,
    activeRendererVersion: record.activeRendererVersion === null
      ? null
      : requireString(record.activeRendererVersion, 'activeRendererVersion'),
  };
}

export function parseWorldTileManifest(value: unknown): WorldTileManifest {
  const record = requireRecord(value, 'world tile manifest');
  if (record.schemaVersion !== 1) {
    throw new WorldTileManifestCompatibilityError('Unsupported world tile manifest schema.');
  }
  const level = requireSafeInteger(record.level, 'level');
  assertWorldTileLevel(level);
  const rendererVersion = requireString(record.rendererVersion, 'rendererVersion');
  const targetBounds = parseBounds(record.targetBounds);
  const entries = requireArray(record.entries, 'entries').map((entry) => parseEntry(entry, rendererVersion));
  const rooms = requireArray(record.rooms, 'rooms').map(parseRoomSummary);
  return {
    schemaVersion: 1,
    rendererVersion,
    level,
    targetBounds,
    entries: entries.sort(compareManifestEntries),
    rooms: rooms.sort((left, right) => (
      left.coordinates.y - right.coordinates.y
      || left.coordinates.x - right.coordinates.x
      || left.id.localeCompare(right.id)
    )),
  };
}

function parseEntry(value: unknown, rendererVersion: string): WorldTileManifestEntry {
  const record = requireRecord(value, 'manifest entry');
  const address = requireRecord(record.address, 'manifest address');
  if (requireString(address.rendererVersion, 'address.rendererVersion') !== rendererVersion) {
    throw new WorldTileManifestCompatibilityError('Manifest entry renderer version does not match its manifest.');
  }
  const level = requireSafeInteger(address.level, 'address.level');
  assertWorldTileLevel(level);
  const desiredGeneration = requireSafeInteger(record.desiredGeneration, 'desiredGeneration');
  const readyEmptyGeneration = record.readyEmptyGeneration === null
    ? null
    : requireSafeInteger(record.readyEmptyGeneration, 'readyEmptyGeneration');
  const readyRecord = record.ready === null ? null : requireRecord(record.ready, 'ready tile');
  const ready: WorldTileManifestEntry['ready'] = readyRecord === null ? null : {
    generation: requireSafeInteger(readyRecord.generation, 'ready.generation'),
    contentHash: requireSha256Hex(readyRecord.contentHash, 'ready.contentHash'),
    url: requireHttpUrl(readyRecord.url, 'ready.url'),
    width: requireLiteral(readyRecord.width, WORLD_TILE_IMAGE_WIDTH, 'ready.width') as 642,
    height: requireLiteral(readyRecord.height, WORLD_TILE_IMAGE_HEIGHT, 'ready.height') as 354,
    overlap: requireLiteral(readyRecord.overlap, WORLD_TILE_OVERLAP, 'ready.overlap'),
    byteLength: requireSafeInteger(readyRecord.byteLength, 'ready.byteLength'),
  };
  return {
    address: {
      rendererVersion,
      level,
      x: requireSafeInteger(address.x, 'address.x'),
      y: requireSafeInteger(address.y, 'address.y'),
    },
    desiredGeneration,
    desiredEmpty: requireBoolean(record.desiredEmpty, 'desiredEmpty'),
    readyEmptyGeneration,
    ready,
    staleRoomIds: requireArray(record.staleRoomIds, 'staleRoomIds')
      .map((roomId) => requireString(roomId, 'staleRoomId'))
      .sort(compareRoomIds),
  };
}

function parseRoomSummary(value: unknown): WorldTileRoomSummary {
  const record = requireRecord(value, 'room summary');
  const coordinates = requireRecord(record.coordinates, 'room coordinates');
  if (record.state !== 'published') {
    throw new WorldTileManifestCompatibilityError('Tile manifests may only contain published room summaries.');
  }
  return {
    id: requireString(record.id, 'room.id'),
    coordinates: {
      x: requireSafeInteger(coordinates.x, 'room.coordinates.x'),
      y: requireSafeInteger(coordinates.y, 'room.coordinates.y'),
    },
    title: optionalString(record.title, 'room.title'),
    state: 'published',
    goalType: optionalString(record.goalType, 'room.goalType'),
    version: requireSafeInteger(record.version, 'room.version'),
    publishedAt: optionalString(record.publishedAt, 'room.publishedAt'),
    previewUpdatedAt: optionalString(record.previewUpdatedAt, 'room.previewUpdatedAt'),
    creatorUserId: optionalString(record.creatorUserId, 'room.creatorUserId'),
    creatorDisplayName: optionalString(record.creatorDisplayName, 'room.creatorDisplayName'),
  };
}

function parseBounds(value: unknown): WorldTileBounds {
  const record = requireRecord(value, 'targetBounds');
  const bounds = {
    minTileX: requireSafeInteger(record.minTileX, 'minTileX'),
    maxTileX: requireSafeInteger(record.maxTileX, 'maxTileX'),
    minTileY: requireSafeInteger(record.minTileY, 'minTileY'),
    maxTileY: requireSafeInteger(record.maxTileY, 'maxTileY'),
  };
  if (
    bounds.minTileX > bounds.maxTileX
    || bounds.minTileY > bounds.maxTileY
    || bounds.maxTileX - bounds.minTileX + 1 > 16
    || bounds.maxTileY - bounds.minTileY + 1 > 16
  ) {
    throw new WorldTileManifestCompatibilityError('Manifest target bounds are invalid.');
  }
  return bounds;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | null {
  return value === null ? null : requireString(value, label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  }
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  return value as number;
}

function requireLiteral<T extends number>(value: unknown, expected: T, label: string): T {
  if (value !== expected) throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  return expected;
}

function requireHttpUrl(value: unknown, label: string): string {
  const raw = requireString(value, label);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol');
    return url.toString();
  } catch {
    throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  }
}

function requireSha256Hex(value: unknown, label: string): string {
  const hash = requireString(value, label);
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new WorldTileManifestCompatibilityError(`Invalid ${label}.`);
  }
  return hash;
}

function compareManifestEntries(left: WorldTileManifestEntry, right: WorldTileManifestEntry): number {
  return left.address.level - right.address.level
    || left.address.y - right.address.y
    || left.address.x - right.address.x;
}

function compareRoomIds(left: string, right: string): number {
  const [leftX, leftY] = left.split(',').map(Number);
  const [rightX, rightY] = right.split(',').map(Number);
  return leftY - rightY || leftX - rightX || left.localeCompare(right);
}
