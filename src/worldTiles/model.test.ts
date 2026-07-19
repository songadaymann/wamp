import { describe, expect, it } from 'vitest';
import {
  assertWorldTileBounds,
  expandWorldTileManifestCoordinates,
  getWorldTileChildren,
  getWorldTileParent,
  getWorldTileRoomBounds,
  getWorldTileSiblingClosure,
  roomToWorldTileCoordinate,
  worldTileCoordinateKey,
} from './model';

describe('world tile pyramid geometry', () => {
  it('uses mathematical floor division for signed room coordinates', () => {
    expect(roomToWorldTileCoordinate({ x: -1, y: -1 }, 0)).toEqual({ level: 0, x: -1, y: -1 });
    expect(roomToWorldTileCoordinate({ x: -16, y: -16 }, 0)).toEqual({ level: 0, x: -1, y: -1 });
    expect(roomToWorldTileCoordinate({ x: -17, y: 15 }, 0)).toEqual({ level: 0, x: -2, y: 0 });
    expect(roomToWorldTileCoordinate({ x: -1, y: -1 }, 4)).toEqual({ level: 4, x: -1, y: -1 });
  });

  it('maps parents and four-child sibling groups correctly across zero', () => {
    expect(getWorldTileParent({ level: 4, x: -1, y: 0 })).toEqual({ level: 3, x: -1, y: 0 });
    expect(getWorldTileChildren({ level: 3, x: -1, y: 0 })).toEqual([
      { level: 4, x: -2, y: 0 },
      { level: 4, x: -1, y: 0 },
      { level: 4, x: -2, y: 1 },
      { level: 4, x: -1, y: 1 },
    ]);
    expect(getWorldTileSiblingClosure({ level: 4, x: -1, y: 0 })).toHaveLength(4);
  });

  it('returns exact room bounds for negative pyramid tiles', () => {
    expect(getWorldTileRoomBounds({ level: 0, x: -1, y: 1 })).toEqual({
      minRoomX: -16,
      maxRoomX: -1,
      minRoomY: 16,
      maxRoomY: 31,
    });
  });

  it('expands a target into sibling closure and every ancestor in stable coarse-first order', () => {
    const coordinates = expandWorldTileManifestCoordinates(4, {
      minTileX: 0,
      maxTileX: 0,
      minTileY: 0,
      maxTileY: 0,
    });
    expect(coordinates.map(worldTileCoordinateKey)).toEqual([
      '0:0:0',
      '1:0:0',
      '1:1:0',
      '1:0:1',
      '1:1:1',
      '2:0:0',
      '2:1:0',
      '2:0:1',
      '2:1:1',
      '3:0:0',
      '3:1:0',
      '3:0:1',
      '3:1:1',
      '4:0:0',
      '4:1:0',
      '4:0:1',
      '4:1:1',
    ]);
  });

  it('includes complete sibling replacement groups at every refinement level', () => {
    const coordinates = expandWorldTileManifestCoordinates(4, {
      minTileX: -1,
      maxTileX: -1,
      minTileY: -1,
      maxTileY: -1,
    });
    for (const level of [1, 2, 3, 4] as const) {
      expect(coordinates.filter((coordinate) => coordinate.level === level)).toHaveLength(4);
    }
    expect(coordinates.filter((coordinate) => coordinate.level === 0)).toHaveLength(1);
  });

  it('rejects unordered, unsafe, and larger-than-16-by-16 manifest windows', () => {
    expect(() => assertWorldTileBounds({ minTileX: 1, maxTileX: 0, minTileY: 0, maxTileY: 0 })).toThrow(
      'ordered',
    );
    expect(() => assertWorldTileBounds({ minTileX: 0, maxTileX: 16, minTileY: 0, maxTileY: 0 })).toThrow(
      '16 by 16',
    );
    expect(() => assertWorldTileBounds({
      minTileX: Number.MAX_SAFE_INTEGER + 1,
      maxTileX: Number.MAX_SAFE_INTEGER + 1,
      minTileY: 0,
      maxTileY: 0,
    })).toThrow('safe integers');
  });
});
