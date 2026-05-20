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
const PVP_SPAWN_REACHABILITY_STEP_PX = 8;
const PVP_SPAWN_MIN_ESCAPE_DISTANCE_PX = TILE_SIZE * 3;
const PVP_SPAWN_ESCAPE_STEP_PX = 4;

export interface ResolvePvpSpawnPointOptions {
  room: RoomSnapshot;
  participantIndex: number;
  playerWidth: number;
  playerHeight: number;
  playerStandingHeight: number;
  liveDangerousObjectBounds?: readonly Phaser.Geom.Rectangle[];
  liveSolidObjectBounds?: readonly Phaser.Geom.Rectangle[];
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
  const solidObjectBounds = options.liveSolidObjectBounds !== undefined
    ? [...options.liveSolidObjectBounds]
    : getPvpAuthoredSolidObjectBounds(room);
  const preferredStart = Phaser.Math.Clamp(
    Math.floor(ROOM_WIDTH * (leftSide ? 0.18 : 0.82)),
    2,
    ROOM_WIDTH - 3,
  );
  const reachableRegion = resolvePvpReachableSpawnRegion(
    room,
    solidObjectBounds,
    dangerousObjectBounds,
    options,
  );

  const reachableSurfaceSpawn = resolvePvpSurfaceSpawnPoint(
    room,
    preferredStart,
    leftSide,
    dangerousObjectBounds,
    solidObjectBounds,
    options,
    reachableRegion,
  );
  if (reachableSurfaceSpawn) {
    return {
      x: origin.x + reachableSurfaceSpawn.x,
      y: origin.y + reachableSurfaceSpawn.y,
    };
  }

  const fallbackSurfaceSpawn = reachableRegion
    ? resolvePvpSurfaceSpawnPoint(
        room,
        preferredStart,
        leftSide,
        dangerousObjectBounds,
        solidObjectBounds,
        options,
        null,
      )
    : null;
  if (fallbackSurfaceSpawn) {
    return {
      x: origin.x + fallbackSurfaceSpawn.x,
      y: origin.y + fallbackSurfaceSpawn.y,
    };
  }

  const fallback = resolveGoalRunStartPoint(room, playerHeight);
  const fallbackSpawn = {
    x: ROOM_PX_WIDTH * (leftSide ? 0.18 : 0.82),
    y: fallback.y - origin.y - playerHeight / 2,
  };
  if (
    isPvpSpawnPointClear(room, fallbackSpawn, dangerousObjectBounds, solidObjectBounds, options, true) &&
    hasPvpSpawnEscapeSpace(room, fallbackSpawn, [...solidObjectBounds, ...dangerousObjectBounds], options) &&
    isPvpSpawnReachable(fallbackSpawn, reachableRegion, options)
  ) {
    return {
      x: origin.x + fallbackSpawn.x,
      y: origin.y + fallbackSpawn.y,
    };
  }

