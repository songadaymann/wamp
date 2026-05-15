import Phaser from 'phaser';
import {
  getObjectById,
  getObjectDisplayOffset,
  getObjectRuntimeBodyRect,
  ROOM_HEIGHT,
  ROOM_PX_HEIGHT,
  ROOM_PX_WIDTH,
  ROOM_WIDTH,
  TILE_SIZE,
  type GameObjectConfig,
} from '../../config';
import type { RoomSnapshot } from '../../persistence/roomModel';
import { resolveGoalRunStartPoint } from './goalRunStartGate';
import {
  getTerrainTileCollisionProfile,
  terrainTileCollidesAtLocalPixel,
} from './terrainCollision';

const PVP_SPAWN_DANGER_PADDING_PX = 4;
const PVP_SPAWN_EMERGENCY_STEP_PX = 4;

export interface ResolvePvpSpawnPointOptions {
  room: RoomSnapshot;
  participantIndex: number;
  playerWidth: number;
  playerHeight: number;
  playerStandingHeight: number;
  liveDangerousObjectBounds?: readonly Phaser.Geom.Rectangle[];
}

export function resolvePvpSpawnPoint(options: ResolvePvpSpawnPointOptions): { x: number; y: number } {
  const { room, participantIndex, playerHeight } = options;
  const origin = {
    x: room.coordinates.x * ROOM_PX_WIDTH,
    y: room.coordinates.y * ROOM_PX_HEIGHT,
  };
  const leftSide = participantIndex % 2 === 0;
  const dangerousObjectBounds = [
    ...getPvpAuthoredDangerousObjectBounds(room),
    ...(options.liveDangerousObjectBounds ?? []),
  ];
  const preferredStart = Phaser.Math.Clamp(
    Math.floor(ROOM_WIDTH * (leftSide ? 0.18 : 0.82)),
    2,
    ROOM_WIDTH - 3,
  );

  for (const tileX of getPvpSpawnColumnOrder(preferredStart, leftSide)) {
    const spawn = resolvePvpSurfaceSpawnPointForTile(room, tileX, playerHeight);
    if (
      !spawn ||
      !isPvpSpawnPointClear(room, spawn, dangerousObjectBounds, options)
    ) {
      continue;
    }

    return {
      x: origin.x + spawn.x,
      y: origin.y + spawn.y,
    };
  }

  const fallback = resolveGoalRunStartPoint(room, playerHeight);
  const fallbackSpawn = {
    x: ROOM_PX_WIDTH * (leftSide ? 0.18 : 0.82),
    y: fallback.y - origin.y - playerHeight / 2,
  };
  if (isPvpSpawnPointClear(room, fallbackSpawn, dangerousObjectBounds, options)) {
    return {
      x: origin.x + fallbackSpawn.x,
      y: origin.y + fallbackSpawn.y,
    };
  }

  const terrainClearFallback = resolvePvpEmergencySpawnPoint(
    room,
    leftSide,
    dangerousObjectBounds,
    true,
    options,
  );
  if (terrainClearFallback) {
    return {
      x: origin.x + terrainClearFallback.x,
      y: origin.y + terrainClearFallback.y,
    };
  }

  const objectClearFallback = resolvePvpEmergencySpawnPoint(
    room,
    leftSide,
    dangerousObjectBounds,
    false,
    options,
  );
  if (objectClearFallback) {
    return {
      x: origin.x + objectClearFallback.x,
      y: origin.y + objectClearFallback.y,
    };
  }

  return {
    x: origin.x + ROOM_PX_WIDTH * (leftSide ? 0.18 : 0.82),
    y: fallback.y - playerHeight / 2,
  };
}

export function isPvpDangerousObjectConfig(
  config: GameObjectConfig | null | undefined,
): config is GameObjectConfig {
  return config?.category === 'hazard' || config?.category === 'enemy';
}

function getPvpAuthoredDangerousObjectBounds(room: RoomSnapshot): Phaser.Geom.Rectangle[] {
  const dangerousBounds: Phaser.Geom.Rectangle[] = [];

  for (const placedObject of room.placedObjects) {
    const config = getObjectById(placedObject.id);
    if (isPvpDangerousObjectConfig(config)) {
      dangerousBounds.push(getPvpObjectBodyBounds(config, placedObject.x, placedObject.y));
    }

    const containedConfig = placedObject.containedObjectId
      ? getObjectById(placedObject.containedObjectId)
      : null;
    if (!isPvpDangerousObjectConfig(containedConfig)) {
      continue;
    }

    const containerOffset = config ? getObjectDisplayOffset(config) : { x: 0, y: 0 };
    dangerousBounds.push(
      getPvpObjectBodyBounds(
        containedConfig,
        placedObject.x + containerOffset.x,
        placedObject.y + containerOffset.y + 2,
      ),
    );
  }

  return dangerousBounds;
}

function getPvpObjectBodyBounds(
  config: GameObjectConfig,
  localX: number,
  localY: number,
): Phaser.Geom.Rectangle {
  const rect = getObjectRuntimeBodyRect(config, { x: localX, y: localY });
  return new Phaser.Geom.Rectangle(rect.x, rect.y, rect.width, rect.height);
}

function getPvpSpawnColumnOrder(preferredStart: number, leftSide: boolean): number[] {
  const columns: number[] = [];
  const usedColumns = new Set<number>();
  const addColumn = (tileX: number): void => {
    if (tileX < 1 || tileX > ROOM_WIDTH - 2 || usedColumns.has(tileX)) {
      return;
    }

    usedColumns.add(tileX);
    columns.push(tileX);
  };

  for (let offset = 0; offset < ROOM_WIDTH; offset += 1) {
    addColumn(preferredStart + (leftSide ? offset : -offset));
  }
  for (let offset = 1; offset < ROOM_WIDTH; offset += 1) {
    addColumn(preferredStart + (leftSide ? -offset : offset));
  }

  return columns;
}

