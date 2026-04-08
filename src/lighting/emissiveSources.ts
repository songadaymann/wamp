import {
  decodeTileDataValue,
  getObjectById,
  getTilesetByGid,
  LAYER_NAMES,
  TILE_SIZE,
  type LayerName,
} from '../config';
import type { RoomSnapshot } from '../persistence/roomModel';
import type {
  LightEmissionConfig,
  LightEmissionFlickerConfig,
  RoomLightingEmitter,
  RoomLightingEmitterFlicker,
  TileLightEmissionConfig,
} from './model';

const MAX_SURFACE_STRIP_CHUNK_TILES = 4;
const SURFACE_STRIP_RADIUS_STEP_PX = 4;
const DEFAULT_ROOM_ORIGIN = Object.freeze({ x: 0, y: 0 });

export interface RoomStaticLightingEmitters {
  emitters: RoomLightingEmitter[];
  objectCount: number;
  tileCount: number;
}

interface RoomOrigin {
  x: number;
  y: number;
}

interface TileLightCell {
  x: number;
  y: number;
  layerName: LayerName;
  profile: TileLightEmissionConfig;
  profileKey: string;
  flipX: boolean;
  flipY: boolean;
}

export function extractRoomStaticLightingEmitters(
  room: RoomSnapshot,
  roomOrigin: RoomOrigin = DEFAULT_ROOM_ORIGIN,
): RoomStaticLightingEmitters {
  const objectEmitters = collapseLightingEmitters(
    collectObjectLightingEmitters(room, roomOrigin),
  );
  const tileEmitters = collapseLightingEmitters(
    collectTileLightingEmitters(room, roomOrigin),
  );

  return {
    emitters: collapseLightingEmitters([...objectEmitters, ...tileEmitters]),
    objectCount: objectEmitters.length,
    tileCount: tileEmitters.length,
  };
}

function collectObjectLightingEmitters(
  room: RoomSnapshot,
  roomOrigin: RoomOrigin,
): RoomLightingEmitter[] {
  const emitters: RoomLightingEmitter[] = [];

  for (let index = 0; index < room.placedObjects.length; index += 1) {
    const placedObject = room.placedObjects[index];
    const objectConfig = getObjectById(placedObject.id);
    const lightEmission = objectConfig?.lightEmission;
    if (!lightEmission) {
      continue;
    }

    emitters.push(
      createLightingEmitter(
        'object',
        room.id,
        `${placedObject.instanceId ?? placedObject.id}:${index}`,
        roomOrigin.x + placedObject.x,
        roomOrigin.y + placedObject.y,
        lightEmission,
      ),
    );
  }

  return emitters;
}

function collectTileLightingEmitters(
  room: RoomSnapshot,
  roomOrigin: RoomOrigin,
): RoomLightingEmitter[] {
  const emitters: RoomLightingEmitter[] = [];

  for (const layerName of LAYER_NAMES) {
    for (let tileY = 0; tileY < room.tileData[layerName].length; tileY += 1) {
      let tileX = 0;
      while (tileX < room.tileData[layerName][tileY].length) {
        const tileLight = resolveTileLightCell(room, layerName, tileX, tileY);
        if (!tileLight) {
          tileX += 1;
          continue;
        }

        if ((tileLight.profile.aggregation ?? 'perTile') !== 'surfaceStrip') {
          emitters.push(
            createTileLightingEmitter(room, roomOrigin, tileLight),
          );
          tileX += 1;
          continue;
        }

        if (!isTileTopExposed(room, layerName, tileX, tileY)) {
          tileX += 1;
          continue;
        }

        const runCells: TileLightCell[] = [tileLight];
        tileX += 1;

        while (tileX < room.tileData[layerName][tileY].length) {
          const nextTileLight = resolveTileLightCell(room, layerName, tileX, tileY);
          if (
            !nextTileLight
            || (nextTileLight.profile.aggregation ?? 'perTile') !== 'surfaceStrip'
            || nextTileLight.profileKey !== tileLight.profileKey
            || !isTileTopExposed(room, layerName, tileX, tileY)
          ) {
            break;
          }

          runCells.push(nextTileLight);
          tileX += 1;
        }

        emitters.push(
          ...createSurfaceStripLightingEmitters(room, roomOrigin, runCells),
        );
      }
    }
  }

  return emitters;
}

