import { describe, expect, it } from 'vitest';
import { createEmptyTileData } from '../persistence/roomModel';
import {
  AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
  getTerrainCollisionProfileForGid,
  getTilesetByKey,
} from '../config/tilesets';
import { decodeTileDataValue } from '../config/editorState';
import { createRoomSmartTerrainState } from './model';
import {
  applySmartCells,
  applySmartOutlineCells,
  fillEmptySmartTerrain,
  lockSmartTerrainCell,
  setSmartTerrainDetailsEnabled,
  SMART_TILESET_SLOTS,
  suppressGeneratedDecorationAt,
} from './solver';

function emptyDocument() {
  return {
    tileData: createEmptyTileData(),
    smartTerrain: createRoomSmartTerrainState(),
  };
}

function cellsFromPattern(pattern: readonly string[], originX = 4, originY = 4) {
  return pattern.flatMap((row, y) => [...row].flatMap((value, x) => (
    value === '#' ? [{ x: originX + x, y: originY + y }] : []
  )));
}

function decorationFixtureCells() {
  return Array.from({ length: 10 * 38 }, (_, index) => ({
    x: 1 + (index % 38),
    y: 2 + Math.floor(index / 38) * 2,
  }));
}

function localAt(
  document: ReturnType<typeof emptyDocument>,
  layer: 'background' | 'terrain' | 'foreground',
  x: number,
  y: number,
  firstGid: number,
) {
  return decodeTileDataValue(document.tileData[layer][y][x]).gid - firstGid;
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
    expect([14, 25]).toContain(local(5, 5).gid - firstGid);
    expect([17, 30]).toContain(local(9, 5).gid - firstGid);
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
      expect(Object.keys(first.smartTerrain.generatedDecorations).length)
        .toBeLessThanOrEqual(theme === 'desert' ? 2 : 1);
      for (const key of Object.keys(first.smartTerrain.cells)) {
        const [x, y] = key.split(',').map(Number);
        const gid = decodeTileDataValue(first.tileData.terrain[y][x]).gid;
        expect(getTerrainCollisionProfileForGid(gid).hasCollision).toBe(true);
      }
      for (const [key, decoration] of Object.entries(first.smartTerrain.generatedDecorations)) {
        const [x, y] = key.split(',').map(Number);
        expect(decoration.layer).toBe('terrain');
        expect(getTerrainCollisionProfileForGid(
          decodeTileDataValue(first.tileData.terrain[y][x]).gid,
        ).hasCollision).toBe(false);
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
    'uses the artist thin-region family for one-cell-high %s Ground',
    (theme) => {
      const firstGid = getTilesetByKey(theme)!.firstGid;
      const result = applySmartCells(emptyDocument(), {
        cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }],
        mode: 'paint',
        theme,
        material: 'ground',
      });
      const locals = result.tileData.terrain[3].slice(2, 5).map((gid) => gid - firstGid);
      expect(locals[0]).toBe(44);
      expect([20, 44, 45, 46]).toContain(locals[1]);
      expect(locals[2]).toBe(46);
    },
  );

  it('composites a right-jutting Desert ledge from B3-B6 plus E5 and C6 alpha pieces', () => {
    const desertFirstGid = getTilesetByKey('desert')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(['###...', '######', '###...'], 3, 4),
      mode: 'paint',
      theme: 'desert',
      material: 'ground',
    });

    expect([15, 16]).toContain(localAt(result, 'terrain', 6, 5, desertFirstGid));
    expect([15, 16]).toContain(localAt(result, 'terrain', 7, 5, desertFirstGid));
    expect(localAt(result, 'terrain', 8, 5, desertFirstGid)).toBe(17);
    expect(localAt(
      result,
      'foreground',
      5,
      5,
      AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
    )).toBe(2);
    for (let x = 6; x <= 8; x += 1) {
      expect(localAt(
        result,
        'foreground',
        x,
        5,
        AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
      )).toBe(0);
    }
  });

  it('mirrors the Desert seam treatment for a left-jutting ledge', () => {
    const desertFirstGid = getTilesetByKey('desert')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(['...###', '######', '...###'], 3, 4),
      mode: 'paint',
      theme: 'desert',
      material: 'ground',
    });

    expect(localAt(result, 'terrain', 3, 5, desertFirstGid)).toBe(14);
    expect([15, 16]).toContain(localAt(result, 'terrain', 4, 5, desertFirstGid));
    expect([15, 16]).toContain(localAt(result, 'terrain', 5, 5, desertFirstGid));
    expect(localAt(
      result,
      'foreground',
      6,
      5,
      AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
    )).toBe(1);
    for (let x = 3; x <= 5; x += 1) {
      expect(localAt(
        result,
        'foreground',
        x,
        5,
        AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
      )).toBe(0);
    }
  });

  it('keeps structural Desert ledge overlays when optional details are disabled', () => {
    const painted = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(['###...', '######', '###...'], 3, 4),
      mode: 'paint',
      theme: 'desert',
      material: 'ground',
    });
    const result = setSmartTerrainDetailsEnabled(painted, false);

    expect(result.smartTerrain.detailsEnabled).toBe(false);
    expect(localAt(
      result,
      'foreground',
      5,
      5,
      AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
    )).toBe(2);
    expect(localAt(
      result,
      'foreground',
      6,
      5,
      AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID,
    )).toBe(0);
  });

  it('clears Desert ledge overlays when the protrusion becomes thick', () => {
    const ledge = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(['###...', '######', '###...'], 3, 4),
      mode: 'paint',
      theme: 'desert',
      material: 'ground',
    });
    const thickened = applySmartCells(ledge, {
      cells: [{ x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }],
      mode: 'paint',
      theme: 'desert',
      material: 'ground',
    });

    expect(thickened.tileData.foreground[5].slice(5, 9)).toEqual([-1, -1, -1, -1]);
    expect(Object.values(thickened.smartTerrain.generatedDecorations)
      .some(({ gid }) => gid >= AUTOTILE_EDGE_CASES_DESERT_TILESET_FIRST_GID)).toBe(false);
  });

  it('emits exactly the corrected horizontal middle tile set without D12', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const emitted = new Set<number>();
    for (let y = 1; y < 21; y += 1) {
      const result = applySmartCells(emptyDocument(), {
        cells: Array.from({ length: 38 }, (_, index) => ({ x: index + 1, y })),
        mode: 'paint',
        theme: 'forest',
        material: 'ground',
      });
      for (let x = 2; x < 38; x += 1) {
        emitted.add(localAt(result, 'terrain', x, y, firstGid));
      }
    }
    expect(SMART_TILESET_SLOTS.ground.thin.horizontalMiddle).toEqual([20, 44, 45, 46]);
    expect([...emitted].sort((a, b) => a - b)).toEqual([20, 44, 45, 46]);
  });

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
      for (const [key, decoration] of Object.entries(result.smartTerrain.generatedDecorations)) {
        const [x, y] = key.split(',').map(Number);
        expect(decoration.layer).toBe('terrain');
        expect(getTerrainCollisionProfileForGid(
          decodeTileDataValue(result.tileData.terrain[y][x]).gid,
        ).hasCollision).toBe(false);
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
    const ceiling = result.tileData.terrain[6].slice(6, 9).map(local);
    expect(ceiling[0]).toBe(33);
    expect([50, 51, 52, 53]).toContain(ceiling[1]);
    expect(ceiling[2]).toBe(35);
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

  it('uses the authored caps and alternating middle family down a one-cell-wide vertical column', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: Array.from({ length: 6 }, (_, index) => ({ x: 7, y: 4 + index })),
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const locals = result.tileData.terrain.slice(4, 10)
      .map((row) => decodeTileDataValue(row[7]).gid - firstGid);
    expect(locals[0]).toBe(19);
    expect(locals.slice(1, -1).every((local) => local === 31 || local === 43)).toBe(true);
    expect(locals.at(-1)).toBe(55);
  });

  it.each([
    { name: 'orphan', pattern: ['#'], assertions: [[0, 0, [20]]] },
    {
      name: 'T intersection',
      pattern: ['#####', '..#..', '..#..'],
      assertions: [[0, 0, [44]], [2, 0, [19]], [4, 0, [46]], [2, 1, [31, 43]], [2, 2, [55]]],
    },
    {
      name: 'capital I',
      pattern: ['#####', '..#..', '..#..', '#####'],
      assertions: [[0, 0, [44]], [2, 0, [19]], [4, 0, [46]], [2, 1, [31, 43]], [0, 3, [44]], [4, 3, [46]]],
    },
    {
      name: 'empty square',
      pattern: ['###', '#.#', '###'],
      assertions: [[0, 0, [19]], [1, 0, [20, 44, 45, 46]], [2, 0, [19]], [0, 1, [31, 43]], [0, 2, [55]], [2, 2, [55]]],
    },
    {
      name: 'capital H',
      pattern: ['#.#', '###', '#.#'],
      assertions: [[0, 0, [19]], [2, 0, [19]], [0, 1, [31, 43]], [1, 1, [20, 44, 45, 46]], [2, 1, [31, 43]], [0, 2, [55]], [2, 2, [55]]],
    },
  ])('resolves the artist $name thin-region example', ({ pattern, assertions }) => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(pattern),
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    for (const [x, y, allowed] of assertions as Array<[number, number, number[]]>) {
      expect(allowed).toContain(localAt(result, 'terrain', 4 + x, 4 + y, firstGid));
    }
  });

  it('uses 40 for roughly 75% of thick interiors and rare 32 for roughly 5%', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(Array.from({ length: 22 }, () => '#'.repeat(40)), 0, 0),
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const counts = new Map<number, number>();
    for (let y = 1; y < 21; y += 1) {
      for (let x = 1; x < 39; x += 1) {
        const local = localAt(result, 'terrain', x, y, firstGid);
        counts.set(local, (counts.get(local) ?? 0) + 1);
      }
    }
    const total = 38 * 20;
    expect((counts.get(40) ?? 0) / total).toBeGreaterThan(0.70);
    expect((counts.get(40) ?? 0) / total).toBeLessThan(0.80);
    expect((counts.get(32) ?? 0) / total).toBeGreaterThan(0.025);
    expect((counts.get(32) ?? 0) / total).toBeLessThan(0.075);
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([27, 28, 32, 38, 39, 40, 41]);
  });

  it('uses both artist-approved top-corner alternates across thick regions', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const cells = [];
    const corners: Array<{ x: number; y: number }> = [];
    for (let y = 1; y <= 17; y += 4) {
      for (let x = 1; x <= 37; x += 4) {
        corners.push({ x, y });
        cells.push({ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 });
      }
    }
    const result = applySmartCells(emptyDocument(), {
      cells,
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const leftVariants = new Set(corners.map(({ x, y }) => localAt(result, 'terrain', x, y, firstGid)));
    const rightVariants = new Set(corners.map(({ x, y }) => localAt(result, 'terrain', x + 1, y, firstGid)));
    expect([...leftVariants].sort((a, b) => a - b)).toEqual([14, 25]);
    expect([...rightVariants].sort((a, b) => a - b)).toEqual([17, 30]);
  });

  it('adds feature corner detail only to a real inside corner and lets it stay erased', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }],
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    const insideCorner = decodeTileDataValue(result.tileData.terrain[5][4]);
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
    expect(regenerated.tileData.terrain[5][4]).toBe(-1);
  });

  it('layers a corner and straight feature edge when a notch has three feature neighbors', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: [{ x: 5, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 6 }],
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    const front = decodeTileDataValue(result.tileData.terrain[5][5]);
    const behind = decodeTileDataValue(result.tileData.background[5][5]);
    expect(front.gid - firstGid).toBe(22);
    expect(behind.gid - firstGid).toBe(0);
    expect(result.smartTerrain.generatedDecorations['5,5']).toBeDefined();
    expect(result.smartTerrain.generatedBackgroundDecorations['5,5']).toBeDefined();

    const frontErased = suppressGeneratedDecorationAt(result, 5, 5);
    expect(frontErased.tileData.terrain[5][5]).toBe(-1);
    expect(frontErased.tileData.background[5][5]).not.toBe(-1);
    const bothErased = suppressGeneratedDecorationAt(frontErased, 5, 5);
    expect(bothErased.tileData.background[5][5]).toBe(-1);
  });

  it('fills every cell of a long horizontal Feature Block gap with the artist edge pairs', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(['#####', '#...#', '#####']),
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    expect([1, 2, 3].map((dx) => localAt(result, 'terrain', 4 + dx, 5, firstGid)))
      .toEqual([22, 0, 10]);
    expect([1, 2, 3].map((dx) => localAt(result, 'background', 4 + dx, 5, firstGid)))
      .toEqual([0, 24, 24]);
  });

  it('fills every cell of a long vertical Feature Block gap with the artist edge pairs', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(['###', '#.#', '#.#', '#.#', '###']),
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    expect([1, 2, 3].map((dy) => localAt(result, 'terrain', 5, 4 + dy, firstGid)))
      .toEqual([22, 1, 10]);
    expect([1, 2, 3].map((dy) => localAt(result, 'background', 5, 4 + dy, firstGid)))
      .toEqual([1, 13, 13]);
  });

  it('fills a one-cell Feature Block hole with overlapping 10 and 22', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: cellsFromPattern(['###', '#.#', '###']),
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    expect(localAt(result, 'terrain', 5, 5, firstGid)).toBe(10);
    expect(localAt(result, 'background', 5, 5, firstGid)).toBe(22);
  });

  it('bumps the second Feature Block edge to Front when Behind is already occupied', () => {
    const firstGid = getTilesetByKey('forest')!.firstGid;
    const document = emptyDocument();
    document.tileData.background[5][5] = 999;
    const result = applySmartCells(document, {
      cells: cellsFromPattern(['###', '#.#', '###']),
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    expect(result.tileData.background[5][5]).toBe(999);
    expect(localAt(result, 'terrain', 5, 5, firstGid)).toBe(10);
    expect(localAt(result, 'foreground', 5, 5, firstGid)).toBe(22);
    expect(result.smartTerrain.generatedBackgroundDecorations['5,5']?.layer).toBe('foreground');
  });

  it.each([
    ['forest', [2, 3, 4, 5, 56, 58, 59]],
    ['cave', [3, 4, 5, 6, 57, 61]],
  ] as const)('uses the artist-approved sparse %s decoration pool', (theme, expectedLocals) => {
    const firstGid = getTilesetByKey(theme)!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: decorationFixtureCells(),
      mode: 'paint',
      theme,
      material: 'ground',
    });
    const variants = new Set(Object.values(result.smartTerrain.generatedDecorations)
      .map(({ gid }) => gid - firstGid));
    expect([...variants].sort((a, b) => a - b)).toEqual(expectedLocals);
    expect(Object.values(result.smartTerrain.generatedDecorations)
      .every(({ layer }) => layer === 'terrain')).toBe(true);
    expect(result.tileData.foreground.every((row) => row.every((gid) => gid === -1))).toBe(true);
  });

  it('always emits Desert A8 and A9 together as a left-to-right pair', () => {
    const firstGid = getTilesetByKey('desert')!.firstGid;
    const result = applySmartCells(emptyDocument(), {
      cells: decorationFixtureCells(),
      mode: 'paint',
      theme: 'desert',
      material: 'ground',
    });
    const decorations = Object.fromEntries(Object.entries(result.smartTerrain.generatedDecorations)
      .map(([key, { gid }]) => [key, gid - firstGid]));
    const variants = new Set(Object.values(decorations));

    expect([...variants].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 7, 8]);
    for (const [key, local] of Object.entries(decorations)) {
      const [x, y] = key.split(',').map(Number);
      if (local === 7) expect(decorations[`${x + 1},${y}`]).toBe(8);
      if (local === 8) expect(decorations[`${x - 1},${y}`]).toBe(7);
    }
  });

  it.each([7, 8] as const)(
    'suppresses both halves when Desert local %s is removed from a decoration pair',
    (removedLocal) => {
      const firstGid = getTilesetByKey('desert')!.firstGid;
      const painted = applySmartCells(emptyDocument(), {
        cells: decorationFixtureCells(),
        mode: 'paint',
        theme: 'desert',
        material: 'ground',
      });
      const pairLeft = Object.entries(painted.smartTerrain.generatedDecorations)
        .find(([, { gid }]) => gid - firstGid === 7);
      expect(pairLeft).toBeDefined();
      const [leftKey] = pairLeft!;
      const [leftX, y] = leftKey.split(',').map(Number);
      const removedX = removedLocal === 7 ? leftX : leftX + 1;
      const suppressed = suppressGeneratedDecorationAt(painted, removedX, y, 'terrain');

      expect(suppressed.smartTerrain.generatedDecorations[leftKey]).toBeUndefined();
      expect(suppressed.smartTerrain.generatedDecorations[`${leftX + 1},${y}`]).toBeUndefined();
      expect(suppressed.tileData.terrain[y][leftX]).toBe(-1);
      expect(suppressed.tileData.terrain[y][leftX + 1]).toBe(-1);
    },
  );

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

  it('connects Ground to compatible legacy thin terrain without rewriting it', () => {
    const document = emptyDocument();
    const legacyGid = getTilesetByKey('forest')!.firstGid + 44;
    document.tileData.terrain[4][2] = legacyGid;
    const result = applySmartCells(document, {
      cells: [{ x: 3, y: 4 }],
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    expect(result.tileData.terrain[4][2]).toBe(legacyGid);
    expect(result.smartTerrain.cells['2,4']).toBeUndefined();
  });

  it('normalizes old Platform brush writes into Ground semantics', () => {
    const result = applySmartCells(emptyDocument(), {
      cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }],
      mode: 'paint',
      theme: 'forest',
      material: 'platform',
    });
    expect(result.smartTerrain.cells['2,3']?.material).toBe('ground');
    expect(result.smartTerrain.cells['3,3']?.material).toBe('ground');
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
