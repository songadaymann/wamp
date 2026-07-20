import { describe, expect, it } from 'vitest';
import {
  WORLD_TILE_IMAGE_HEIGHT,
  WORLD_TILE_IMAGE_WIDTH,
  WORLD_TILE_OVERLAP,
  floorDivide,
  getPixelsPerGameTile,
  getRoomsPerWorldTile,
  getWorldTileCorePlacement,
  getWorldTileChildren,
  getWorldTileParent,
  roomToWorldTileCoordinate,
  worldRectToTileBounds,
  worldTileToRoomBounds,
} from './geometry';
import type { WorldTileAddress, WorldTileLevel } from './types';

describe('world tile geometry', () => {
  it('uses mathematical floor division across zero', () => {
    expect(floorDivide(0, 16)).toBe(0);
    expect(floorDivide(15, 16)).toBe(0);
    expect(floorDivide(16, 16)).toBe(1);
    expect(floorDivide(-1, 16)).toBe(-1);
    expect(floorDivide(-16, 16)).toBe(-1);
    expect(floorDivide(-17, 16)).toBe(-2);
  });

  it('maps signed room coordinates into every pyramid level', () => {
    expect(roomToWorldTileCoordinate(0, -17, 16)).toEqual({ level: 0, x: -2, y: 1 });
    expect(roomToWorldTileCoordinate(1, -9, 8)).toEqual({ level: 1, x: -2, y: 1 });
    expect(roomToWorldTileCoordinate(2, -5, 4)).toEqual({ level: 2, x: -2, y: 1 });
    expect(roomToWorldTileCoordinate(3, -3, 2)).toEqual({ level: 3, x: -2, y: 1 });
    expect(roomToWorldTileCoordinate(4, -1, 1)).toEqual({ level: 4, x: -1, y: 1 });
  });

  it('round-trips tile room bounds at negative coordinates', () => {
    expect(worldTileToRoomBounds({ level: 1, x: -2, y: -1 })).toEqual({
      minRoomX: -16,
      maxRoomX: -9,
      minRoomY: -8,
      maxRoomY: -1,
    });
  });

  it('maps negative children to their signed parent and enumerates all four siblings', () => {
    const child = address(4, -1, -1);
    const parent = getWorldTileParent(child);
    expect(parent).toEqual(address(3, -1, -1));
    expect(parent && getWorldTileChildren(parent)).toEqual([
      address(4, -2, -2),
      address(4, -1, -2),
      address(4, -2, -1),
      address(4, -1, -1),
    ]);
  });

  it('treats viewport rectangles as half-open at exact tile boundaries', () => {
    expect(worldRectToTileBounds(4, {
      left: -640,
      top: -352,
      right: 0,
      bottom: 0,
    })).toEqual({ minTileX: -1, maxTileX: -1, minTileY: -1, maxTileY: -1 });

    expect(worldRectToTileBounds(4, {
      left: -1,
      top: -1,
      right: 1,
      bottom: 1,
    })).toEqual({ minTileX: -1, maxTileX: 0, minTileY: -1, maxTileY: 0 });
  });

  it('exposes the five canonical scales and extruded image dimensions', () => {
    expect([0, 1, 2, 3, 4].map((level) => getRoomsPerWorldTile(level as WorldTileLevel)))
      .toEqual([16, 8, 4, 2, 1]);
    expect([0, 1, 2, 3, 4].map((level) => getPixelsPerGameTile(level as WorldTileLevel)))
      .toEqual([1, 2, 4, 8, 16]);
    expect(WORLD_TILE_OVERLAP).toBe(1);
    expect([WORLD_TILE_IMAGE_WIDTH, WORLD_TILE_IMAGE_HEIGHT]).toEqual([642, 354]);
  });

  it('places cropped content frames edge-to-edge at every level across zero', () => {
    for (const level of [0, 1, 2, 3, 4] as const) {
      const left = getWorldTileCorePlacement({ level, x: -1, y: -1 });
      const right = getWorldTileCorePlacement({ level, x: 0, y: -1 });
      const below = getWorldTileCorePlacement({ level, x: -1, y: 0 });
      expect(left.x + left.width).toBe(right.x);
      expect(left.y + left.height).toBe(below.y);
      expect(right.width).toBe(left.width);
      expect(below.height).toBe(left.height);
    }
  });
});

function address(level: WorldTileLevel, x: number, y: number): WorldTileAddress {
  return { rendererVersion: 'renderer-v1', level, x, y };
}