function resolveTileLightCell(
  room: RoomSnapshot,
  layerName: LayerName,
  tileX: number,
  tileY: number,
): TileLightCell | null {
  const encoded = room.tileData[layerName][tileY]?.[tileX] ?? -1;
  const decoded = decodeTileDataValue(encoded);
  if (decoded.gid <= 0) {
    return null;
  }

  const tileset = getTilesetByGid(decoded.gid);
  if (!tileset) {
    return null;
  }

  const localIndex = decoded.gid - tileset.firstGid;
  const profile = tileset.lightEmissionProfiles?.[localIndex];
  if (!profile) {
    return null;
  }

  return {
    x: tileX,
    y: tileY,
    layerName,
    profile,
    profileKey: buildTileLightProfileKey(tileset.key, profile),
    flipX: decoded.flipX,
    flipY: decoded.flipY,
  };
}

function isTileTopExposed(
  room: RoomSnapshot,
  layerName: LayerName,
  tileX: number,
  tileY: number,
): boolean {
  if (tileY <= 0) {
    return true;
  }

  const above = decodeTileDataValue(room.tileData[layerName][tileY - 1]?.[tileX] ?? -1);
  return above.gid <= 0;
}

function createTileLightingEmitter(
  room: RoomSnapshot,
  roomOrigin: RoomOrigin,
  tileLight: TileLightCell,
): RoomLightingEmitter {
  const offsetX = tileLight.flipX
    ? -(tileLight.profile.offsetX ?? 0)
    : (tileLight.profile.offsetX ?? 0);
  const offsetY = tileLight.flipY
    ? -(tileLight.profile.offsetY ?? 0)
    : (tileLight.profile.offsetY ?? 0);

  return createLightingEmitter(
    'tile',
    room.id,
    `${tileLight.layerName}:${tileLight.x},${tileLight.y}`,
    roomOrigin.x + tileLight.x * TILE_SIZE + TILE_SIZE * 0.5,
    roomOrigin.y + tileLight.y * TILE_SIZE + TILE_SIZE * 0.5,
    tileLight.profile,
    { offsetX, offsetY },
  );
}

function createSurfaceStripLightingEmitters(
  room: RoomSnapshot,
  roomOrigin: RoomOrigin,
  runCells: TileLightCell[],
): RoomLightingEmitter[] {
  if (runCells.length === 0) {
    return [];
  }

  const emitters: RoomLightingEmitter[] = [];
  const profile = runCells[0].profile;
  const layerName = runCells[0].layerName;
  const tileY = runCells[0].y;

  for (let startIndex = 0; startIndex < runCells.length; startIndex += MAX_SURFACE_STRIP_CHUNK_TILES) {
    const chunk = runCells.slice(startIndex, startIndex + MAX_SURFACE_STRIP_CHUNK_TILES);
    const chunkStartTile = chunk[0]?.x ?? 0;
    const chunkEndTile = chunk[chunk.length - 1]?.x ?? chunkStartTile;
    const tileCount = chunk.length;
    const radiusBonusPx = Math.max(0, tileCount - 1) * SURFACE_STRIP_RADIUS_STEP_PX;

    emitters.push(
      createLightingEmitter(
        'tile',
        room.id,
        `${layerName}:${tileY}:${chunkStartTile}-${chunkEndTile}`,
        roomOrigin.x + chunkStartTile * TILE_SIZE + tileCount * TILE_SIZE * 0.5,
        roomOrigin.y + tileY * TILE_SIZE + TILE_SIZE * 0.5,
        profile,
        {
          offsetX: profile.offsetX ?? 0,
          offsetY: profile.offsetY ?? 0,
          revealRadiusBonusPx: radiusBonusPx,
          glowRadiusBonusPx: radiusBonusPx,
        },
      ),
    );
  }

  return emitters;
}

