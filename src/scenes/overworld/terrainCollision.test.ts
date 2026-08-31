import { describe, expect, it } from 'vitest';
import {
  getTilesetByKey,
  SPECIAL_TILE_LOCAL_INDICES,
  SPECIAL_TILE_ONE_WAY_PLATFORM_GID,
  SPECIAL_TILESET_FIRST_GID,
} from '../../config';
import { smartSemanticCellKey } from '../../autotiling/model';
import { createDefaultRoomSnapshot } from '../../persistence/roomModel';
import {
  getTerrainCollisionTileValue,
  getTerrainTileCollisionProfile,
  hasSmartBackgroundOneWaySurface,
  roomHasTerrainTile,
} from './terrainCollision';

function createRoom() {
  return createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
}

const FOREST_FIRST_GID = getTilesetByKey('forest')!.firstGid;
const FOREST_GROUND_GID = FOREST_FIRST_GID + 14; // Forest B3: colliding Ground art.

function paintSmartCell(
  room: ReturnType<typeof createRoom>,
  layer: 'background' | 'terrain' | 'foreground',
  x: number,
  y: number,
  brushId: 'forest.ground' | 'water.tunnel' | 'cyber.concrete',
): void {
  const styleId = brushId === 'cyber.concrete'
    ? 'cyber-yellow'
    : brushId === 'water.tunnel' ? 'water' : 'forest';
  room.smartTerrain!.semanticCells[smartSemanticCellKey(layer, x, y)] = {
    styleId,
    brushId,
  };
}

describe('Smart Background Ground collision projection', () => {
  it('projects only the exposed top of a Background Ground block as Special A2', () => {
    const room = createRoom();
    paintSmartCell(room, 'background', 4, 5, 'forest.ground');
    paintSmartCell(room, 'background', 4, 6, 'forest.ground');

    expect(hasSmartBackgroundOneWaySurface(room, 4, 5)).toBe(true);
    expect(hasSmartBackgroundOneWaySurface(room, 4, 6)).toBe(false);
    expect(getTerrainTileCollisionProfile(room, 4, 5)).toEqual({
      hasCollision: true,
      topInset: 0,
      bottomInset: 0,
      height: 16,
      isSmartBackgroundSurface: true,
    });
    expect(getTerrainCollisionTileValue(room, 4, 5)).toEqual({
      gid: SPECIAL_TILE_ONE_WAY_PLATFORM_GID,
      flipX: false,
      flipY: false,
    });
    expect(SPECIAL_TILE_ONE_WAY_PLATFORM_GID).toBe(
      SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.oneWayPlatform,
    );
    expect(roomHasTerrainTile(room, 4, 5)).toBe(true);
    expect(roomHasTerrainTile(room, 4, 6)).toBe(false);

    delete room.smartTerrain!.semanticCells[smartSemanticCellKey('background', 4, 5)];
    expect(hasSmartBackgroundOneWaySurface(room, 4, 6)).toBe(true);
    expect(getTerrainCollisionTileValue(room, 4, 6).gid).toBe(
      SPECIAL_TILE_ONE_WAY_PLATFORM_GID,
    );
  });

  it('keeps manual Background art and non-colliding Smart brushes pass-through', () => {
    const room = createRoom();
    room.tileData.background[3][2] = FOREST_GROUND_GID;
    paintSmartCell(room, 'background', 3, 3, 'water.tunnel');

    expect(hasSmartBackgroundOneWaySurface(room, 2, 3)).toBe(false);
    expect(hasSmartBackgroundOneWaySurface(room, 3, 3)).toBe(false);
    expect(getTerrainTileCollisionProfile(room, 2, 3).hasCollision).toBe(false);
    expect(getTerrainTileCollisionProfile(room, 3, 3).hasCollision).toBe(false);
  });

  it('uses registry collision roles for Cyber Concrete and ignores other source layers', () => {
    const room = createRoom();
    paintSmartCell(room, 'background', 7, 8, 'cyber.concrete');
    paintSmartCell(room, 'foreground', 8, 8, 'forest.ground');
    paintSmartCell(room, 'terrain', 9, 8, 'forest.ground');

    expect(hasSmartBackgroundOneWaySurface(room, 7, 8)).toBe(true);
    expect(hasSmartBackgroundOneWaySurface(room, 8, 8)).toBe(false);
    expect(hasSmartBackgroundOneWaySurface(room, 9, 8)).toBe(false);
  });

  it('keeps an existing solid Gameplay tile authoritative over the projected surface', () => {
    const room = createRoom();
    paintSmartCell(room, 'background', 5, 5, 'forest.ground');
    room.tileData.terrain[5][5] = FOREST_GROUND_GID;

    expect(getTerrainTileCollisionProfile(room, 5, 5).isSmartBackgroundSurface).toBe(false);
    expect(getTerrainCollisionTileValue(room, 5, 5).gid).toBe(FOREST_GROUND_GID);
  });

  it('replaces a non-colliding Gameplay tile only in the invisible collision map', () => {
    const room = createRoom();
    paintSmartCell(room, 'background', 6, 5, 'forest.ground');
    const waterGid = SPECIAL_TILESET_FIRST_GID + SPECIAL_TILE_LOCAL_INDICES.water;
    room.tileData.terrain[5][6] = waterGid;

    expect(getTerrainTileCollisionProfile(room, 6, 5).isSmartBackgroundSurface).toBe(true);
    expect(getTerrainCollisionTileValue(room, 6, 5).gid).toBe(
      SPECIAL_TILE_ONE_WAY_PLATFORM_GID,
    );
    expect(room.tileData.terrain[5][6]).toBe(waterGid);
  });
});
