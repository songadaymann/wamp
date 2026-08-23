import { describe, expect, it } from 'vitest';
import { createEmptyTileData } from '../persistence/roomModel';
import { getTerrainCollisionProfileForGid, getTilesetByKey } from '../config/tilesets';
import { decodeTileDataValue } from '../config/editorState';
import { createRoomSmartTerrainState } from './model';
import {
  applySmartCells,
  applySmartOutlineCells,
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
  it('resolves a hollow Ground outline from its filled outward topology', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const filledCells = Array.from(
      { length: 25 },
      (_, index) => ({ x: 5 + (index % 5), y: 5 + Math.floor(index / 5) }),
    );
    const outlineCells = filledCells.filter(({ x, y }) => x === 5 || x === 9 || y === 5 || y === 9);
    const result = applySmartOutlineCells(emptyDocument(), {
      filledCells,
      outlineCells,
      theme: 'forest',
      material: 'ground',
    });
    const local = (x: number, y: number) => decodeTileDataValue(result.tileData.terrain[y][x]);

    expect([15, 16]).toContain(local(7, 5).gid - firstGid);
    expect([50, 51, 52, 53]).toContain(local(7, 9).gid - firstGid);
    expect(local(5, 7).gid - firstGid).toBe(37);
    expect(local(9, 7).gid - firstGid).toBe(42);
    expect(local(5, 5).gid - firstGid).toBe(14);
    expect(local(9, 5).gid - firstGid).toBe(17);
    expect(local(5, 9).gid - firstGid).toBe(49);
    expect(local(9, 9).gid - firstGid).toBe(54);
    expect(result.tileData.terrain[7][7]).toBe(-1);
    expect(result.smartTerrain.cells['7,7']).toBeUndefined();
    expect(result.smartTerrain.suppressedDecorationSlots).not.toContain('7,9:top');

    const joined = applySmartCells(result, {
      cells: [{ x: 7, y: 4 }],
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    expect(joined.smartTerrain.cells['7,5']?.shapeGid).toBeUndefined();
    expect(joined.smartTerrain.cells['7,5']?.lockedGid).toBeUndefined();
  });

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

  it('paints a Water tunnel backdrop behind independent solid Ground', () => {
    const waterFirstGid = getTilesetByKey('water')!.firstGid;
    let result = applySmartCells(emptyDocument(), {
      cells: [{ x: 7, y: 7 }],
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const terrainBefore = result.tileData.terrain[7][7];
    result = applySmartCells(result, {
      cells: Array.from({ length: 9 }, (_, index) => ({ x: 6 + (index % 3), y: 6 + Math.floor(index / 3) })),
      mode: 'paint',
      theme: 'forest',
      material: 'tunnel',
    });

    expect(result.tileData.terrain[7][7]).toBe(terrainBefore);
    expect([27, 28, 39, 40]).toContain(
      decodeTileDataValue(result.tileData.background[7][7]).gid - waterFirstGid,
    );
    expect(result.smartTerrain.cells['7,7']?.material).toBe('ground');
    expect(result.smartTerrain.backdropCells['7,7']).toMatchObject({ theme: 'water', material: 'tunnel' });
  });

  it('uses Water rock edges and ties around a carved tunnel backdrop', () => {
    const waterFirstGid = getTilesetByKey('water')!.firstGid;
    let result = applySmartCells(emptyDocument(), {
      cells: Array.from({ length: 25 }, (_, index) => ({ x: 5 + (index % 5), y: 5 + Math.floor(index / 5) })),
      mode: 'paint',
      theme: 'gothic',
      material: 'tunnel',
    });
    result = applySmartCells(result, {
      cells: [{ x: 7, y: 7 }],
      mode: 'erase',
      theme: 'forest',
      material: 'tunnel',
    });
    const tile = (x: number, y: number) => decodeTileDataValue(result.tileData.background[y][x]);
    expect(tile(6, 6).gid - waterFirstGid).toBe(33);
    expect(tile(8, 6).gid - waterFirstGid).toBe(35);
    expect(tile(6, 8).gid - waterFirstGid).toBe(33);
    expect(tile(8, 8).gid - waterFirstGid).toBe(35);
    expect(tile(6, 6).flipY).toBe(true);
    expect(tile(8, 6).flipY).toBe(true);
    expect(tile(6, 8).flipY).toBe(false);
    expect(tile(8, 8).flipY).toBe(false);
    expect(tile(6, 7).gid - waterFirstGid).toBe(42);
    expect(tile(8, 7).gid - waterFirstGid).toBe(37);
    expect(result.tileData.background[7][7]).toBe(-1);
    expect(result.tileData.terrain[7][7]).toBe(-1);
  });

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

  it('uses the selected vertically flipped masonry tile for Gothic tunnel floors', () => {
    let result = applySmartCells(emptyDocument(), {
      cells: Array.from({ length: 25 }, (_, index) => ({ x: 5 + (index % 5), y: 5 + Math.floor(index / 5) })),
      mode: 'paint',
      theme: 'gothic',
      material: 'ground',
    });
    result = applySmartCells(result, {
      cells: [{ x: 7, y: 7 }],
      mode: 'erase',
      theme: 'gothic',
      material: 'ground',
    });

    const firstGid = getTilesetByKey('gothic')!.firstGid;
    const floor = decodeTileDataValue(result.tileData.terrain[8][7]);
    expect(floor.gid - firstGid).toBe(50);
    expect(floor.flipY).toBe(true);
  });

  it.each([
    { name: 'top-right', carved: [[10, 9], [11, 9], [11, 10]], localIndex: 54, flipY: true },
    { name: 'top-left', carved: [[10, 9], [9, 9], [9, 10]], localIndex: 49, flipY: true },
    { name: 'bottom-right', carved: [[11, 10], [11, 11], [10, 11]], localIndex: 54, flipY: false },
    { name: 'bottom-left', carved: [[9, 10], [9, 11], [10, 11]], localIndex: 49, flipY: false },
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

  it.each([
    { name: 'top-left', omitted: [9, 9], localIndex: 26, flipY: false },
    { name: 'top-right', omitted: [11, 9], localIndex: 29, flipY: false },
    { name: 'bottom-left', omitted: [9, 11], localIndex: 35, flipY: true },
    { name: 'bottom-right', omitted: [11, 11], localIndex: 33, flipY: true },
  ])('uses a surface tie at an ordinary exterior $name ground step', ({ omitted, localIndex, flipY }) => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const cells = [];
    for (let y = 9; y <= 11; y += 1) {
      for (let x = 9; x <= 11; x += 1) {
        if (x !== omitted[0] || y !== omitted[1]) cells.push({ x, y });
      }
    }
    const result = applySmartCells(emptyDocument(), {
      cells,
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const tie = decodeTileDataValue(result.tileData.terrain[10][10]);
    expect(tie.gid - firstGid).toBe(localIndex);
    expect(tie.flipY).toBe(flipY);
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

  it.each([
    { theme: 'forest', expected: [2, 3, 4, 5, 56, 58, 59] },
    { theme: 'desert', expected: [4, 5, 7, 8] },
    { theme: 'cave', expected: [2, 3, 4, 5, 6, 57, 61] },
    { theme: 'gothic', expected: [2, 3, 4, 5] },
  ] as const)('uses exactly the approved sparse $theme ground decorations', ({ theme, expected }) => {
    const firstGid = getTilesetByKey(theme)!.firstGid;
    const rows = [2, 5, 8, 11, 14, 17, 20];
    const result = applySmartCells(emptyDocument(), {
      cells: rows.flatMap((y) => Array.from({ length: 40 }, (_, x) => ({ x, y }))),
      mode: 'paint',
      theme,
      material: 'ground',
    });
    const variants = new Set(Object.values(result.smartTerrain.generatedDecorations)
      .map(({ gid }) => gid - firstGid));
    expect([...variants].sort((a, b) => a - b)).toEqual(expected);
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

  it('keeps a manual Behind Player override locked within a tunnel backdrop', () => {
    const waterFirstGid = getTilesetByKey('water')!.firstGid;
    const painted = applySmartCells(emptyDocument(), {
      cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'tunnel',
    });
    const locked = lockSmartTerrainCell(painted, 2, 3, waterFirstGid + 60, 'background');
    const extended = applySmartCells(locked, {
      cells: [{ x: 4, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'tunnel',
    });
    expect(extended.tileData.background[3][2]).toBe(waterFirstGid + 60);

    const unlocked = applySmartCells(extended, {
      cells: [{ x: 2, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'tunnel',
    });
    expect(unlocked.tileData.background[3][2]).not.toBe(waterFirstGid + 60);
    expect(unlocked.smartTerrain.backdropCells['2,3']?.lockedGid).toBeUndefined();
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
