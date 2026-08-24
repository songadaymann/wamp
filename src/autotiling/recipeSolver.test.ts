import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  TILE_FLIP_X_FLAG,
  TILE_FLIP_Y_FLAG,
  type LayerName,
} from '../config/room';
import { decodeTileDataValue } from '../config/editorState';
import { getTerrainCollisionProfileForGid } from '../config/tilesets';
import { createEmptyTileData } from '../persistence/roomModel';
import {
  cloneRoomSmartTerrainState,
  createRoomSmartTerrainState,
  normalizeRoomSmartTerrainState,
  smartOwnedOutputKey,
  smartOwnedOutputPartKey,
  smartSemanticCellKey,
  type SmartBrushId,
  type SmartCellCoordinate,
} from './model';
import {
  applyManualSmartOutputEdit,
  applySmartBrushCells,
  applySmartBrushOutlineCells,
  lockSmartSemanticCell,
  resolveSmartRecipeDocument,
  type SmartRecipeDocument,
} from './recipeSolver';
import { getSmartStyleDefinition } from './registry';
import { isCyberEmitterLocalIndex, type CyberStyleId } from './cyberProfile';

interface CyberReferenceFixture {
  provenance: { roomVersion: number; snapshotSha256: string };
  snapshot: { tileData: Record<LayerName, number[][]> };
}

const CYBER_REFERENCE = JSON.parse(readFileSync(resolve(
  process.cwd(),
  'test/fixtures/smart-autotiling/references/cyber-x-10-y10.room.json',
), 'utf8')) as CyberReferenceFixture;

function emptyDocument(detailsEnabled = false): SmartRecipeDocument {
  const smartTerrain = createRoomSmartTerrainState();
  smartTerrain.detailsEnabled = detailsEnabled;
  return { tileData: createEmptyTileData(), smartTerrain };
}

function rectangle(x: number, y: number, width: number, height: number): SmartCellCoordinate[] {
  return Array.from({ length: width * height }, (_, index) => ({
    x: x + (index % width),
    y: y + Math.floor(index / width),
  }));
}

function horizontal(x: number, y: number, length: number): SmartCellCoordinate[] {
  return Array.from({ length }, (_, index) => ({ x: x + index, y }));
}

function vertical(x: number, y: number, length: number): SmartCellCoordinate[] {
  return Array.from({ length }, (_, index) => ({ x, y: y + index }));
}

function paint(
  document: SmartRecipeDocument,
  brushId: SmartBrushId,
  styleId: CyberStyleId,
  cells: Iterable<SmartCellCoordinate>,
): SmartRecipeDocument {
  return applySmartBrushCells(document, { brushId, styleId, cells, mode: 'paint' });
}

function erase(
  document: SmartRecipeDocument,
  brushId: SmartBrushId,
  styleId: CyberStyleId,
  cells: Iterable<SmartCellCoordinate>,
): SmartRecipeDocument {
  return applySmartBrushCells(document, { brushId, styleId, cells, mode: 'erase' });
}

function tileToken(value: number, styleId: CyberStyleId): string {
  if (value <= 0) return '.';
  const decoded = decodeTileDataValue(value);
  const localIndex = decoded.gid - getSmartStyleDefinition(styleId).firstGid;
  return `${localIndex}${decoded.flipX ? 'X' : ''}${decoded.flipY ? 'Y' : ''}`;
}

function rowTokens(
  document: SmartRecipeDocument,
  layer: LayerName,
  styleId: CyberStyleId,
  x: number,
  y: number,
  width: number,
): string[] {
  return document.tileData[layer][y]!.slice(x, x + width).map((value) => tileToken(value, styleId));
}

function referenceRowTokens(layer: LayerName, x: number, y: number, width: number): string[] {
  return CYBER_REFERENCE.snapshot.tileData[layer][y]!.slice(x, x + width).map((value) => {
    const decoded = decodeTileDataValue(value);
    const yellow = getSmartStyleDefinition('cyber-yellow');
    const pink = getSmartStyleDefinition('cyber-pink');
    const localIndex = decoded.gid >= pink.firstGid
      ? decoded.gid - pink.firstGid
      : decoded.gid - yellow.firstGid;
    return `${localIndex}${decoded.flipX ? 'X' : ''}${decoded.flipY ? 'Y' : ''}`;
  });
}

function localIndexAt(
  document: SmartRecipeDocument,
  layer: LayerName,
  styleId: CyberStyleId,
  x: number,
  y: number,
): number {
  const value = document.tileData[layer][y]?.[x] ?? -1;
  if (value <= 0) return -1;
  return decodeTileDataValue(value).gid - getSmartStyleDefinition(styleId).firstGid;
}

function cloneTileData(document: SmartRecipeDocument): SmartRecipeDocument['tileData'] {
  return {
    background: document.tileData.background.map((row) => [...row]),
    terrain: document.tileData.terrain.map((row) => [...row]),
    foreground: document.tileData.foreground.map((row) => [...row]),
  };
}