function resolvePvpSurfaceSpawnPointForTile(
  room: RoomSnapshot,
  tileX: number,
  playerHeight: number,
): { x: number; y: number } | null {
  const surfaceTileY = findPvpSpawnSurfaceTile(room, tileX, playerHeight);
  if (surfaceTileY === null) {
    return null;
  }

  const profile = getTerrainTileCollisionProfile(room, tileX, surfaceTileY);
  return {
    x: tileX * TILE_SIZE + TILE_SIZE / 2,
    y: surfaceTileY * TILE_SIZE + profile.topInset - playerHeight / 2,
  };
}

function findPvpSpawnSurfaceTile(room: RoomSnapshot, tileX: number, playerHeight: number): number | null {
  const clearTilesNeeded = Math.max(2, Math.ceil(playerHeight / TILE_SIZE) + 1);
  for (let tileY = ROOM_HEIGHT - 1; tileY >= 0; tileY -= 1) {
    const profile = getTerrainTileCollisionProfile(room, tileX, tileY);
    if (!profile.hasCollision) {
      continue;
    }

    let hasClearHeadroom = true;
    for (let offset = 1; offset <= clearTilesNeeded; offset += 1) {
      const aboveTileY = tileY - offset;
      if (aboveTileY < 0) {
        break;
      }

      if (getTerrainTileCollisionProfile(room, tileX, aboveTileY).hasCollision) {
        hasClearHeadroom = false;
        break;
      }
    }

    if (hasClearHeadroom) {
      return tileY;
    }
  }

  return null;
}

function isPvpSpawnPointClear(
  room: RoomSnapshot,
  spawn: { x: number; y: number },
  dangerousObjectBounds: readonly Phaser.Geom.Rectangle[],
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerStandingHeight'>,
  requireTerrainClear = false,
): boolean {
  const playerBounds = getPvpSpawnSafetyBounds(spawn.x, spawn.y, options);
  if (
    playerBounds.left < 0 ||
    playerBounds.right > ROOM_PX_WIDTH ||
    playerBounds.top < 0 ||
    playerBounds.bottom > ROOM_PX_HEIGHT
  ) {
    return false;
  }

  for (const dangerousBounds of dangerousObjectBounds) {
    if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, dangerousBounds)) {
      return false;
    }
  }

  return !requireTerrainClear || isPvpSpawnTerrainClear(room, playerBounds);
}

function getPvpSpawnSafetyBounds(
  localX: number,
  localY: number,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerStandingHeight'>,
): Phaser.Geom.Rectangle {
  return new Phaser.Geom.Rectangle(
    localX - options.playerWidth / 2 - PVP_SPAWN_DANGER_PADDING_PX,
    localY - options.playerStandingHeight / 2 - PVP_SPAWN_DANGER_PADDING_PX,
    options.playerWidth + PVP_SPAWN_DANGER_PADDING_PX * 2,
    options.playerStandingHeight + PVP_SPAWN_DANGER_PADDING_PX * 2,
  );
}

function isPvpSpawnTerrainClear(room: RoomSnapshot, playerBounds: Phaser.Geom.Rectangle): boolean {
  const sampleXs = [
    playerBounds.left + 1,
    playerBounds.centerX,
    playerBounds.right - 1,
  ];
  const sampleYs = [
    playerBounds.top + 1,
    playerBounds.centerY,
    playerBounds.bottom - 1,
  ];

  for (const sampleX of sampleXs) {
    for (const sampleY of sampleYs) {
      if (isSolidTerrainAtRoomLocalPoint(room, sampleX, sampleY)) {
        return false;
      }
    }
  }

  return true;
}

function isSolidTerrainAtRoomLocalPoint(room: RoomSnapshot, localX: number, localY: number): boolean {
  const tileX = Math.floor(localX / TILE_SIZE);
  const tileY = Math.floor(localY / TILE_SIZE);
  if (tileX < 0 || tileX >= ROOM_WIDTH || tileY < 0 || tileY >= ROOM_HEIGHT) {
    return false;
  }

  const localPixelY = localY - tileY * TILE_SIZE;
  return terrainTileCollidesAtLocalPixel(room, tileX, tileY, localPixelY);
}

function resolvePvpEmergencySpawnPoint(
  room: RoomSnapshot,
  leftSide: boolean,
  dangerousObjectBounds: readonly Phaser.Geom.Rectangle[],
  requireTerrainClear: boolean,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerStandingHeight'>,
): { x: number; y: number } | null {
  const preferredStart = Phaser.Math.Clamp(
    Math.floor(ROOM_WIDTH * (leftSide ? 0.18 : 0.82)),
    2,
    ROOM_WIDTH - 3,
  );
  const columns = getPvpSpawnColumnOrder(preferredStart, leftSide);
  const topY = options.playerStandingHeight / 2 + PVP_SPAWN_DANGER_PADDING_PX + 1;
  const bottomY = ROOM_PX_HEIGHT - options.playerStandingHeight / 2 - PVP_SPAWN_DANGER_PADDING_PX - 1;

  for (const tileX of columns) {
    const spawnX = tileX * TILE_SIZE + TILE_SIZE / 2;
    for (let spawnY = bottomY; spawnY >= topY; spawnY -= PVP_SPAWN_EMERGENCY_STEP_PX) {
      const spawn = { x: spawnX, y: spawnY };
      if (isPvpSpawnPointClear(room, spawn, dangerousObjectBounds, options, requireTerrainClear)) {
        return spawn;
      }
    }
  }

  return null;
}