  const terrainClearFallback = resolvePvpEmergencySpawnPoint(
    room,
    leftSide,
    dangerousObjectBounds,
    solidObjectBounds,
    true,
    options,
    reachableRegion,
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
    solidObjectBounds,
    false,
    options,
    reachableRegion,
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

export function isPvpSolidObjectConfig(
  config: GameObjectConfig | null | undefined,
): config is GameObjectConfig {
  return Boolean(
    config &&
    config.bodyWidth > 0 &&
    config.bodyHeight > 0 &&
    (config.category === 'platform' || config.id === 'door_locked' || config.id === 'trapdoor_locked'),
  );
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

function getPvpAuthoredSolidObjectBounds(room: RoomSnapshot): Phaser.Geom.Rectangle[] {
  const solidBounds: Phaser.Geom.Rectangle[] = [];

  for (const placedObject of room.placedObjects) {
    const config = getObjectById(placedObject.id);
    if (!isPvpSolidObjectConfig(config)) {
      continue;
    }

    solidBounds.push(getPvpObjectBodyBounds(config, placedObject.x, placedObject.y));
  }

  return solidBounds;
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

function resolvePvpSurfaceSpawnPoint(
  room: RoomSnapshot,
  preferredStart: number,
  leftSide: boolean,
  dangerousObjectBounds: readonly Phaser.Geom.Rectangle[],
  solidObjectBounds: readonly Phaser.Geom.Rectangle[],
  options: ResolvePvpSpawnPointOptions,
  reachableRegion: PvpReachableSpawnRegion | null,
): { x: number; y: number } | null {
  const blockers = [...solidObjectBounds, ...dangerousObjectBounds];

  for (const tileX of getPvpSpawnColumnOrder(preferredStart, leftSide)) {
    const spawn = resolvePvpSurfaceSpawnPointForTile(room, tileX, options.playerHeight);
    if (
      !spawn ||
      !isPvpSpawnPointClear(room, spawn, dangerousObjectBounds, solidObjectBounds, options, true) ||
      !hasPvpSpawnEscapeSpace(room, spawn, blockers, options) ||
      !isPvpSpawnReachable(spawn, reachableRegion, options)
    ) {
      continue;
    }

    return spawn;
  }

  return null;
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
  solidObjectBounds: readonly Phaser.Geom.Rectangle[],
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
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

  for (const solidBounds of solidObjectBounds) {
    if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, solidBounds)) {
      return false;
    }
  }

  return !requireTerrainClear || isPvpSpawnBodyClear(room, spawn, solidObjectBounds, options);
}

function getPvpSpawnSafetyBounds(
  localX: number,
  localY: number,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
): Phaser.Geom.Rectangle {
  const feetY = getPvpSpawnFeetY(localY, options);
  return new Phaser.Geom.Rectangle(
    localX - options.playerWidth / 2 - PVP_SPAWN_DANGER_PADDING_PX,
    feetY - options.playerStandingHeight - PVP_SPAWN_DANGER_PADDING_PX,
    options.playerWidth + PVP_SPAWN_DANGER_PADDING_PX * 2,
    options.playerStandingHeight + PVP_SPAWN_DANGER_PADDING_PX * 2,
  );
}

function getPvpSpawnBodyBounds(
  localX: number,
  localY: number,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
): Phaser.Geom.Rectangle {
  const feetY = getPvpSpawnFeetY(localY, options);
  return new Phaser.Geom.Rectangle(
    localX - options.playerWidth / 2,
    feetY - options.playerStandingHeight,
    options.playerWidth,
    Math.max(1, options.playerStandingHeight - 1),
  );
}

function getPvpSpawnFeetY(
  localY: number,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerHeight'>,
): number {
  return localY + options.playerHeight / 2;
}

function isPvpSpawnBodyClear(
  room: RoomSnapshot,
  spawn: { x: number; y: number },
  objectBlockers: readonly Phaser.Geom.Rectangle[],
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
): boolean {
  const playerBounds = getPvpSpawnBodyBounds(spawn.x, spawn.y, options);
  if (
    playerBounds.left < 0 ||
    playerBounds.right > ROOM_PX_WIDTH ||
    playerBounds.top < 0 ||
    playerBounds.bottom > ROOM_PX_HEIGHT
  ) {
    return false;
  }

  for (const blocker of objectBlockers) {
    if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, blocker)) {
      return false;
    }
  }