function expectCollision(document: SmartRecipeDocument, x: number, y: number): void {
  const value = document.tileData.terrain[y]?.[x] ?? -1;
  expect(value).toBeGreaterThan(0);
  expect(getTerrainCollisionProfileForGid(decodeTileDataValue(value).gid).hasCollision).toBe(true);
}

describe('Cyber Smart recipe solver', () => {
  it('resolves all six brushes with their exact layer and collision contracts', () => {
    let document = paint(
      emptyDocument(),
      'cyber.structure',
      'cyber-yellow',
      rectangle(2, 2, 2, 2),
    );
    document = paint(document, 'cyber.platform', 'cyber-pink', horizontal(6, 6, 5));
    document = paint(document, 'cyber.rubble', 'cyber-yellow', rectangle(12, 8, 3, 2));
    document = paint(document, 'cyber.support', 'cyber-pink', vertical(16, 2, 4));
    document = paint(document, 'cyber.neon-strip', 'cyber-yellow', horizontal(19, 9, 3));
    document = paint(document, 'cyber.framed-panel', 'cyber-pink', horizontal(24, 3, 5));

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 2, 2)).toEqual(['25', '30']);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 3, 2)).toEqual(['61', '61X']);
    expect(rowTokens(document, 'terrain', 'cyber-pink', 6, 6, 5)).toEqual([
      '71X', '69', '70', '68', '71',
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 12, 8, 3)).toEqual(['12', '12', '12']);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 12, 9, 3)).toEqual(['12', '12', '12']);
    expect(vertical(16, 2, 4).map(({ x, y }) => (
      tileToken(document.tileData.background[y]![x]!, 'cyber-pink')
    ))).toEqual(['36', '48', '60', '72']);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 19, 9, 3)).toEqual(['49', '50', '51']);
    expect(rowTokens(document, 'foreground', 'cyber-pink', 24, 3, 5)).toEqual([
      '44', '45', '45', '45', '46',
    ]);
    expect(rowTokens(document, 'foreground', 'cyber-pink', 24, 4, 5)).toEqual([
      '56', '57', '57', '57', '58',
    ]);

    for (const { x, y } of [
      ...rectangle(2, 2, 2, 2),
      ...horizontal(6, 6, 5),
      ...rectangle(12, 8, 3, 2),
      ...horizontal(19, 9, 3),
    ]) {
      expectCollision(document, x, y);
    }
    for (const { x, y } of vertical(16, 2, 4)) {
      expect(document.tileData.terrain[y]![x]).toBe(-1);
      expect(document.tileData.foreground[y]![x]).toBe(-1);
    }
    for (const { x, y } of rectangle(24, 3, 5, 2)) {
      const value = document.tileData.foreground[y]![x]!;
      expect(document.tileData.terrain[y]![x]).toBe(-1);
      expect(getTerrainCollisionProfileForGid(decodeTileDataValue(value).gid).hasCollision).toBe(false);
    }
  });

  it('persists Platform, Support, and Neon spans as explicit stable recipe owners', () => {
    let document = paint(
      emptyDocument(),
      'cyber.platform',
      'cyber-yellow',
      horizontal(3, 4, 4),
    );
    document = paint(document, 'cyber.support', 'cyber-pink', rectangle(10, 2, 2, 4));
    document = paint(document, 'cyber.neon-strip', 'cyber-yellow', horizontal(18, 8, 3));

    const recipes = Object.values(document.smartTerrain.recipes);
    expect(recipes).toHaveLength(3);
    expect(recipes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recipeId: 'cyber.platform',
        brushId: 'cyber.platform',
        styleId: 'cyber-yellow',
        ownerId: 'cyber:recipe:cyber-platform-1',
        anchor: { layer: 'terrain', x: 3, y: 4 },
        bounds: { minX: 3, minY: 4, maxX: 6, maxY: 4, width: 4, height: 1 },
        sourceCells: horizontal(3, 4, 4).map(({ x, y }) => ({ layer: 'terrain', x, y })),
      }),
      expect.objectContaining({
        recipeId: 'cyber.support',
        brushId: 'cyber.support',
        styleId: 'cyber-pink',
        ownerId: 'cyber:recipe:cyber-support-1',
        anchor: { layer: 'background', x: 10, y: 2 },
        bounds: { minX: 10, minY: 2, maxX: 11, maxY: 5, width: 2, height: 4 },
        sourceCells: rectangle(10, 2, 2, 4).map(({ x, y }) => ({ layer: 'background', x, y })),
      }),
      expect.objectContaining({
        recipeId: 'cyber.neon-strip',
        brushId: 'cyber.neon-strip',
        styleId: 'cyber-yellow',
        ownerId: 'cyber:recipe:cyber-neon-strip-1',
        anchor: { layer: 'terrain', x: 18, y: 8 },
        bounds: { minX: 18, minY: 8, maxX: 20, maxY: 8, width: 3, height: 1 },
        sourceCells: horizontal(18, 8, 3).map(({ x, y }) => ({ layer: 'terrain', x, y })),
      }),
    ]));
    expect(Object.values(document.smartTerrain.semanticCells).some(({ brushId }) => (
      brushId === 'cyber.platform' || brushId === 'cyber.support' || brushId === 'cyber.neon-strip'
    ))).toBe(false);

    const outputsByOwner = new Map<string, number>();
    for (const output of Object.values(document.smartTerrain.ownedOutputs)) {
      if (!output.ownerId.includes('cyber-platform')
        && !output.ownerId.includes('cyber-support')
        && !output.ownerId.includes('cyber-neon-strip')) continue;
      expect(output).toMatchObject({ kind: 'recipe' });
      expect(output.value).toBeGreaterThan(0);
      outputsByOwner.set(output.ownerId, (outputsByOwner.get(output.ownerId) ?? 0) + 1);
    }
    expect(Object.fromEntries(outputsByOwner)).toEqual({
      'cyber:recipe:cyber-platform-1': 4,
      'cyber:recipe:cyber-support-1': 8,
      'cyber:recipe:cyber-neon-strip-1': 3,
    });
    for (const [key, output] of Object.entries(document.smartTerrain.ownedOutputs)) {
      if (output.kind !== 'recipe') continue;
      const [, coordinate] = key.split(':');
      const [x, y] = coordinate!.split(',').map(Number);
      expect(document.tileData[output.layer][y]![x]).toBe(output.value);
    }
  });

  it('keeps span owner IDs stable across repaint and extension, then repairs split and merge owners', () => {
    let document = paint(
      emptyDocument(),
      'cyber.platform',
      'cyber-yellow',
      horizontal(4, 5, 4),
    );
    const originalId = Object.keys(document.smartTerrain.recipes)[0]!;
    const originalOwner = document.smartTerrain.recipes[originalId]!.ownerId;

    const manuallyEdited = cloneTileData(document);
    manuallyEdited.terrain[5]![5] = -1;
    document = resolveSmartRecipeDocument({
      tileData: manuallyEdited,
      smartTerrain: applyManualSmartOutputEdit(document.smartTerrain, 'terrain', 5, 5, -1),
    });
    expect(document.smartTerrain.suppressedOutputParts).toContain(
      smartOwnedOutputPartKey(originalOwner, 'row-0:column-1'),
    );

    document = paint(document, 'cyber.platform', 'cyber-yellow', [{ x: 5, y: 5 }]);
    expect(Object.keys(document.smartTerrain.recipes)).toEqual([originalId]);
    expect(document.smartTerrain.suppressedOutputParts).not.toContain(
      smartOwnedOutputPartKey(originalOwner, 'row-0:column-1'),
    );
    expect(document.tileData.terrain[5]![5]).toBeGreaterThan(0);

    document = paint(document, 'cyber.platform', 'cyber-yellow', [{ x: 8, y: 5 }]);
    expect(Object.keys(document.smartTerrain.recipes)).toEqual([originalId]);
    expect(document.smartTerrain.recipes[originalId]).toMatchObject({
      ownerId: originalOwner,
      anchor: { layer: 'terrain', x: 4, y: 5 },
      bounds: { minX: 4, minY: 5, maxX: 8, maxY: 5, width: 5, height: 1 },
    });

    document = erase(document, 'cyber.platform', 'cyber-yellow', [{ x: 6, y: 5 }]);
    const splitIds = Object.keys(document.smartTerrain.recipes);
    expect(splitIds).toHaveLength(2);
    expect(splitIds).toContain(originalId);
    const splitId = splitIds.find((instanceId) => instanceId !== originalId)!;
    expect(document.smartTerrain.recipes[originalId]!.sourceCells).toEqual(
      horizontal(4, 5, 2).map(({ x, y }) => ({ layer: 'terrain', x, y })),
    );
    expect(document.smartTerrain.recipes[splitId]!.sourceCells).toEqual(
      horizontal(7, 5, 2).map(({ x, y }) => ({ layer: 'terrain', x, y })),
    );
    expect(document.smartTerrain.suppressedOutputParts.filter((entry) => (
      entry.startsWith('cyber:recipe:')
    ))).toEqual([]);

    document = paint(document, 'cyber.platform', 'cyber-yellow', [{ x: 6, y: 5 }]);
    expect(Object.keys(document.smartTerrain.recipes)).toEqual([originalId]);
    expect(Object.values(document.smartTerrain.ownedOutputs)
      .filter(({ kind }) => kind === 'recipe')
      .every(({ ownerId }) => ownerId === originalOwner)).toBe(true);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 4, 5, 5)).not.toContain('.');
  });

  it('keeps Platform middle phase anchored when additional legacy tiles extend its left edge', () => {
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    const withLegacy = (count: number): SmartRecipeDocument => {
      const tileData = createEmptyTileData();
      for (let x = 4 - count; x < 4; x += 1) {
        tileData.terrain[6]![x] = firstGid + 69;
      }
      return paint(
        { tileData, smartTerrain: createRoomSmartTerrainState() },
        'cyber.platform',
        'cyber-yellow',
        horizontal(4, 6, 5),
      );
    };

    const oneLegacy = withLegacy(1);
    const threeLegacy = withLegacy(3);
    expect(rowTokens(oneLegacy, 'terrain', 'cyber-yellow', 4, 6, 5)).toEqual(
      rowTokens(threeLegacy, 'terrain', 'cyber-yellow', 4, 6, 5),
    );
    expect(Object.values(threeLegacy.smartTerrain.recipes)[0]).toMatchObject({
      anchor: { layer: 'terrain', x: 4, y: 6 },
      bounds: { minX: 4, minY: 6, maxX: 8, maxY: 6, width: 5, height: 1 },
    });
  });

  it('matches the v13 tower geometry, local indices, and transforms at world x32..39 and y2..17', () => {
    const document = paint(
      emptyDocument(),
      'cyber.structure',
      'cyber-yellow',
      rectangle(32, 2, 8, 16),
    );
    expect(CYBER_REFERENCE.provenance).toMatchObject({
      roomVersion: 13,
      snapshotSha256: '84add9b8e02afe00736ff59f54b07b9ca61237b8866e0815e3a2b978224a41ec',
    });
    const expected = Array.from({ length: 16 }, (_, row) => (
      referenceRowTokens('terrain', 32, 2 + row, 8)
    ));
    expect(Array.from({ length: 16 }, (_, row) => (
      rowTokens(document, 'terrain', 'cyber-yellow', 32, 2 + row, 8)
    ))).toEqual(expected);
  });

  it('keeps topology-owned facade art on inset edges of an irregular silhouette', () => {
    const cells = [
      ...horizontal(4, 4, 4),
      ...horizontal(5, 5, 2),
      ...horizontal(4, 6, 4),
    ];
    const document = paint(emptyDocument(), 'cyber.structure', 'cyber-yellow', cells);

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 5, 5, 2)).toEqual(['37', '37X']);
  });

  it('frames a filled Structure staircase with colliding diagonal step art', () => {
    const staircase = [
      ...horizontal(2, 2, 2),
      ...horizontal(2, 3, 3),
      ...horizontal(2, 4, 4),
    ];
    const document = paint(emptyDocument(), 'cyber.structure', 'cyber-yellow', staircase);

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 2, 4)).toEqual([
      '25', '30', '.', '.',
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 3, 4)).toEqual([
      '37', '29', '30', '.',
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 4, 4)).toEqual([
      '61', '15Y', '29', '30',
    ]);
    staircase.forEach(({ x, y }) => expectCollision(document, x, y));
  });

  it('uses the audited Yellow/Pink platform fixtures and never joins styles', () => {
    let document = paint(
      emptyDocument(),
      'cyber.platform',
      'cyber-yellow',
      horizontal(2, 3, 5),
    );
    document = paint(document, 'cyber.platform', 'cyber-pink', horizontal(7, 3, 5));

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 3, 5)).toEqual([
      ...referenceRowTokens('terrain', 24, 5, 5),
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-pink', 7, 3, 5)).toEqual([
      ...referenceRowTokens('terrain', 19, 2, 5),
    ]);

    let structures = paint(
      emptyDocument(),
      'cyber.structure',
      'cyber-yellow',
      [{ x: 18, y: 4 }],
    );
    structures = paint(structures, 'cyber.structure', 'cyber-pink', [{ x: 19, y: 4 }]);
    expect(localIndexAt(structures, 'terrain', 'cyber-yellow', 18, 4)).toBe(23);
    expect(localIndexAt(structures, 'terrain', 'cyber-pink', 19, 4)).toBe(23);
  });

  it('keeps adjacent framed panels separate by style', () => {
    let document = paint(
      emptyDocument(),
      'cyber.framed-panel',
      'cyber-yellow',
      horizontal(3, 5, 3),
    );
    document = paint(document, 'cyber.framed-panel', 'cyber-pink', horizontal(6, 5, 3));

    expect(Object.keys(document.smartTerrain.recipes)).toHaveLength(2);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 3, 5, 3)).toEqual(['44', '45', '46']);
    expect(rowTokens(document, 'foreground', 'cyber-pink', 6, 5, 3)).toEqual(['44', '45', '46']);
    expect(localIndexAt(document, 'foreground', 'cyber-yellow', 5, 5)).toBe(46);
    expect(localIndexAt(document, 'foreground', 'cyber-pink', 6, 5)).toBe(44);
  });

  it('uses diagonal-aware concaves around a painted hole', () => {
    const ring = rectangle(10, 10, 3, 3).filter(({ x, y }) => !(x === 11 && y === 11));
    const document = paint(emptyDocument(), 'cyber.structure', 'cyber-yellow', ring);

    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 10, 10)).toBe(41);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 12, 10)).toBe(38);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 10, 12)).toBe(29);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 12, 12)).toBe(26);
    expect(document.tileData.terrain[11]![11]).toBe(-1);
  });

  it('treats only same-style legacy tiles as compatible neighbors', () => {
    const yellow = getSmartStyleDefinition('cyber-yellow');
    const pink = getSmartStyleDefinition('cyber-pink');
    const tileData = createEmptyTileData();
    const legacyLeft = yellow.firstGid + 71 + TILE_FLIP_X_FLAG;
    const legacyRight = yellow.firstGid + 71;
    tileData.terrain[4]![4] = legacyLeft;
    tileData.terrain[4]![6] = legacyRight;
    let document = paint(
      { tileData, smartTerrain: createRoomSmartTerrainState() },
      'cyber.platform',
      'cyber-yellow',
      [{ x: 5, y: 4 }],
    );
    expect(document.tileData.terrain[4]![4]).toBe(legacyLeft);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 5, 4)).toBe(68);
    expect(document.tileData.terrain[4]![6]).toBe(legacyRight);

    const mismatched = createEmptyTileData();
    mismatched.terrain[7]![8] = pink.firstGid + 71 + TILE_FLIP_X_FLAG;
    mismatched.terrain[7]![10] = pink.firstGid + 71;
    document = paint(
      { tileData: mismatched, smartTerrain: createRoomSmartTerrainState() },
      'cyber.platform',
      'cyber-yellow',
      [{ x: 9, y: 7 }],
    );
    expect(document.tileData.terrain[7]![9]).toBe(-1);

    const structureData = createEmptyTileData();
    for (const [dx, dy] of [
      [0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ]) {
      structureData.terrain[12 + dy]![20 + dx] = yellow.firstGid + 38;
    }
    document = paint(
      { tileData: structureData, smartTerrain: createRoomSmartTerrainState() },
      'cyber.structure',
      'cyber-yellow',
      [{ x: 20, y: 12 }],
    );
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 20, 12)).toBe(29);
  });

  it('preserves full X, Y, and XY locked values through neighboring re-resolution', () => {
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    let document = paint(
      emptyDocument(),
      'cyber.structure',
      'cyber-yellow',
      rectangle(4, 4, 3, 2),
    );
    const locked = [
      firstGid + 64 + TILE_FLIP_X_FLAG,
      firstGid + 31 + TILE_FLIP_Y_FLAG,
      firstGid + 83 + TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG,
    ];
    document = lockSmartSemanticCell(document, 4, 4, locked[0]!, 'terrain');
    document = lockSmartSemanticCell(document, 5, 4, locked[1]!, 'terrain');
    document = lockSmartSemanticCell(document, 6, 4, locked[2]!, 'terrain');
    const neighboringCells = rectangle(3, 3, 5, 4).filter(({ x, y }) => (
      !(x >= 4 && x <= 6 && y >= 4 && y <= 5)
    ));
    document = paint(document, 'cyber.structure', 'cyber-yellow', neighboringCells);
    document = resolveSmartRecipeDocument(document);

    expect(document.tileData.terrain[4]!.slice(4, 7)).toEqual(locked);
    expect(document.smartTerrain.semanticCells['terrain:4,4']?.lockedValue).toBe(locked[0]);
    expect(document.smartTerrain.semanticCells['terrain:5,4']?.lockedValue).toBe(locked[1]);
    expect(document.smartTerrain.semanticCells['terrain:6,4']?.lockedValue).toBe(locked[2]);
    expect(decodeTileDataValue(locked[0]!)).toMatchObject({ flipX: true, flipY: false });
    expect(decodeTileDataValue(locked[1]!)).toMatchObject({ flipX: false, flipY: true });
    expect(decodeTileDataValue(locked[2]!)).toMatchObject({ flipX: true, flipY: true });
  });

  it('clears diagonal outline locks when a Structure hole is carved and repaired', () => {
    const filledCells = rectangle(10, 10, 3, 3);
    const outlineCells = filledCells.filter(({ x, y }) => !(x === 11 && y === 11));
    let document = applySmartBrushOutlineCells(emptyDocument(), {
      brushId: 'cyber.structure',
      styleId: 'cyber-yellow',
      filledCells,
      outlineCells,
    });
    const corners = [
      { x: 10, y: 10 }, { x: 12, y: 10 },
      { x: 10, y: 12 }, { x: 12, y: 12 },
    ];
    expect(corners.every(({ x, y }) => (
      document.smartTerrain.semanticCells[smartSemanticCellKey('terrain', x, y)]?.shapeValue !== undefined
    ))).toBe(true);

    document = erase(
      document,
      'cyber.structure',
      'cyber-yellow',
      [{ x: 11, y: 11 }],
    );
    expect(corners.map(({ x, y }) => localIndexAt(
      document, 'terrain', 'cyber-yellow', x, y,
    ))).toEqual([41, 38, 29, 26]);
    expect(corners.every(({ x, y }) => (
      document.smartTerrain.semanticCells[smartSemanticCellKey('terrain', x, y)]?.shapeValue === undefined
    ))).toBe(true);

    document = paint(
      document,
      'cyber.structure',
      'cyber-yellow',
      [{ x: 11, y: 11 }],
    );
    expect(corners.map(({ x, y }) => localIndexAt(
      document, 'terrain', 'cyber-yellow', x, y,
    ))).toEqual([25, 30, 61, 61]);
    expect(decodeTileDataValue(document.tileData.terrain[12]![12]!)).toMatchObject({ flipX: true });
  });

  it('uses the v13 support-pair transform vocabulary and re-normalizes after repair', () => {
    expect(referenceRowTokens('background', 33, 18, 2)).toEqual(['36', '36X']);
    expect(referenceRowTokens('background', 33, 19, 2)).toEqual(['60', '60X']);
    expect(referenceRowTokens('background', 33, 20, 2)).toEqual(['72', '72X']);
    expect(referenceRowTokens('background', 37, 18, 2)).toEqual(['36X', '36']);
    expect(referenceRowTokens('background', 37, 19, 2)).toEqual(['60', '60X']);
    expect(referenceRowTokens('background', 37, 20, 2)).toEqual(['72', '72X']);

    let document = paint(
      emptyDocument(),
      'cyber.support',
      'cyber-yellow',
      rectangle(10, 3, 4, 3),
    );
    const supportId = Object.keys(document.smartTerrain.recipes)[0]!;
    expect(rowTokens(document, 'background', 'cyber-yellow', 10, 3, 4)).toEqual([
      '36', '36X', '36X', '36',
    ]);
    expect(rowTokens(document, 'background', 'cyber-yellow', 10, 4, 4)).toEqual([
      '60', '60X', '60', '60X',
    ]);
    expect(rowTokens(document, 'background', 'cyber-yellow', 10, 5, 4)).toEqual([
      '72', '72X', '72', '72X',
    ]);

    document = erase(
      document,
      'cyber.support',
      'cyber-yellow',
      vertical(10, 3, 3),
    );
    expect(Object.keys(document.smartTerrain.recipes)).toEqual([supportId]);
    expect(document.smartTerrain.recipes[supportId]).toMatchObject({
      ownerId: `cyber:recipe:${supportId}`,
      anchor: { layer: 'background', x: 11, y: 3 },
      bounds: { minX: 11, minY: 3, maxX: 13, maxY: 5, width: 3, height: 3 },
    });
    expect(rowTokens(document, 'background', 'cyber-yellow', 11, 3, 3)).toEqual([
      '36', '36X', '36X',
    ]);
    expect(rowTokens(document, 'background', 'cyber-yellow', 11, 4, 3)).toEqual([
      '60', '60X', '60',
    ]);
    expect(rowTokens(document, 'background', 'cyber-yellow', 11, 5, 3)).toEqual([
      '72', '72X', '72',
    ]);

    const isolated = paint(
      emptyDocument(),
      'cyber.support',
      'cyber-pink',
      vertical(20, 2, 4),
    );
    expect(vertical(20, 2, 4).map(({ x, y }) => (
      tileToken(isolated.tileData.background[y]![x]!, 'cyber-pink')
    ))).toEqual(['36', '48', '60', '72']);
  });

  it('keeps spans invisible until their minimum width becomes valid', () => {
    let platform = paint(
      emptyDocument(),
      'cyber.platform',
      'cyber-yellow',
      [{ x: 2, y: 2 }],
    );
    expect(platform.tileData.terrain[2]![2]).toBe(-1);
    expect(Object.values(platform.smartTerrain.recipes)).toContainEqual(expect.objectContaining({
      brushId: 'cyber.platform',
      sourceCells: [{ layer: 'terrain', x: 2, y: 2 }],
    }));
    platform = paint(platform, 'cyber.platform', 'cyber-yellow', [{ x: 3, y: 2 }]);
    expect(rowTokens(platform, 'terrain', 'cyber-yellow', 2, 2, 2)).toEqual(['71X', '71']);

    let neon = paint(
      emptyDocument(),
      'cyber.neon-strip',
      'cyber-yellow',
      horizontal(5, 5, 2),
    );
    expect(rowTokens(neon, 'terrain', 'cyber-yellow', 5, 5, 2)).toEqual(['.', '.']);
    neon = paint(neon, 'cyber.neon-strip', 'cyber-yellow', [{ x: 7, y: 5 }]);
    expect(rowTokens(neon, 'terrain', 'cyber-yellow', 5, 5, 3)).toEqual(['49', '50', '51']);

    let panel = paint(
      emptyDocument(),
      'cyber.framed-panel',
      'cyber-pink',
      horizontal(10, 8, 2),
    );
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 8, 2)).toEqual(['.', '.']);
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 9, 2)).toEqual(['.', '.']);
    panel = paint(panel, 'cyber.framed-panel', 'cyber-pink', [{ x: 12, y: 8 }]);
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 8, 3)).toEqual(['44', '45', '46']);
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 9, 3)).toEqual(['56', '57', '58']);
  });

  it('suppresses one panel part and erases the whole recipe from either row', () => {
    let document = paint(
      emptyDocument(),
      'cyber.framed-panel',
      'cyber-pink',
      horizontal(10, 5, 4),
    );
    const manuallyEditedTileData = cloneTileData(document);
    manuallyEditedTileData.foreground[5]![11] = -1;
    const suppressedState = applyManualSmartOutputEdit(
      document.smartTerrain,
      'foreground',
      11,
      5,
      -1,
    );
    document = resolveSmartRecipeDocument({
      tileData: manuallyEditedTileData,
      smartTerrain: suppressedState,
    });
    expect(document.tileData.foreground[5]![11]).toBe(-1);
    expect(document.smartTerrain.suppressedOutputParts.some((entry) => (
      entry.includes('cyber:recipe:') && entry.endsWith(':row-0:column-1')
    ))).toBe(true);
    expect(Object.keys(document.smartTerrain.ownedOutputs).filter((key) => (
      key.startsWith('foreground:')
    ))).toHaveLength(7);

    document = erase(
      document,
      'cyber.framed-panel',
      'cyber-pink',
      [{ x: 12, y: 6 }],
    );
    expect(Object.keys(document.smartTerrain.recipes)).toHaveLength(0);
    expect(document.smartTerrain.suppressedOutputParts.filter((entry) => (
      entry.startsWith('cyber:recipe:')
    ))).toEqual([]);
    expect(rowTokens(document, 'foreground', 'cyber-pink', 10, 5, 4)).toEqual(['.', '.', '.', '.']);
    expect(rowTokens(document, 'foreground', 'cyber-pink', 10, 6, 4)).toEqual(['.', '.', '.', '.']);
  });

  it('cleans deleted-owner suppressions when same-style panel recipes merge', () => {
    let document = paint(
      emptyDocument(),
      'cyber.framed-panel',
      'cyber-yellow',
      horizontal(2, 4, 3),
    );
    document = paint(document, 'cyber.framed-panel', 'cyber-yellow', horizontal(6, 4, 3));
    expect(Object.keys(document.smartTerrain.recipes)).toHaveLength(2);

    const manuallyEditedTileData = cloneTileData(document);
    manuallyEditedTileData.foreground[4]![7] = -1;
    document = resolveSmartRecipeDocument({
      tileData: manuallyEditedTileData,
      smartTerrain: applyManualSmartOutputEdit(document.smartTerrain, 'foreground', 7, 4, -1),
    });
    expect(document.smartTerrain.suppressedOutputParts).toContain(
      'cyber:recipe:cyber-panel-2:row-0:column-1',
    );

    document = paint(
      document,
      'cyber.framed-panel',
      'cyber-yellow',
      [{ x: 5, y: 4 }],
    );
    expect(Object.keys(document.smartTerrain.recipes)).toEqual(['cyber-panel-1']);
    expect(document.smartTerrain.suppressedOutputParts.filter((entry) => (
      entry.startsWith('cyber:recipe:')
    ))).toEqual([]);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 2, 4, 7)).toEqual([
      '44', '45', '45', '45', '45', '45', '46',
    ]);
  });

  it('replaces an overlapping different-style panel instead of retaining competing owners', () => {
    let document = paint(
      emptyDocument(),
      'cyber.framed-panel',
      'cyber-yellow',
      horizontal(10, 5, 5),
    );
    document = paint(document, 'cyber.framed-panel', 'cyber-pink', horizontal(12, 5, 5));

    expect(Object.keys(document.smartTerrain.recipes)).toHaveLength(1);
    expect(Object.values(document.smartTerrain.recipes)[0]).toMatchObject({
      styleId: 'cyber-pink',
      anchor: { layer: 'foreground', x: 12, y: 5 },
      parameters: { width: 5, height: 2 },
    });
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 5, 2)).toEqual(['.', '.']);
    expect(rowTokens(document, 'foreground', 'cyber-pink', 12, 5, 5)).toEqual([
      '44', '45', '45', '45', '46',
    ]);
    const [replacementInstanceId] = Object.keys(document.smartTerrain.recipes);
    expect(Object.values(document.smartTerrain.ownedOutputs).every(({ ownerId }) => (
      ownerId === `cyber:recipe:${replacementInstanceId}`
    ))).toBe(true);
  });

  it('uses Details for one anchor-relative, width-stable local-59 framed-panel accent', () => {
    const first = paint(
      emptyDocument(true),
      'cyber.framed-panel',
      'cyber-yellow',
      horizontal(4, 4, 7),
    );
    const second = resolveSmartRecipeDocument(first);
    const bottom = rowTokens(first, 'foreground', 'cyber-yellow', 4, 5, 7);
    const moved = paint(
      emptyDocument(true),
      'cyber.framed-panel',
      'cyber-yellow',
      horizontal(20, 11, 7),
    );
    const movedBottom = rowTokens(moved, 'foreground', 'cyber-yellow', 20, 12, 7);

    expect(bottom.filter((token) => token.startsWith('59'))).toHaveLength(1);
    expect(movedBottom).toEqual(bottom);
    expect(second).toEqual(first);
  });

  it('keeps a manually erased primary source connected while suppressing only that output part', () => {
    let document = paint(
      emptyDocument(),
      'cyber.structure',
      'cyber-yellow',
      horizontal(8, 8, 3),
    );
    const manuallyEditedTileData = cloneTileData(document);
    manuallyEditedTileData.terrain[8]![9] = -1;
    document = resolveSmartRecipeDocument({
      tileData: manuallyEditedTileData,
      smartTerrain: applyManualSmartOutputEdit(document.smartTerrain, 'terrain', 9, 8, -1),
    });

    expect(document.smartTerrain.semanticCells['terrain:9,8']).toBeDefined();
    expect(document.smartTerrain.suppressedOutputParts).toContain(
      'cyber:cell:terrain:9,8:primary',
    );
    expect(document.tileData.terrain[8]![9]).toBe(-1);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 8, 8)).not.toBe(23);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 10, 8)).not.toBe(23);

    document = paint(
      document,
      'cyber.structure',
      'cyber-yellow',
      [{ x: 9, y: 8 }],
    );
    expect(document.smartTerrain.suppressedOutputParts).not.toContain(
      'cyber:cell:terrain:9,8:primary',
    );
    expect(document.tileData.terrain[8]![9]).toBeGreaterThan(0);
  });

  it('generates deterministic details and caps lights by eligible structure area', () => {
    const cells = rectangle(0, 0, 16, 8);
    const first = paint(
      emptyDocument(true),
      'cyber.structure',
      'cyber-yellow',
      cells,
    );
    const second = paint(
      emptyDocument(true),
      'cyber.structure',
      'cyber-yellow',
      [...cells].reverse(),
    );
    const details = Object.values(first.smartTerrain.ownedOutputs).filter(({ partId }) => partId === 'detail');
    const emitterCount = details.filter(({ value }) => {
      const localIndex = decodeTileDataValue(value).gid
        - getSmartStyleDefinition('cyber-yellow').firstGid;
      return isCyberEmitterLocalIndex('cyber-yellow', localIndex);
    }).length;

    expect(first.tileData).toEqual(second.tileData);
    expect(first.smartTerrain.ownedOutputs).toEqual(second.smartTerrain.ownedOutputs);
    expect(details.length).toBeGreaterThan(0);
    expect(emitterCount).toBeLessThanOrEqual(2);
    expect(resolveSmartRecipeDocument(first)).toEqual(first);
  });

  it('round-trips normalized and cloned state without changing recipes, locks, or outputs', () => {
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    let document = paint(
      emptyDocument(true),
      'cyber.structure',
      'cyber-yellow',
      rectangle(3, 3, 4, 4),
    );
    document = lockSmartSemanticCell(
      document,
      4,
      4,
      firstGid + 83 + TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG,
      'terrain',
    );
    document = paint(document, 'cyber.framed-panel', 'cyber-pink', horizontal(12, 4, 4));

    const manuallyEditedTileData = cloneTileData(document);
    manuallyEditedTileData.foreground[4]![13] = -1;
    document = resolveSmartRecipeDocument({
      tileData: manuallyEditedTileData,
      smartTerrain: applyManualSmartOutputEdit(document.smartTerrain, 'foreground', 13, 4, -1),
    });

    const saved = JSON.parse(JSON.stringify(document.smartTerrain)) as unknown;
    const normalized = normalizeRoomSmartTerrainState(saved);
    const cloned = cloneRoomSmartTerrainState(normalized);
    const restored = resolveSmartRecipeDocument({ tileData: cloneTileData(document), smartTerrain: cloned });

    expect(restored).toEqual(document);
    expect(restored.smartTerrain.semanticCells[smartSemanticCellKey('terrain', 4, 4)]?.lockedValue)
      .toBe(firstGid + 83 + TILE_FLIP_X_FLAG + TILE_FLIP_Y_FLAG);
    expect(restored.smartTerrain.suppressedOutputParts).toEqual(document.smartTerrain.suppressedOutputParts);
    expect(Object.keys(restored.smartTerrain.recipes)).toEqual(Object.keys(document.smartTerrain.recipes));
    const panelOutput = restored.smartTerrain.ownedOutputs[smartOwnedOutputKey('foreground', 12, 4)];
    expect(panelOutput).toMatchObject({ kind: 'recipe', layer: 'foreground' });
  });
});