function createLightingEmitter(
  sourceType: RoomLightingEmitter['sourceType'],
  roomId: string,
  sourceKey: string,
  x: number,
  y: number,
  lightEmission: LightEmissionConfig,
  overrides: {
    offsetX?: number;
    offsetY?: number;
    revealRadiusBonusPx?: number;
    glowRadiusBonusPx?: number;
  } = {},
): RoomLightingEmitter {
  return {
    sourceType,
    x: x + (overrides.offsetX ?? lightEmission.offsetX ?? 0),
    y: y + (overrides.offsetY ?? lightEmission.offsetY ?? 0),
    revealRadiusPx: lightEmission.revealRadiusPx + (overrides.revealRadiusBonusPx ?? 0),
    glowRadiusPx: lightEmission.glowRadiusPx + (overrides.glowRadiusBonusPx ?? 0),
    glowColor: lightEmission.glowColor,
    glowAlpha: lightEmission.glowAlpha,
    flicker: createEmitterFlicker(lightEmission.flicker, `${roomId}:${sourceKey}`),
  };
}

function createEmitterFlicker(
  flicker: LightEmissionFlickerConfig | undefined,
  phaseKey: string,
): RoomLightingEmitterFlicker | null {
  if (!flicker) {
    return null;
  }

  return {
    radiusAmplitude: flicker.radiusAmplitude,
    alphaAmplitude: flicker.alphaAmplitude,
    speedHz: flicker.speedHz,
    phaseSeed: hashStringToPhaseSeed(phaseKey),
  };
}

function collapseLightingEmitters(
  emitters: RoomLightingEmitter[],
): RoomLightingEmitter[] {
  const collapsed = new Map<string, RoomLightingEmitter>();

  for (const emitter of emitters) {
    const key = buildCollapsedEmitterKey(emitter);
    const existing = collapsed.get(key);
    if (!existing) {
      collapsed.set(key, { ...emitter });
      continue;
    }

    const mergedFlicker = mergeEmitterFlicker(
      existing.flicker ?? null,
      emitter.flicker ?? null,
      key,
    );

    collapsed.set(key, {
      ...existing,
      revealRadiusPx: Math.max(existing.revealRadiusPx ?? 0, emitter.revealRadiusPx ?? 0),
      glowRadiusPx: Math.max(existing.glowRadiusPx ?? 0, emitter.glowRadiusPx ?? 0),
      glowAlpha: Math.max(existing.glowAlpha ?? 0, emitter.glowAlpha ?? 0),
      flicker: mergedFlicker,
    });
  }

  return Array.from(collapsed.values());
}

function mergeEmitterFlicker(
  left: RoomLightingEmitterFlicker | null,
  right: RoomLightingEmitterFlicker | null,
  key: string,
): RoomLightingEmitterFlicker | null {
  if (!left && !right) {
    return null;
  }

  return {
    radiusAmplitude: Math.max(left?.radiusAmplitude ?? 0, right?.radiusAmplitude ?? 0),
    alphaAmplitude: Math.max(left?.alphaAmplitude ?? 0, right?.alphaAmplitude ?? 0),
    speedHz: Math.max(left?.speedHz ?? 0, right?.speedHz ?? 0),
    phaseSeed: hashStringToPhaseSeed(`merged:${key}`),
  };
}

function buildCollapsedEmitterKey(emitter: RoomLightingEmitter): string {
  const color = typeof emitter.glowColor === 'number' ? emitter.glowColor : -1;
  return [
    Math.round(emitter.x * 100),
    Math.round(emitter.y * 100),
    color,
  ].join(':');
}

function buildTileLightProfileKey(
  tilesetKey: string,
  profile: TileLightEmissionConfig,
): string {
  return [
    tilesetKey,
    profile.aggregation ?? 'perTile',
    profile.offsetX ?? 0,
    profile.offsetY ?? 0,
    profile.revealRadiusPx,
    profile.glowRadiusPx,
    profile.glowColor,
    profile.glowAlpha,
    profile.flicker?.radiusAmplitude ?? 0,
    profile.flicker?.alphaAmplitude ?? 0,
    profile.flicker?.speedHz ?? 0,
  ].join(':');
}

function hashStringToPhaseSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
}