  return isPvpSpawnTerrainClear(room, playerBounds);
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

function hasPvpSpawnEscapeSpace(
  room: RoomSnapshot,
  spawn: { x: number; y: number },
  objectBlockers: readonly Phaser.Geom.Rectangle[],
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
): boolean {
  if (!isPvpSpawnBodyClear(room, spawn, objectBlockers, options)) {
    return false;
  }

  for (const direction of [-1, 1] as const) {
    let lastClearDistance = 0;
    for (
      let distance = PVP_SPAWN_ESCAPE_STEP_PX;
      distance <= PVP_SPAWN_MIN_ESCAPE_DISTANCE_PX;
      distance += PVP_SPAWN_ESCAPE_STEP_PX
    ) {
      if (!isPvpSpawnBodyClear(room, { x: spawn.x + direction * distance, y: spawn.y }, objectBlockers, options)) {
        break;
      }
      lastClearDistance = distance;
    }

    if (lastClearDistance >= PVP_SPAWN_MIN_ESCAPE_DISTANCE_PX) {
      return true;
    }
  }

  return false;
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
  solidObjectBounds: readonly Phaser.Geom.Rectangle[],
  requireTerrainClear: boolean,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
  reachableRegion: PvpReachableSpawnRegion | null,
): { x: number; y: number } | null {
  const preferredStart = Phaser.Math.Clamp(
    Math.floor(ROOM_WIDTH * (leftSide ? 0.18 : 0.82)),
    2,
    ROOM_WIDTH - 3,
  );
  const columns = getPvpSpawnColumnOrder(preferredStart, leftSide);
  const topY = options.playerStandingHeight / 2 + PVP_SPAWN_DANGER_PADDING_PX + 1;
  const bottomY = ROOM_PX_HEIGHT - options.playerStandingHeight / 2 - PVP_SPAWN_DANGER_PADDING_PX - 1;
  const blockers = [...solidObjectBounds, ...dangerousObjectBounds];

  for (const tileX of columns) {
    const spawnX = tileX * TILE_SIZE + TILE_SIZE / 2;
    for (let spawnY = bottomY; spawnY >= topY; spawnY -= PVP_SPAWN_EMERGENCY_STEP_PX) {
      const spawn = { x: spawnX, y: spawnY };
      if (
        isPvpSpawnPointClear(room, spawn, dangerousObjectBounds, solidObjectBounds, options, requireTerrainClear) &&
        (!requireTerrainClear || hasPvpSpawnEscapeSpace(room, spawn, blockers, options)) &&
        isPvpSpawnReachable(spawn, reachableRegion, options)
      ) {
        return spawn;
      }
    }
  }

  return null;
}

interface PvpReachableSpawnRegion {
  readonly cells: ReadonlySet<string>;
}

function resolvePvpReachableSpawnRegion(
  room: RoomSnapshot,
  solidObjectBounds: readonly Phaser.Geom.Rectangle[],
  dangerousObjectBounds: readonly Phaser.Geom.Rectangle[],
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
): PvpReachableSpawnRegion | null {
  const origin = {
    x: room.coordinates.x * ROOM_PX_WIDTH,
    y: room.coordinates.y * ROOM_PX_HEIGHT,
  };
  const startPoint = resolveGoalRunStartPoint(room, options.playerHeight);
  const startSpawn = {
    x: startPoint.x - origin.x,
    y: startPoint.y - origin.y - options.playerHeight / 2,
  };
  const blockers = [...solidObjectBounds, ...dangerousObjectBounds];
  const startCell = findNearestPvpReachableCell(room, startSpawn, blockers, options);
  if (!startCell) {
    return null;
  }

  const cells = new Set<string>();
  const queue: Array<{ cellX: number; cellY: number }> = [startCell];
  cells.add(getPvpReachableCellKey(startCell.cellX, startCell.cellY));

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const [offsetX, offsetY] of PVP_REACHABLE_CELL_NEIGHBORS) {
      const next = { cellX: current.cellX + offsetX, cellY: current.cellY + offsetY };
      if (
        next.cellX < 0 ||
        next.cellY < 0 ||
        next.cellX >= getPvpReachableGridWidth() ||
        next.cellY >= getPvpReachableGridHeight()
      ) {
        continue;
      }

      const key = getPvpReachableCellKey(next.cellX, next.cellY);
      if (cells.has(key)) {
        continue;
      }

      if (!isPvpReachableCellClear(room, next.cellX, next.cellY, blockers, options)) {
        continue;
      }

      cells.add(key);
      queue.push(next);
    }
  }

  return { cells };
}

