import { describe, expect, it } from 'vitest';
import { createEmptyTileData } from '../persistence/roomModel';
import { getTerrainCollisionProfileForGid, getTilesetByKey } from '../config/tilesets';
import { decodeTileDataValue } from '../config/editorState';
import { createRoomSmartTerrainState } from './model';
import {
  applySmartCells,
  fillEmptySmartTerrain,
  lockSmartTerrainCell,
  setSmartTerrainDetailsEnabled,
  suppressGeneratedDecorationAt,
} from './solver';

function emptyDocument() {
  return {
    tileData: createEmptyTileData(),
    smartTerrain: createRoomSmartTerrainState(),
  };
}

describe('smart terrain solver', () => {
  it.each(['forest', 'desert', 'cave', 'gothic'] as const)(
    'bakes connected %s ground with non-colliding deterministic details',
    (theme) => {
      const first = applySmartCells(emptyDocument(), {
        cells: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }],
        mode: 'paint',
        theme,
        material: 'ground',
      });
      const second = applySmartCells(emptyDocument(), {
        cells: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }],
        mode: 'paint',
        theme,
        material: 'ground',
      });

      expect(first.tileData).toEqual(second.tileData);
      expect(Object.keys(first.smartTerrain.cells)).toHaveLength(4);
      expect(Object.keys(first.smartTerrain.generatedDecorations).length).toBeLessThanOrEqual(1);
      for (const row of first.tileData.terrain) {
        for (const gid of row) {
          if (gid > 0) expect(getTerrainCollisionProfileForGid(gid).hasCollision).toBe(true);
        }
      }
      for (const row of first.tileData.foreground) {
        for (const gid of row) {
          if (gid > 0) expect(getTerrainCollisionProfileForGid(decodeTileDataValue(gid).gid).hasCollision).toBe(false);
        }
      }
    },
  );

  it('repairs neighbors after erasing a middle cell', () => {
    const painted = applySmartCells(emptyDocument(), {
      cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'platform',
    });
    const beforeLeft = painted.tileData.terrain[3][2];
    const erased = applySmartCells(painted, {
      cells: [{ x: 3, y: 3 }],
      mode: 'erase',
      theme: 'forest',
      material: 'platform',
    });

    expect(erased.tileData.terrain[3][3]).toBe(-1);
    expect(erased.tileData.terrain[3][2]).not.toBe(beforeLeft);
  });

  it.each(['forest', 'desert', 'cave', 'gothic'] as const)(
    'uses real platform ends instead of hole/bridge art for %s',
    (theme) => {
      const firstGid = getTilesetByKey(theme)!.firstGid;
      const result = applySmartCells(emptyDocument(), {
        cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }],
        mode: 'paint',
        theme,
        material: 'platform',
      });
      expect(result.tileData.terrain[3].slice(2, 5).map((gid) => gid - firstGid)).toEqual([44, 45, 46]);
    },
  );

  it.each(['forest', 'desert', 'cave', 'gothic'] as const)(
    'builds seamless %s feature blocks with a non-colliding detail outline',
    (theme) => {
      const firstGid = getTilesetByKey(theme)!.firstGid;
      const result = applySmartCells(emptyDocument(), {
        cells: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }],
        mode: 'paint',
        theme,
        material: 'feature',
      });
      expect(result.tileData.terrain[4][3] - firstGid).toBe(12);
      expect(Object.keys(result.smartTerrain.generatedDecorations)).toHaveLength(8);
      for (const row of result.tileData.foreground) {
        for (const gid of row) {
          if (gid > 0) expect(getTerrainCollisionProfileForGid(decodeTileDataValue(gid).gid).hasCollision).toBe(false);
        }
      }
    },
  );

  it('uses the inner-void tie family around a carved underground hole', () => {
    let result = applySmartCells(emptyDocument(), {
      cells: Array.from({ length: 25 }, (_, index) => ({ x: 5 + (index % 5), y: 5 + Math.floor(index / 5) })),
      mode: 'paint',
      theme: 'cave',
      material: 'ground',
    });
    result = applySmartCells(result, {
      cells: [{ x: 7, y: 7 }],
      mode: 'erase',
      theme: 'cave',
      material: 'ground',
    });
    const firstGid = getTilesetByKey('cave')!.firstGid;
    const local = (value: number) => decodeTileDataValue(value).gid - firstGid;
    expect(result.tileData.terrain[6].slice(6, 9).map(local)).toEqual([33, 52, 35]);
    expect(result.tileData.terrain[7].slice(6, 9).map(local)).toEqual([42, -firstGid - 1, 37]);
    expect(result.tileData.terrain[8].slice(6, 9).map(local)).toEqual([33, 34, 35]);
    expect(decodeTileDataValue(result.tileData.terrain[6][6]).flipY).toBe(true);
    expect(decodeTileDataValue(result.tileData.terrain[6][8]).flipY).toBe(true);
  });

  it.each([
    { name: 'top-right', carved: [[10, 9], [11, 9], [11, 10]], localIndex: 37, flipY: true },
    { name: 'top-left', carved: [[10, 9], [9, 9], [9, 10]], localIndex: 42, flipY: true },
    { name: 'bottom-right', carved: [[11, 10], [11, 11], [10, 11]], localIndex: 37, flipY: false },
    { name: 'bottom-left', carved: [[9, 10], [9, 11], [10, 11]], localIndex: 42, flipY: false },
  ])('uses the flipped vertical wall art for an enclosed $name ground step', ({ carved, localIndex, flipY }) => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    let result = applySmartCells(emptyDocument(), {
      cells: Array.from({ length: 49 }, (_, index) => ({ x: 7 + (index % 7), y: 7 + Math.floor(index / 7) })),
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    result = applySmartCells(result, {
      cells: carved.map(([x, y]) => ({ x: x!, y: y! })),
      mode: 'erase',
      theme: 'forest',
      material: 'ground',
    });
    const step = decodeTileDataValue(result.tileData.terrain[10][10]);
    expect(step.gid - firstGid).toBe(localIndex);
    expect(step.flipY).toBe(flipY);
  });

  it('repeats one clean wall tile down a one-cell-wide vertical column', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: Array.from({ length: 6 }, (_, index) => ({ x: 7, y: 4 + index })),
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    expect(result.tileData.terrain.slice(4, 10).map((row) => decodeTileDataValue(row[7]).gid - firstGid))
      .toEqual([37, 37, 37, 37, 37, 37]);
  });

  it('adds feature corner detail only to a real inside corner and lets it stay erased', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }],
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    const insideCorner = decodeTileDataValue(result.tileData.foreground[5][4]);
    expect(insideCorner.gid - firstGid).toBe(22);
    expect(insideCorner.flipX).toBe(true);
    expect(result.smartTerrain.generatedDecorations['3,3']).toBeUndefined();

    const suppressed = suppressGeneratedDecorationAt(result, 4, 5);
    const regenerated = applySmartCells(suppressed, {
      cells: [{ x: 5, y: 6 }],
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    expect(regenerated.tileData.foreground[5][4]).toBe(-1);
  });

  it('layers a corner and straight feature edge when a notch has three feature neighbors', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: [{ x: 5, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 6 }],
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    const front = decodeTileDataValue(result.tileData.foreground[5][5]);
    const behind = decodeTileDataValue(result.tileData.background[5][5]);
    expect(front.gid - firstGid).toBe(10);
    expect(front.flipX).toBe(true);
    expect(behind.gid - firstGid).toBe(24);
    expect(result.smartTerrain.generatedDecorations['5,5']).toBeDefined();
    expect(result.smartTerrain.generatedBackgroundDecorations['5,5']).toBeDefined();

    const frontErased = suppressGeneratedDecorationAt(result, 5, 5);
    expect(frontErased.tileData.foreground[5][5]).toBe(-1);
    expect(frontErased.tileData.background[5][5]).not.toBe(-1);
    const bothErased = suppressGeneratedDecorationAt(frontErased, 5, 5);
    expect(bothErased.tileData.background[5][5]).toBe(-1);
  });

  it('uses all four approved sparse ground decoration variants', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: Array.from({ length: 120 }, (_, index) => ({ x: index % 40, y: 4 + Math.floor(index / 40) * 4 })),
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const variants = new Set(Object.values(result.smartTerrain.generatedDecorations)
      .map(({ gid }) => gid - firstGid));
    expect([...variants].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
  });

  it('keeps an exact manual override locked until Smart repaints the cell', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const painted = applySmartCells(emptyDocument(), {
      cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const locked = lockSmartTerrainCell(painted, 2, 3, firstGid + 60);
    const extended = applySmartCells(locked, {
      cells: [{ x: 4, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    expect(extended.tileData.terrain[3][2]).toBe(firstGid + 60);

    const unlocked = applySmartCells(extended, {
      cells: [{ x: 2, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    expect(unlocked.tileData.terrain[3][2]).not.toBe(firstGid + 60);
    expect(unlocked.smartTerrain.cells['2,3']?.lockedGid).toBeUndefined();
  });

  it('connects to compatible legacy terrain without rewriting it', () => {
    const document = emptyDocument();
    const legacyGid = getTilesetByKey('forest')!.firstGid + 44;
    document.tileData.terrain[4][2] = legacyGid;
    const result = applySmartCells(document, {
      cells: [{ x: 3, y: 4 }],
      mode: 'paint',
      theme: 'forest',
      material: 'platform',
    });
    expect(result.tileData.terrain[4][2]).toBe(legacyGid);
    expect(result.smartTerrain.cells['2,4']).toBeUndefined();
  });

  it('toggles only engine-owned details', () => {
    const painted = applySmartCells(emptyDocument(), {
      cells: [{ x: 3, y: 4 }, { x: 4, y: 4 }],
      mode: 'paint',
      theme: 'desert',
      material: 'feature',
    });
    painted.tileData.foreground[0][0] = 999;
    const disabled = setSmartTerrainDetailsEnabled(painted, false);
    expect(disabled.tileData.foreground[0][0]).toBe(999);
    expect(Object.keys(disabled.smartTerrain.generatedDecorations)).toHaveLength(0);
  });

  it('fills only empty Cave terrain cells', () => {
    const document = emptyDocument();
    document.tileData.terrain[0][0] = 999;
    const filled = fillEmptySmartTerrain(document, 'cave');
    expect(filled.tileData.terrain[0][0]).toBe(999);
    expect(Object.keys(filled.smartTerrain.cells)).toHaveLength(40 * 22 - 1);
  });
});
