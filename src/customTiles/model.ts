import { TILE_FLIP_X_FLAG } from '../config/room';
import {
  TERRAIN_COLLISION_PROFILES,
  type TerrainCollisionProfileConfig,
} from '../config/tilesets';
import type { CustomSpriteDefinition } from '../customSprites/model';

export const CUSTOM_ROOM_TILE_FIRST_GID = 10_000;
export const CUSTOM_ROOM_TILE_MAX_TILES = 128;
export const CUSTOM_ROOM_TILESET_KEY_PREFIX = 'custom-room-tiles';
export const CUSTOM_ROOM_TILE_ATLAS_COLUMNS = 16;
export const CUSTOM_ROOM_TILE_ATLAS_ROWS = Math.ceil(
  CUSTOM_ROOM_TILE_MAX_TILES / CUSTOM_ROOM_TILE_ATLAS_COLUMNS
);

export type CustomRoomTileCollision = 'none' | 'solid';

export interface CustomRoomTileDefinition {
  id: string;
  name: string;
  pixels: Array<string | null>;
  collision: CustomRoomTileCollision;
  sourceSpriteId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRoomTileHost {
  customTiles?: CustomRoomTileDefinition[] | null;
}

export function getCustomRoomTileGid(index: number): number {
  return CUSTOM_ROOM_TILE_FIRST_GID + index;
}

export function getCustomRoomTileIndexForGid(gid: number): number | null {
  if (!Number.isInteger(gid)) {
    return null;
  }
  if (gid < CUSTOM_ROOM_TILE_FIRST_GID || gid >= CUSTOM_ROOM_TILE_FIRST_GID + CUSTOM_ROOM_TILE_MAX_TILES) {
    return null;
  }
  return gid - CUSTOM_ROOM_TILE_FIRST_GID;
}

export function isCustomRoomTileGid(gid: number): boolean {
  return getCustomRoomTileIndexForGid(gid) !== null;
}

export function assertCustomRoomTileGidRangeIsSafe(): void {
  const maxCustomGid = CUSTOM_ROOM_TILE_FIRST_GID + CUSTOM_ROOM_TILE_MAX_TILES - 1;
  if (maxCustomGid >= TILE_FLIP_X_FLAG) {
    throw new Error('Custom room tile GID range overlaps encoded tile flip flags.');
  }
}

export function getCustomRoomTileDefinitionForGid(
  room: CustomRoomTileHost,
  gid: number,
): CustomRoomTileDefinition | null {
  const index = getCustomRoomTileIndexForGid(gid);
  if (index === null) {
    return null;
  }

  return normalizeCustomRoomTileDefinitions(room.customTiles)[index] ?? null;
}

export function getCustomRoomTileCollisionProfile(
  room: CustomRoomTileHost,
  gid: number,
): TerrainCollisionProfileConfig | null {
  const tile = getCustomRoomTileDefinitionForGid(room, gid);
  if (!tile) {
    return null;
  }

  return tile.collision === 'solid'
    ? TERRAIN_COLLISION_PROFILES.full
    : TERRAIN_COLLISION_PROFILES.none;
}

export function normalizeCustomRoomTileDefinitions(value: unknown): CustomRoomTileDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const tiles: CustomRoomTileDefinition[] = [];
  for (const entry of value) {
    const tile = normalizeCustomRoomTileDefinition(entry);
    if (!tile || seen.has(tile.id)) {
      continue;
    }
    seen.add(tile.id);
    tiles.push(tile);
    if (tiles.length >= CUSTOM_ROOM_TILE_MAX_TILES) {
      break;
    }
  }

  return tiles;
}

export function normalizeCustomRoomTileDefinition(value: unknown): CustomRoomTileDefinition | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const input = value as Partial<CustomRoomTileDefinition>;
  if (typeof input.id !== 'string' || !input.id.trim()) {
    return null;
  }

  const pixels = normalizeTilePixels(input.pixels);
  const now = new Date().toISOString();
  return {
    id: input.id.trim().slice(0, 96),
    name: typeof input.name === 'string' && input.name.trim()
      ? input.name.trim().slice(0, 32)
      : 'Custom Tile',
    pixels,
    collision: input.collision === 'solid' ? 'solid' : 'none',
    sourceSpriteId:
      typeof input.sourceSpriteId === 'string' && input.sourceSpriteId.trim()
        ? input.sourceSpriteId.trim().slice(0, 96)
        : null,
    createdAt: typeof input.createdAt === 'string' && input.createdAt ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' && input.updatedAt ? input.updatedAt : now,
  };
}

export function canCustomSpriteBecomeRoomTile(sprite: CustomSpriteDefinition): boolean {
  return sprite.status !== 'blocked'
    && sprite.size === 16
    && (sprite.kind === 'solid' || sprite.kind === 'decoration');
}

export function buildCustomRoomTileFromSprite(
  sprite: CustomSpriteDefinition,
  existing?: CustomRoomTileDefinition | null,
): CustomRoomTileDefinition | null {
  if (!canCustomSpriteBecomeRoomTile(sprite)) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: existing?.id ?? `tile_${sprite.id}`,
    name: sprite.name,
    pixels: normalizeTilePixels(sprite.pixels),
    collision: sprite.kind === 'solid' ? 'solid' : 'none',
    sourceSpriteId: sprite.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function findCustomRoomTileIndexForSourceSprite(
  customTiles: readonly CustomRoomTileDefinition[],
  sourceSpriteId: string | null | undefined,
): number {
  if (!sourceSpriteId) {
    return -1;
  }

  return customTiles.findIndex((tile) => tile.sourceSpriteId === sourceSpriteId);
}

export function getCustomRoomTileSignature(
  customTiles: readonly CustomRoomTileDefinition[] | null | undefined,
): string {
  return normalizeCustomRoomTileDefinitions(customTiles)
    .map((tile) => [
      tile.id,
      tile.collision,
      tile.updatedAt,
      tile.pixels.join(','),
    ].join(':'))
    .join('|');
}

function normalizeTilePixels(value: unknown): Array<string | null> {
  const sourcePixels = Array.isArray(value) ? value : [];
  return Array.from({ length: 16 * 16 }, (_, index) => normalizeHexColor(sourcePixels[index]));
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}