const PVP_REACHABLE_CELL_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function findNearestPvpReachableCell(
  room: RoomSnapshot,
  spawn: { x: number; y: number },
  objectBlockers: readonly Phaser.Geom.Rectangle[],
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerHeight' | 'playerStandingHeight'>,
): { cellX: number; cellY: number } | null {
  const desired = getPvpReachableCellForSpawn(spawn, options);
  const maxRadius = Math.max(getPvpReachableGridWidth(), getPvpReachableGridHeight());

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        if (Math.max(Math.abs(offsetX), Math.abs(offsetY)) !== radius) {
          continue;
        }

        const cellX = desired.cellX + offsetX;
        const cellY = desired.cellY + offsetY;
        if (
          cellX < 0 ||
          cellY < 0 ||
          cellX >= getPvpReachableGridWidth() ||
          cellY >= getPvpReachableGridHeight()
        ) {
          continue;
        }

        if (isPvpReachableCellClear(room, cellX, cellY, objectBlockers, options)) {
          return { cellX, cellY };
        }
      }
    }
  }

  return null;
}

function isPvpSpawnReachable(
  spawn: { x: number; y: number },
  reachableRegion: PvpReachableSpawnRegion | null,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerHeight' | 'playerStandingHeight'>,
): boolean {
  if (!reachableRegion) {
    return true;
  }

  const cell = getPvpReachableCellForSpawn(spawn, options);
  return reachableRegion.cells.has(getPvpReachableCellKey(cell.cellX, cell.cellY));
}

function isPvpReachableCellClear(
  room: RoomSnapshot,
  cellX: number,
  cellY: number,
  objectBlockers: readonly Phaser.Geom.Rectangle[],
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerStandingHeight'>,
): boolean {
  const bounds = getPvpReachableCellBodyBounds(cellX, cellY, options);
  if (
    bounds.left < 0 ||
    bounds.right > ROOM_PX_WIDTH ||
    bounds.top < 0 ||
    bounds.bottom > ROOM_PX_HEIGHT
  ) {
    return false;
  }

  for (const blocker of objectBlockers) {
    if (Phaser.Geom.Intersects.RectangleToRectangle(bounds, blocker)) {
      return false;
    }
  }

  return isPvpSpawnTerrainClear(room, bounds);
}

function getPvpReachableCellForSpawn(
  spawn: { x: number; y: number },
  options: Pick<ResolvePvpSpawnPointOptions, 'playerHeight' | 'playerStandingHeight'>,
): { cellX: number; cellY: number } {
  const feetY = getPvpSpawnFeetY(spawn.y, options);
  const bodyCenterY = feetY - options.playerStandingHeight / 2;
  return {
    cellX: Phaser.Math.Clamp(
      Math.floor(spawn.x / PVP_SPAWN_REACHABILITY_STEP_PX),
      0,
      getPvpReachableGridWidth() - 1,
    ),
    cellY: Phaser.Math.Clamp(
      Math.floor(bodyCenterY / PVP_SPAWN_REACHABILITY_STEP_PX),
      0,
      getPvpReachableGridHeight() - 1,
    ),
  };
}

function getPvpReachableCellBodyBounds(
  cellX: number,
  cellY: number,
  options: Pick<ResolvePvpSpawnPointOptions, 'playerWidth' | 'playerStandingHeight'>,
): Phaser.Geom.Rectangle {
  const centerX = cellX * PVP_SPAWN_REACHABILITY_STEP_PX + PVP_SPAWN_REACHABILITY_STEP_PX / 2;
  const centerY = cellY * PVP_SPAWN_REACHABILITY_STEP_PX + PVP_SPAWN_REACHABILITY_STEP_PX / 2;
  return new Phaser.Geom.Rectangle(
    centerX - options.playerWidth / 2,
    centerY - options.playerStandingHeight / 2,
    options.playerWidth,
    Math.max(1, options.playerStandingHeight - 1),
  );
}

function getPvpReachableGridWidth(): number {
  return Math.ceil(ROOM_PX_WIDTH / PVP_SPAWN_REACHABILITY_STEP_PX);
}

function getPvpReachableGridHeight(): number {
  return Math.ceil(ROOM_PX_HEIGHT / PVP_SPAWN_REACHABILITY_STEP_PX);
}

function getPvpReachableCellKey(cellX: number, cellY: number): string {
  return `${cellX},${cellY}`;
}
