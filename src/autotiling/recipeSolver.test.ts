import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOM_HEIGHT, ROOM_WIDTH, TILE_FLIP_X_FLAG, TILE_FLIP_Y_FLAG, type LayerName } from '../config/room';
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
import type { CyberStyleId } from './cyberProfile';
import { applySmartCells } from './solver';
import { edgesForOrientedCatalogTile } from './cyberEdgeCatalog';
import { listCyberLetterMismatches, listCyberVoidAViolations } from './cyberEdgeMatcher';

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

function expectMatchingConcreteLetters(document: SmartRecipeDocument, styleId: CyberStyleId): void {
  const picks = concretePicksFromDocument(document, styleId);
  expect(listCyberLetterMismatches(picks, () => true)).toEqual([]);
}

function expectAFacesVoids(document: SmartRecipeDocument, styleId: CyberStyleId): void {
  const picks = concretePicksFromDocument(document, styleId);
  expect(listCyberVoidAViolations(picks, () => true)).toEqual([]);
}

function concretePicksFromDocument(document: SmartRecipeDocument, styleId: CyberStyleId) {
  const style = getSmartStyleDefinition(styleId);
  const picks = new Map<string, {
    localIndex: number;
    flipX: boolean;
    flipY: boolean;
    edges: NonNullable<ReturnType<typeof edgesForOrientedCatalogTile>>;
  }>();
  for (let y = 0; y < ROOM_HEIGHT; y += 1) {
    for (let x = 0; x < ROOM_WIDTH; x += 1) {
      const value = document.tileData.terrain[y]![x]!;
      if (value <= 0) continue;
      const decoded = decodeTileDataValue(value);
      const localIndex = decoded.gid - style.firstGid;
      if (localIndex < 0 || localIndex >= style.tileCount) continue;
      const edges = edgesForOrientedCatalogTile(localIndex, decoded.flipX, decoded.flipY, 'cyber.concrete');
      if (!edges) continue;
      picks.set(`${x},${y}`, {
        localIndex,
        flipX: decoded.flipX,
        flipY: decoded.flipY,
        edges,
      });
    }
  }
  return picks;
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

describe('Cyber Smart recipe solver and ownership contracts', () => {
  it('retargets primary and companion Cyber outputs to an Advanced-selected layer', () => {
    const ring = rectangle(10, 10, 3, 3).filter(({ x, y }) => !(x === 11 && y === 11));
    let document = applySmartBrushCells(emptyDocument(), {
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
      cells: ring,
      mode: 'paint',
      layer: 'foreground',
    });

    expect(document.smartTerrain.semanticCells['foreground:10,10']).toMatchObject({
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    expect(document.tileData.foreground[10]![10]).toBeGreaterThan(0);
    expect(document.tileData.terrain[10]![10]).toBe(-1);
    expect(document.smartTerrain.ownedOutputs['foreground:10,10']).toMatchObject({
      partId: 'primary',
      layer: 'foreground',
    });
    expect(document.smartTerrain.ownedOutputs['terrain:10,10']).toBeUndefined();

    document = applySmartBrushCells(document, {
      brushId: 'cyber.support',
      styleId: 'cyber-pink',
      cells: vertical(16, 2, 4),
      mode: 'paint',
      layer: 'foreground',
    });
    expect(vertical(16, 2, 4).map(({ x, y }) => (
      tileToken(document.tileData.foreground[y]![x]!, 'cyber-pink')
    ))).toEqual(['36', '48', '60', '72']);
    expect(Object.values(document.smartTerrain.recipes)).toContainEqual(expect.objectContaining({
      brushId: 'cyber.support',
      anchor: expect.objectContaining({ layer: 'foreground' }),
    }));
  });

  it('discards middle-layer legacy decorations when Cyber replaces their Smart owner', () => {
    const legacyCells = Array.from({ length: 10 * 38 }, (_, index) => ({
      x: 1 + (index % 38),
      y: 2 + Math.floor(index / 38) * 2,
    }));
    let document = applySmartCells(emptyDocument(true), {
      cells: legacyCells,
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const decorationEntry = Object.entries(document.smartTerrain.generatedDecorations)[0];
    expect(decorationEntry).toBeDefined();
    const [targetKey, decoration] = decorationEntry!;
    expect(decoration.layer).toBe('terrain');
    expect(getTerrainCollisionProfileForGid(decoration.gid).hasCollision).toBe(false);

    const [ownerX, ownerY] = decoration.ownerKey.split(',').map(Number);
    const [targetX, targetY] = targetKey.split(',').map(Number);
    const oldDecorationValue = document.tileData.terrain[targetY]![targetX];
    document = paint(document, 'cyber.concrete', 'cyber-yellow', [{ x: ownerX, y: ownerY }]);

    expect(document.smartTerrain.cells[decoration.ownerKey]).toBeUndefined();
    expect(Object.values(document.smartTerrain.generatedDecorations).some(
      (candidate) => candidate.ownerKey === decoration.ownerKey,
    )).toBe(false);
    expect(document.tileData.terrain[targetY]![targetX]).not.toBe(oldDecorationValue);
    expect(Object.values(document.smartTerrain.ownedOutputs).some(
      (output) => output.ownerId === `legacy-cell:${decoration.ownerKey}`,
    )).toBe(false);
  });

  it('discards every layered Feature edge part when Cyber replaces its Smart owner', () => {
    let document = applySmartCells(emptyDocument(true), {
      cells: [{ x: 5, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 6 }],
      mode: 'paint',
      theme: 'forest',
      material: 'feature',
    });
    const front = document.smartTerrain.generatedDecorations['5,5'];
    const behind = document.smartTerrain.generatedBackgroundDecorations['5,5'];
    expect(front).toBeDefined();
    expect(behind).toBeDefined();
    expect(behind?.ownerKey).toBe(front?.ownerKey);

    const [ownerX, ownerY] = front!.ownerKey.split(',').map(Number);
    document = paint(document, 'cyber.concrete', 'cyber-yellow', [{ x: ownerX, y: ownerY }]);

    for (const generated of [
      document.smartTerrain.generatedDecorations,
      document.smartTerrain.generatedBackgroundDecorations,
    ]) {
      expect(Object.values(generated).some(
        (candidate) => candidate.ownerKey === front!.ownerKey,
      )).toBe(false);
    }
    expect(document.tileData.terrain[5]![5]).toBe(-1);
    expect(document.tileData.background[5]![5]).toBe(-1);
  });

  it('preserves Terrain decorations when a Background Support replaces only a tunnel', () => {
    const legacyCells = Array.from({ length: 10 * 38 }, (_, index) => ({
      x: 1 + (index % 38),
      y: 2 + Math.floor(index / 38) * 2,
    }));
    let document = applySmartCells(emptyDocument(true), {
      cells: legacyCells,
      mode: 'paint',
      theme: 'forest',
      material: 'ground',
    });
    const [targetKey, decoration] = Object.entries(
      document.smartTerrain.generatedDecorations,
    )[0]!;
    const [ownerX, ownerY] = decoration.ownerKey.split(',').map(Number);
    const [targetX, targetY] = targetKey.split(',').map(Number);
    document = applySmartCells(document, {
      cells: [{ x: ownerX, y: ownerY }],
      mode: 'paint',
      theme: 'forest',
      material: 'tunnel',
    });
    const decorationValue = document.tileData.terrain[targetY]![targetX];

    document = paint(document, 'cyber.support', 'cyber-yellow', [{ x: ownerX, y: ownerY }]);

    expect(document.smartTerrain.cells[decoration.ownerKey]).toBeDefined();
    expect(Object.values(document.smartTerrain.generatedDecorations).some(
      (candidate) => candidate.ownerKey === decoration.ownerKey,
    )).toBe(true);
    expect(document.tileData.terrain[targetY]![targetX]).toBe(decorationValue);
    expect(document.tileData.background[ownerY]![ownerX]).toBeGreaterThan(0);
  });

  it('resolves all six brushes with their exact layer and collision contracts', () => {
    let document = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      rectangle(2, 2, 2, 2),
    );
    document = paint(document, 'cyber.concrete', 'cyber-pink', horizontal(6, 6, 5));
    document = paint(document, 'cyber.rubble', 'cyber-yellow', rectangle(12, 8, 3, 2));
    document = paint(document, 'cyber.support', 'cyber-pink', vertical(16, 2, 4));
    document = paint(document, 'cyber.neon', 'cyber-yellow', horizontal(19, 9, 3));
    document = paint(document, 'cyber.fence', 'cyber-pink', horizontal(24, 3, 5));

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 2, 2)).toEqual(['14', '14X']);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 3, 2)).toEqual(['25Y', '30Y']);
    expect(rowTokens(document, 'terrain', 'cyber-pink', 6, 6, 5)).toEqual([
      '71X', '68', '68', '68', '71',
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

  it('keeps Concrete semantic while persisting Support and Neon as stable recipe owners', () => {
    let document = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      horizontal(3, 4, 4),
    );
    document = paint(document, 'cyber.support', 'cyber-pink', rectangle(10, 2, 2, 4));
    document = paint(document, 'cyber.neon', 'cyber-yellow', horizontal(18, 8, 3));

    const recipes = Object.values(document.smartTerrain.recipes);
    expect(recipes).toHaveLength(2);
    expect(recipes).toEqual(expect.arrayContaining([
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
        recipeId: 'cyber.neon',
        brushId: 'cyber.neon',
        styleId: 'cyber-yellow',
        ownerId: 'cyber:recipe:cyber-neon-strip-1',
        anchor: { layer: 'terrain', x: 18, y: 8 },
        bounds: { minX: 18, minY: 8, maxX: 20, maxY: 8, width: 3, height: 1 },
        sourceCells: horizontal(18, 8, 3).map(({ x, y }) => ({ layer: 'terrain', x, y })),
      }),
    ]));
    expect(Object.values(document.smartTerrain.semanticCells).filter(({ brushId }) => (
      brushId === 'cyber.concrete'
    ))).toHaveLength(4);
    expect(Object.values(document.smartTerrain.semanticCells).some(({ brushId }) => (
      brushId === 'cyber.support' || brushId === 'cyber.neon'
    ))).toBe(false);

    const outputsByOwner = new Map<string, number>();
    for (const output of Object.values(document.smartTerrain.ownedOutputs)) {
      if (!output.ownerId.includes('cyber-support')
        && !output.ownerId.includes('cyber-neon-strip')) continue;
      expect(output).toMatchObject({ kind: 'recipe' });
      expect(output.value).toBeGreaterThan(0);
      outputsByOwner.set(output.ownerId, (outputsByOwner.get(output.ownerId) ?? 0) + 1);
    }
    expect(Object.fromEntries(outputsByOwner)).toEqual({
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

  it('outlines Cyber Rubble exactly like the established Feature brush', () => {
    const document = paint(
      emptyDocument(false),
      'cyber.rubble',
      'cyber-yellow',
      rectangle(3, 4, 2, 2),
    );

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 3, 4, 2)).toEqual(['12', '12']);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 3, 5, 2)).toEqual(['12', '12']);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 3, 3, 2)).toEqual(['0', '0']);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 2, 4, 4)).toEqual(['1', '.', '.', '13']);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 2, 5, 4)).toEqual(['1', '.', '.', '13']);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 3, 6, 2)).toEqual(['24', '24']);
    expect(Object.values(document.smartTerrain.ownedOutputs).filter(({ partId }) => (
      partId.startsWith('rubble-')
    ))).toHaveLength(8);
  });

  it('keeps Neon owner IDs stable across repaint and extension, then repairs split and merge owners', () => {
    let document = paint(
      emptyDocument(),
      'cyber.neon',
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

    document = paint(document, 'cyber.neon', 'cyber-yellow', [{ x: 5, y: 5 }]);
    expect(Object.keys(document.smartTerrain.recipes)).toEqual([originalId]);
    expect(document.smartTerrain.suppressedOutputParts).not.toContain(
      smartOwnedOutputPartKey(originalOwner, 'row-0:column-1'),
    );
    expect(document.tileData.terrain[5]![5]).toBeGreaterThan(0);

    document = paint(document, 'cyber.neon', 'cyber-yellow', [{ x: 8, y: 5 }]);
    expect(Object.keys(document.smartTerrain.recipes)).toEqual([originalId]);
    expect(document.smartTerrain.recipes[originalId]).toMatchObject({
      ownerId: originalOwner,
      anchor: { layer: 'terrain', x: 4, y: 5 },
      bounds: { minX: 4, minY: 5, maxX: 8, maxY: 5, width: 5, height: 1 },
    });

    document = erase(document, 'cyber.neon', 'cyber-yellow', [{ x: 6, y: 5 }]);
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

    document = paint(document, 'cyber.neon', 'cyber-yellow', [{ x: 6, y: 5 }]);
    expect(Object.keys(document.smartTerrain.recipes)).toEqual([originalId]);
    expect(Object.values(document.smartTerrain.ownedOutputs)
      .filter(({ kind }) => kind === 'recipe')
      .every(({ ownerId }) => ownerId === originalOwner)).toBe(true);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 4, 5, 5)).not.toContain('.');
  });

  it('keeps Neon middle phase anchored when additional legacy tiles extend its left edge', () => {
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    const withLegacy = (count: number): SmartRecipeDocument => {
      const tileData = createEmptyTileData();
      for (let x = 4 - count; x < 4; x += 1) {
        tileData.terrain[6]![x] = firstGid + 50;
      }
      return paint(
        { tileData, smartTerrain: createRoomSmartTerrainState() },
        'cyber.neon',
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

  it('uses only the audited neutral Ground vocabulary in a large rectangle', () => {
    const document = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      rectangle(32, 2, 8, 16),
    );
    expect(CYBER_REFERENCE.provenance).toMatchObject({
      roomVersion: 13,
      snapshotSha256: '84add9b8e02afe00736ff59f54b07b9ca61237b8866e0815e3a2b978224a41ec',
    });
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 32, 2, 8)[0]).toBe('14');
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 32, 2, 8)[7]).toBe('14X');
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 32, 2, 8).slice(1, 7).every((value) => (
      ['15', '15X', '16', '16X', '62Y', '62XY'].includes(value)
    ))).toBe(true);
    for (let y = 3; y < 17; y += 1) {
      const row = rowTokens(document, 'terrain', 'cyber-yellow', 32, y, 8);
      expect(['21X', '21XY', '23', '23Y']).toContain(row[0]);
      expect(['23X', '23XY', '21', '21Y']).toContain(row[7]);
      expect(row.slice(1, 7).every((value) => /^64$|^82[XY]*$/.test(value))).toBe(true);
    }
    const bottom = rowTokens(document, 'terrain', 'cyber-yellow', 32, 17, 8);
    expect(bottom[0]).toBe('25Y');
    expect(bottom[7]).toBe('30Y');
    expect(bottom.slice(1, 7).every((value) => (
      ['62', '62X', '15Y', '15XY', '16Y', '16XY'].includes(value)
    ))).toBe(true);
  });

  it('keeps neutral topology-owned wall art on inset edges of an irregular silhouette', () => {
    const cells = [
      ...horizontal(4, 4, 4),
      ...horizontal(5, 5, 2),
      ...horizontal(4, 6, 4),
    ];
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect(['21X', '21XY', '23', '23Y']).toContain(
      rowTokens(document, 'terrain', 'cyber-yellow', 5, 5, 2)[0],
    );
    expect(['23X', '23XY', '21', '21Y']).toContain(
      rowTokens(document, 'terrain', 'cyber-yellow', 5, 5, 2)[1],
    );
    expectAFacesVoids(document, 'cyber-yellow');
  });

  it('frames a filled Structure staircase with colliding diagonal step art', () => {
    const staircase = [
      ...horizontal(2, 2, 2),
      ...horizontal(2, 3, 3),
      ...horizontal(2, 4, 4),
    ];
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', staircase);

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 2, 4)).toEqual([
      '14', '14X', '.', '.',
    ]);
    const middle = rowTokens(document, 'terrain', 'cyber-yellow', 2, 3, 4);
    expect(['21X', '21XY', '23', '23Y']).toContain(middle[0]);
    expect(['11', '33', '35']).toContain(middle[1].replace(/[XY]+$/, ''));
    expect(middle.slice(2)).toEqual(['14X', '.']);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 2, 3, 4)).toEqual([
      '.', '9Y', '.', '.',
    ]);
    const bottom = rowTokens(document, 'terrain', 'cyber-yellow', 2, 4, 4);
    expect(bottom[0]).toBe('25Y');
    expect(['62', '62X', '15Y', '15XY', '16Y', '16XY']).toContain(bottom[1]);
    expect(['62', '62X', '15Y', '15XY', '16Y', '16XY']).toContain(bottom[2]);
    expect(bottom[3]).toBe('71');
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 2, 4, 4)).toEqual([
      '.', '.', '9Y', '.',
    ]);
    staircase.forEach(({ x, y }) => expectCollision(document, x, y));
    expectAFacesVoids(document, 'cyber-yellow');
  });

  it.each([
    { name: 'top-left', omittedX: 8, omittedY: 8, overlay: '9XY' },
    { name: 'top-right', omittedX: 10, omittedY: 8, overlay: '9Y' },
    { name: 'bottom-left', omittedX: 8, omittedY: 10, overlay: '9X' },
    { name: 'bottom-right', omittedX: 10, omittedY: 10, overlay: '9' },
  ])('overlays Cyber A10 on the inner corner of a missing $name diagonal', ({
    omittedX,
    omittedY,
    overlay,
  }) => {
    const cells = rectangle(8, 8, 3, 3).filter(({ x, y }) => (
      x !== omittedX || y !== omittedY
    ));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect([11, 33, 35]).toContain(
      Number.parseInt(tileToken(document.tileData.terrain[9]![9]!, 'cyber-yellow').replace(/[XY]+$/, ''), 10),
    );
    expect(tileToken(document.tileData.foreground[9]![9]!, 'cyber-yellow')).toBe(overlay);
    expectCollision(document, 9, 9);
  });

  it('uses neutral F9 platform middles and never joins styles', () => {
    let document = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      horizontal(2, 3, 5),
    );
    document = paint(document, 'cyber.concrete', 'cyber-pink', horizontal(7, 3, 5));

    expect(rowTokens(document, 'terrain', 'cyber-yellow', 2, 3, 5)).toEqual([
      '71X', '68', '68', '68', '71',
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-pink', 7, 3, 5)).toEqual([
      '71X', '68', '68', '68', '71',
    ]);

    let structures = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      [{ x: 18, y: 4 }],
    );
    structures = paint(structures, 'cyber.concrete', 'cyber-pink', [{ x: 19, y: 4 }]);
    expect(localIndexAt(structures, 'terrain', 'cyber-yellow', 18, 4)).toBe(20);
    expect(localIndexAt(structures, 'terrain', 'cyber-pink', 19, 4)).toBe(20);
  });

  it('keeps F10/F11 platform accents manually locked until Concrete is repainted', () => {
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    let document = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      horizontal(3, 4, 5),
    );
    const manualTileData = cloneTileData(document);
    manualTileData.terrain[4]![5] = firstGid + 69; // Cyber F10 paint-spill accent.
    document = resolveSmartRecipeDocument({
      tileData: manualTileData,
      smartTerrain: applyManualSmartOutputEdit(document.smartTerrain, 'terrain', 5, 4, firstGid + 69),
    });

    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 5, 4)).toBe(69);
    expect(document.smartTerrain.semanticCells['terrain:5,4']?.lockedValue).toBe(firstGid + 69);

    document = paint(document, 'cyber.concrete', 'cyber-yellow', [{ x: 5, y: 4 }]);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 5, 4)).toBe(68);
    expect(document.smartTerrain.semanticCells['terrain:5,4']?.lockedValue).toBeUndefined();
  });

  it('keeps adjacent framed panels separate by style', () => {
    let document = paint(
      emptyDocument(),
      'cyber.fence',
      'cyber-yellow',
      horizontal(3, 5, 3),
    );
    document = paint(document, 'cyber.fence', 'cyber-pink', horizontal(6, 5, 3));

    expect(Object.keys(document.smartTerrain.recipes)).toHaveLength(2);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 3, 5, 3)).toEqual(['44', '45', '46']);
    expect(rowTokens(document, 'foreground', 'cyber-pink', 6, 5, 3)).toEqual(['44', '45', '46']);
    expect(localIndexAt(document, 'foreground', 'cyber-yellow', 5, 5)).toBe(46);
    expect(localIndexAt(document, 'foreground', 'cyber-pink', 6, 5)).toBe(44);
  });

  it('keeps a 1-cell-thick ring on E-frame mids instead of inverting tunnel fill', () => {
    const ring = rectangle(10, 10, 3, 3).filter(({ x, y }) => !(x === 11 && y === 11));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', ring);

    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 10, 3)).toEqual([
      '.', '.', '.',
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 10, 10, 3)).toEqual([
      '67Y', '68', '67XY',
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 10, 11, 3)).toEqual([
      '31', '.', '31',
    ]);
    expect(rowTokens(document, 'terrain', 'cyber-yellow', 10, 12, 3)).toEqual([
      '67', '68', '67X',
    ]);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 12, 3)).toEqual([
      '.', '.', '.',
    ]);
    expect(document.tileData.terrain[11]![11]).toBe(-1);
    expectCollision(document, 10, 10);
    expectCollision(document, 11, 10);
    expectCollision(document, 12, 11);
  });

  it('uses 55 / 70 at 1-cell-thick T-junctions and 43 at a 1-cell-thick cross', () => {
    const tee = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', [
      { x: 10, y: 8 }, { x: 10, y: 9 }, { x: 10, y: 10 }, { x: 10, y: 11 },
      { x: 11, y: 9 }, { x: 12, y: 9 },
    ]);
    expect(tileToken(tee.tileData.terrain[9]![10]!, 'cyber-yellow')).toBe('55');
    expectMatchingConcreteLetters(tee, 'cyber-yellow');

    const floorTee = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', [
      { x: 10, y: 12 }, { x: 11, y: 12 }, { x: 12, y: 12 }, { x: 13, y: 12 },
      { x: 12, y: 10 }, { x: 12, y: 11 },
    ]);
    expect(tileToken(floorTee.tileData.terrain[12]![12]!, 'cyber-yellow')).toBe('70Y');
    expectMatchingConcreteLetters(floorTee, 'cyber-yellow');

    const cross = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', [
      { x: 12, y: 10 }, { x: 12, y: 11 },
      { x: 10, y: 12 }, { x: 11, y: 12 }, { x: 12, y: 12 }, { x: 13, y: 12 }, { x: 14, y: 12 },
      { x: 12, y: 13 }, { x: 12, y: 14 },
    ]);
    expect(tileToken(cross.tileData.terrain[12]![12]!, 'cyber-yellow')).toBe('43');
    expectMatchingConcreteLetters(cross, 'cyber-yellow');
  });

  it('uses 70 between a 1-cell chimney and an enclosed hole instead of a tunnel ceiling', () => {
    const hole = new Set(['12,11']);
    const cells = [
      ...rectangle(10, 10, 5, 5).filter((cell) => !hole.has(`${cell.x},${cell.y}`)),
      { x: 12, y: 9 },
    ];
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect(tileToken(document.tileData.terrain[10]![12]!, 'cyber-yellow')).toBe('70Y');
    expect(tileToken(document.tileData.terrain[9]![12]!, 'cyber-yellow')).toBe('19');
    expect(document.tileData.terrain[11]![12]).toBe(-1);
    expectAFacesVoids(document, 'cyber-yellow');
  });

  it('uses convex 14-family corners at inner steps of an enclosed hole instead of tunnel edges', () => {
    const hole = new Set(['12,11', '13,11', '14,11', '12,12', '13,12', '14,12', '11,13', '12,13', '13,13', '14,13']);
    const cells = rectangle(10, 10, 6, 6).filter((cell) => !hole.has(`${cell.x},${cell.y}`));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect([14, 25, 30, 61]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 11, 12));
    expect(['21', '23', '34']).not.toContain(
      tileToken(document.tileData.terrain[12]![11]!, 'cyber-yellow').replace(/[XY]+$/, ''),
    );
  });

  it('uses 11 / 33 / 35 at concave hole corners and 14-family at convex plus armpits', () => {
    const blockHole = new Set(['12,12', '13,12', '12,13', '13,13']);
    const block = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      rectangle(10, 10, 6, 6).filter((cell) => !blockHole.has(`${cell.x},${cell.y}`)),
    );
    for (const [x, y] of [[11, 11], [14, 11], [11, 14], [14, 14]] as const) {
      expect([11, 33, 35]).toContain(localIndexAt(block, 'terrain', 'cyber-yellow', x, y));
    }

    const plusHole = new Set(['12,11', '11,12', '12,12', '13,12', '12,13']);
    const plus = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      rectangle(8, 8, 10, 10).filter((cell) => !plusHole.has(`${cell.x},${cell.y}`)),
    );
    for (const [x, y] of [[11, 11], [13, 11], [11, 13], [13, 13]] as const) {
      expect([14, 25, 30, 61]).toContain(localIndexAt(plus, 'terrain', 'cyber-yellow', x, y));
    }
    for (const [x, y] of [[11, 10], [13, 10], [10, 11], [14, 11], [10, 13], [14, 13], [11, 14], [13, 14]] as const) {
      expect([11, 33, 35]).toContain(localIndexAt(plus, 'terrain', 'cyber-yellow', x, y));
    }
    expect(tileToken(plus.tileData.terrain[10]![12]!, 'cyber-yellow')).toBe('34Y');
    expect(tileToken(plus.tileData.terrain[14]![12]!, 'cyber-yellow')).toBe('34');
    expect(tileToken(plus.tileData.terrain[12]![10]!, 'cyber-yellow')).toBe('21');
    expect(tileToken(plus.tileData.terrain[12]![14]!, 'cyber-yellow')).toBe('23');
    expectMatchingConcreteLetters(block, 'cyber-yellow');
    expectMatchingConcreteLetters(plus, 'cyber-yellow');
  });

  it('uses 14 / 25 / 30 / 60 at the pinch where an inner hole meets an outer cut-out', () => {
    const hole = new Set(['12,11', '13,11', '12,12', '13,12']);
    const cells = rectangle(10, 8, 8, 10).filter(({ x, y }) => (
      !hole.has(`${x},${y}`) && !(x >= 14 && y >= 13 && y <= 14)
    ));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect([14, 25, 30, 61]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 14, 12));
    expect([14, 25, 30, 61]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 13, 13));
    expect(['11', '33', '35']).not.toContain(
      tileToken(document.tileData.terrain[12]![14]!, 'cyber-yellow').replace(/[XY]+$/, ''),
    );
    expect(tileToken(document.tileData.terrain[10]![12]!, 'cyber-yellow')).toBe('34Y');
    expect(tileToken(document.tileData.terrain[11]![11]!, 'cyber-yellow')).toBe('21');
    expectMatchingConcreteLetters(document, 'cyber-yellow');
  });

  it('uses 11 / 33 / 35 at exterior concave corners of a painted plus', () => {
    const cells = rectangle(10, 10, 7, 7).filter(({ x, y }) => {
      const localX = x - 10;
      const localY = y - 10;
      return !((localX < 2 || localX > 4) && (localY < 2 || localY > 4));
    });
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    for (const [x, y] of [[12, 12], [14, 12], [12, 14], [14, 14]] as const) {
      expect([11, 33, 35]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', x, y));
    }
    expect(tileToken(document.tileData.foreground[12]![12]!, 'cyber-yellow')).toBe('9XY');
  });

  it('uses tunnel ceiling and sides only where Concrete backs the enclosed void', () => {
    const cells = rectangle(8, 8, 5, 5).filter(({ x, y }) => !(x === 10 && y === 10));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect(tileToken(document.tileData.terrain[9]![10]!, 'cyber-yellow')).toBe('34Y');
    expect(tileToken(document.tileData.terrain[11]![10]!, 'cyber-yellow')).toBe('34');
    expect(tileToken(document.tileData.terrain[10]![9]!, 'cyber-yellow')).toBe('21');
    expect(tileToken(document.tileData.terrain[10]![11]!, 'cyber-yellow')).toBe('23');
    expect(document.tileData.terrain[10]![10]).toBe(-1);
    for (const [x, y] of [[9, 9], [11, 9], [9, 11], [11, 11]] as const) {
      expect([11, 33, 35]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', x, y));
    }
    expect(tileToken(document.tileData.foreground[9]![9]!, 'cyber-yellow')).toBe('9');
    expect(tileToken(document.tileData.foreground[9]![11]!, 'cyber-yellow')).toBe('9X');
    expect(tileToken(document.tileData.foreground[11]![9]!, 'cyber-yellow')).toBe('9Y');
    expect(tileToken(document.tileData.foreground[11]![11]!, 'cyber-yellow')).toBe('9XY');
    expectMatchingConcreteLetters(document, 'cyber-yellow');
  });

  it('uses 11 / 33 / 35 only on four-connected hole corners, not on solid sides beside a cut-out', () => {
    const hole = new Set(['13,13']);
    const cutout = new Set(['14,12', '15,12']);
    const cells = rectangle(11, 10, 6, 7).filter(({ x, y }) => (
      !hole.has(`${x},${y}`) && !cutout.has(`${x},${y}`)
    ));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    for (const [x, y] of [[12, 12], [12, 14], [14, 14]] as const) {
      expect([11, 33, 35]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', x, y));
    }
    expect([14, 25, 30, 61]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 13, 12));
    expect([14, 25, 30, 61]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 14, 13));
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 12, 13)).toBe(21);
    expect(tileToken(document.tileData.foreground[13]![13]!, 'cyber-yellow')).toBe('.');
  });

  it('does not overlay Cyber A10 on a concrete ring', () => {
    const ring = rectangle(10, 10, 3, 3).filter(({ x, y }) => !(x === 11 && y === 11));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', ring);

    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 10, 3)).toEqual(['.', '.', '.']);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 12, 3)).toEqual(['.', '.', '.']);
    expect(document.tileData.terrain[10]![10]).toBeGreaterThan(0);
  });

  it('overlays Cyber A10 on the ZBBZ sockets beside a stepped hole', () => {
    const hole = new Set(['11,9']);
    const cells = [
      ...rectangle(10, 8, 3, 1),
      ...rectangle(10, 9, 4, 2).filter((cell) => !hole.has(`${cell.x},${cell.y}`)),
    ];
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect(tileToken(document.tileData.foreground[9]![12]!, 'cyber-yellow')).toBe('9Y');
    expect(tileToken(document.tileData.foreground[10]![12]!, 'cyber-yellow')).toBe('9XY');
    expect(['21', '23']).toContain(
      tileToken(document.tileData.terrain[9]![12]!, 'cyber-yellow').replace(/[XY]+$/, ''),
    );
    expect(['15', '16', '34', '62']).toContain(
      tileToken(document.tileData.terrain[10]![12]!, 'cyber-yellow').replace(/[XY]+$/, ''),
    );
    expectCollision(document, 12, 9);
    expectCollision(document, 12, 10);
  });

  it('overlays Cyber A10 on fill next to paired 1-cell tunnels', () => {
    const holes = new Set(['12,10', '14,10']);
    const cells = rectangle(10, 8, 7, 5).filter((cell) => !holes.has(`${cell.x},${cell.y}`));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect(tileToken(document.tileData.foreground[9]![13]!, 'cyber-yellow')).toBe('9');
    expect(tileToken(document.tileData.foreground[11]![13]!, 'cyber-yellow')).toBe('9Y');
    expect(tileToken(document.tileData.foreground[9]![11]!, 'cyber-yellow')).toBe('9');
  });

  it('overlays Cyber A10 on U-notch inner corners', () => {
    const notch = new Set(['12,8', '13,8']);
    const cells = rectangle(10, 8, 6, 4).filter((cell) => !notch.has(`${cell.x},${cell.y}`));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect(tileToken(document.tileData.foreground[9]![11]!, 'cyber-yellow')).toBe('9Y');
    expect(tileToken(document.tileData.foreground[9]![14]!, 'cyber-yellow')).toBe('9XY');
  });

  it('overlays Cyber A10 where a hole sits beside a top-right cut-out', () => {
    const omitted = new Set(['15,7', '12,9', '14,9']);
    const cells = rectangle(10, 7, 6, 5).filter((cell) => !omitted.has(`${cell.x},${cell.y}`));
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    expect(tileToken(document.tileData.foreground[8]![11]!, 'cyber-yellow')).toBe('9');
    expect(tileToken(document.tileData.foreground[8]![13]!, 'cyber-yellow')).toBe('9');
    expect(tileToken(document.tileData.foreground[8]![14]!, 'cyber-yellow')).toBe('9Y');
    expect(tileToken(document.tileData.foreground[10]![11]!, 'cyber-yellow')).toBe('9Y');
  });

  it('keeps tile 37 on every Window end of a stacked band', () => {
    let document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', rectangle(8, 6, 8, 6));
    document = paint(document, 'cyber.windows', 'cyber-yellow', rectangle(8, 7, 8, 4));

    for (const y of [7, 8, 9, 10]) {
      expect(localIndexAt(document, 'terrain', 'cyber-yellow', 11, y)).toBe(38);
      expect(localIndexAt(document, 'terrain', 'cyber-yellow', 8, y)).toBe(37);
      expect(localIndexAt(document, 'terrain', 'cyber-yellow', 15, y)).toBe(37);
    }
  });

  it('paints a 3x3 Shell blob with 54, 66, 27, and 53', () => {
    const document = paint(emptyDocument(), 'cyber.shell', 'cyber-yellow', rectangle(9, 9, 3, 3));
    const used = rectangle(9, 9, 3, 3).map(({ x, y }) => localIndexAt(document, 'terrain', 'cyber-yellow', x, y));
    expect(used.every((index) => [26, 27, 28, 40, 42, 52, 53, 54, 66, 79].includes(index))).toBe(true);
    expect([53, 40]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 10, 10));
    expect([27, 28]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 10, 9));
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 11, 10)).toBe(54);
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 11, 11)).toBe(66);
  });

  it('uses 79Y, 52Y, and 26Y on a bottom-right Shell triangle across Concrete', () => {
    const shell = new Set([
      '17,9',
      '16,10', '17,10',
      '15,11', '16,11', '17,11',
      '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const cells = rectangle(10, 7, 8, 6).map((cell) => ({
      x: cell.x,
      y: cell.y,
    }));
    let document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);
    document = paint(
      document,
      'cyber.shell',
      'cyber-yellow',
      cells.filter((cell) => shell.has(`${cell.x},${cell.y}`)),
    );
    expect(tileToken(document.tileData.terrain[9]![17]!, 'cyber-yellow')).toBe('79Y');
    expect(tileToken(document.tileData.terrain[12]![13]!, 'cyber-yellow')).toBe('26Y');
    expect(tileToken(document.tileData.terrain[10]![16]!, 'cyber-yellow')).toBe('52Y');
    expect(tileToken(document.tileData.terrain[11]![15]!, 'cyber-yellow')).toBe('52Y');
  });

  it('uses 29X where a Shell stair meets the top Concrete edge, and 17 on the outer void corner', () => {
    const topSeam = new Set([
      '14,7', '15,7', '16,7', '17,7',
      '13,8', '14,8', '15,8', '16,8', '17,8',
      '12,9', '13,9', '14,9', '15,9', '16,9', '17,9',
      '11,10', '12,10', '13,10', '14,10', '15,10', '16,10', '17,10',
      '10,11', '11,11', '12,11', '13,11', '14,11', '15,11', '16,11', '17,11',
      '10,12', '11,12', '12,12', '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const corner = new Set([
      '17,7',
      '16,8', '17,8',
      '15,9', '16,9', '17,9',
      '14,10', '15,10', '16,10', '17,10',
      '13,11', '14,11', '15,11', '16,11', '17,11',
      '12,12', '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const cells = rectangle(10, 7, 8, 6);
    let document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);
    document = paint(
      document,
      'cyber.shell',
      'cyber-yellow',
      cells.filter((cell) => topSeam.has(`${cell.x},${cell.y}`)),
    );
    expect(tileToken(document.tileData.terrain[7]![14]!, 'cyber-yellow')).toBe('29X');

    document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);
    document = paint(
      document,
      'cyber.shell',
      'cyber-yellow',
      cells.filter((cell) => corner.has(`${cell.x},${cell.y}`)),
    );
    expect(tileToken(document.tileData.terrain[7]![17]!, 'cyber-yellow')).toBe('17');
  });

  it('uses 29 and 17X on the opposite Shell diagonal at the top edge', () => {
    const topSeam = new Set([
      '10,7', '11,7', '12,7', '13,7',
      '10,8', '11,8', '12,8', '13,8', '14,8',
      '10,9', '11,9', '12,9', '13,9', '14,9', '15,9',
      '10,10', '11,10', '12,10', '13,10', '14,10', '15,10', '16,10',
      '10,11', '11,11', '12,11', '13,11', '14,11', '15,11', '16,11', '17,11',
      '10,12', '11,12', '12,12', '13,12', '14,12', '15,12', '16,12', '17,12',
    ]);
    const corner = new Set([
      '10,7',
      '10,8', '11,8',
      '10,9', '11,9', '12,9',
      '10,10', '11,10', '12,10', '13,10',
      '10,11', '11,11', '12,11', '13,11', '14,11',
      '10,12', '11,12', '12,12', '13,12', '14,12', '15,12',
    ]);
    const cells = rectangle(10, 7, 8, 6);
    let document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);
    document = paint(
      document,
      'cyber.shell',
      'cyber-yellow',
      cells.filter((cell) => topSeam.has(`${cell.x},${cell.y}`)),
    );
    expect(tileToken(document.tileData.terrain[7]![13]!, 'cyber-yellow')).toBe('29');

    document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);
    document = paint(
      document,
      'cyber.shell',
      'cyber-yellow',
      cells.filter((cell) => corner.has(`${cell.x},${cell.y}`)),
    );
    expect(tileToken(document.tileData.terrain[7]![10]!, 'cyber-yellow')).toBe('17X');
  });

  it('uses 78 where two Shell stairs meet beside a 1-high Concrete tip', () => {
    const concrete = new Set([
      '10,8', '11,8', '12,8',
      '10,9', '11,9', '12,9', '13,9',
      '10,10', '11,10', '12,10',
    ]);
    const cells = rectangle(10, 7, 8, 6);
    let document = paint(emptyDocument(), 'cyber.shell', 'cyber-yellow', cells);
    document = paint(
      document,
      'cyber.concrete',
      'cyber-yellow',
      cells.filter((cell) => concrete.has(`${cell.x},${cell.y}`)),
    );
    expect(tileToken(document.tileData.terrain[9]![14]!, 'cyber-yellow')).toBe('78');
  });

  it('does not overlay Cyber A10 on 1-wide nubs', () => {
    const cells = [
      ...rectangle(10, 8, 6, 6),
      { x: 16, y: 9 },
      { x: 16, y: 11 },
      { x: 9, y: 9 },
      { x: 9, y: 11 },
      { x: 12, y: 7 },
      { x: 14, y: 7 },
      { x: 12, y: 14 },
      { x: 14, y: 14 },
    ];
    const document = paint(emptyDocument(), 'cyber.concrete', 'cyber-yellow', cells);

    for (const y of [7, 8, 9, 10, 11, 12, 13, 14]) {
      for (const x of [9, 10, 12, 14, 15, 16]) {
        expect(tileToken(document.tileData.foreground[y]![x]!, 'cyber-yellow')).toBe('.');
      }
    }
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
      'cyber.concrete',
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
      'cyber.concrete',
      'cyber-yellow',
      [{ x: 9, y: 7 }],
    );
    expect(localIndexAt(document, 'terrain', 'cyber-yellow', 9, 7)).toBe(20);
    expect(document.tileData.terrain[7]![8]).toBe(mismatched.terrain[7]![8]);
    expect(document.tileData.terrain[7]![10]).toBe(mismatched.terrain[7]![10]);

    const structureData = createEmptyTileData();
    for (const [dx, dy] of [
      [0, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
    ]) {
      structureData.terrain[12 + dy]![20 + dx] = yellow.firstGid + 64;
    }
    document = paint(
      { tileData: structureData, smartTerrain: createRoomSmartTerrainState() },
      'cyber.concrete',
      'cyber-yellow',
      [{ x: 20, y: 12 }],
    );
    expect([11, 33, 35]).toContain(localIndexAt(document, 'terrain', 'cyber-yellow', 20, 12));
    expect(tileToken(document.tileData.foreground[12]![20]!, 'cyber-yellow')).toBe('9Y');
  });

  it('preserves full X, Y, and XY locked values through neighboring re-resolution', () => {
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    let document = paint(
      emptyDocument(),
      'cyber.concrete',
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
    document = paint(document, 'cyber.concrete', 'cyber-yellow', neighboringCells);
    document = resolveSmartRecipeDocument(document);

    expect(document.tileData.terrain[4]!.slice(4, 7)).toEqual(locked);
    expect(document.smartTerrain.semanticCells['terrain:4,4']?.lockedValue).toBe(locked[0]);
    expect(document.smartTerrain.semanticCells['terrain:5,4']?.lockedValue).toBe(locked[1]);
    expect(document.smartTerrain.semanticCells['terrain:6,4']?.lockedValue).toBe(locked[2]);
    expect(decodeTileDataValue(locked[0]!)).toMatchObject({ flipX: true, flipY: false });
    expect(decodeTileDataValue(locked[1]!)).toMatchObject({ flipX: false, flipY: true });
    expect(decodeTileDataValue(locked[2]!)).toMatchObject({ flipX: true, flipY: true });
  });

  it('repairs a letter-matched Structure outline without stale shape locks', () => {
    const filledCells = rectangle(10, 10, 3, 3);
    const outlineCells = filledCells.filter(({ x, y }) => !(x === 11 && y === 11));
    let document = applySmartBrushOutlineCells(emptyDocument(), {
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
      filledCells,
      outlineCells,
    });
    const corners = [
      { x: 10, y: 10 }, { x: 12, y: 10 },
      { x: 10, y: 12 }, { x: 12, y: 12 },
    ];
    expect(corners.every(({ x, y }) => (
      document.smartTerrain.semanticCells[smartSemanticCellKey('terrain', x, y)]?.shapeValue === undefined
    ))).toBe(true);

    document = erase(
      document,
      'cyber.concrete',
      'cyber-yellow',
      [{ x: 11, y: 11 }],
    );
    corners.forEach(({ x, y }) => expectCollision(document, x, y));
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 10, 3)).toEqual([
      '.', '.', '.',
    ]);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 12, 3)).toEqual([
      '.', '.', '.',
    ]);
    expect(corners.every(({ x, y }) => (
      document.smartTerrain.semanticCells[smartSemanticCellKey('terrain', x, y)]?.shapeValue === undefined
    ))).toBe(true);

    document = paint(
      document,
      'cyber.concrete',
      'cyber-yellow',
      [{ x: 11, y: 11 }],
    );
    expect(corners.map(({ x, y }) => tileToken(
      document.tileData.terrain[y]![x]!, 'cyber-yellow',
    ))).toEqual(['14', '14X', '25Y', '30Y']);
    expect(rowTokens(document, 'foreground', 'cyber-yellow', 10, 10, 3)).toEqual(['.', '.', '.']);
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

  it('keeps recipe macros invisible until their minimum width becomes valid', () => {
    const isolatedConcrete = paint(
      emptyDocument(),
      'cyber.concrete',
      'cyber-yellow',
      [{ x: 2, y: 2 }],
    );
    expect(rowTokens(isolatedConcrete, 'terrain', 'cyber-yellow', 2, 2, 1)).toEqual(['20']);
    expect(Object.values(isolatedConcrete.smartTerrain.recipes)).toEqual([]);

    let neon = paint(
      emptyDocument(),
      'cyber.neon',
      'cyber-yellow',
      horizontal(5, 5, 2),
    );
    expect(rowTokens(neon, 'terrain', 'cyber-yellow', 5, 5, 2)).toEqual(['.', '.']);
    neon = paint(neon, 'cyber.neon', 'cyber-yellow', [{ x: 7, y: 5 }]);
    expect(rowTokens(neon, 'terrain', 'cyber-yellow', 5, 5, 3)).toEqual(['49', '50', '51']);

    let panel = paint(
      emptyDocument(),
      'cyber.fence',
      'cyber-pink',
      horizontal(10, 8, 2),
    );
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 8, 2)).toEqual(['.', '.']);
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 9, 2)).toEqual(['.', '.']);
    panel = paint(panel, 'cyber.fence', 'cyber-pink', [{ x: 12, y: 8 }]);
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 8, 3)).toEqual(['44', '45', '46']);
    expect(rowTokens(panel, 'foreground', 'cyber-pink', 10, 9, 3)).toEqual(['56', '57', '58']);
  });

  it('suppresses one panel part and erases the whole recipe from either row', () => {
    let document = paint(
      emptyDocument(),
      'cyber.fence',
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
      'cyber.fence',
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
      'cyber.fence',
      'cyber-yellow',
      horizontal(2, 4, 3),
    );
    document = paint(document, 'cyber.fence', 'cyber-yellow', horizontal(6, 4, 3));
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
      'cyber.fence',
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
      'cyber.fence',
      'cyber-yellow',
      horizontal(10, 5, 5),
    );
    document = paint(document, 'cyber.fence', 'cyber-pink', horizontal(12, 5, 5));

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

  it('keeps Framed Panel neutral even when the legacy Details flag is enabled', () => {
    const first = paint(
      emptyDocument(true),
      'cyber.fence',
      'cyber-yellow',
      horizontal(4, 4, 7),
    );
    const second = resolveSmartRecipeDocument(first);
    const bottom = rowTokens(first, 'foreground', 'cyber-yellow', 4, 5, 7);
    const moved = paint(
      emptyDocument(true),
      'cyber.fence',
      'cyber-yellow',
      horizontal(20, 11, 7),
    );
    const movedBottom = rowTokens(moved, 'foreground', 'cyber-yellow', 20, 12, 7);

    expect(bottom).toEqual(['56', '57', '57', '57', '57', '57', '58']);
    expect(movedBottom).toEqual(bottom);
    expect(second).toEqual(first);
  });

  it('keeps a manually erased primary source connected while suppressing only that output part', () => {
    let document = paint(
      emptyDocument(),
      'cyber.concrete',
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
    expect(tileToken(document.tileData.terrain[8]![8]!, 'cyber-yellow')).toBe('71X');
    expect(tileToken(document.tileData.terrain[8]![10]!, 'cyber-yellow')).toBe('71');

    document = paint(
      document,
      'cyber.concrete',
      'cyber-yellow',
      [{ x: 9, y: 8 }],
    );
    expect(document.smartTerrain.suppressedOutputParts).not.toContain(
      'cyber:cell:terrain:9,8:primary',
    );
    expect(document.tileData.terrain[8]![9]).toBeGreaterThan(0);
  });

  it('keeps optional Cyber decoration disabled while base shapes are being tuned', () => {
    const cells = rectangle(0, 0, 16, 8);
    const first = paint(
      emptyDocument(true),
      'cyber.concrete',
      'cyber-yellow',
      cells,
    );
    const second = paint(
      emptyDocument(true),
      'cyber.concrete',
      'cyber-yellow',
      [...cells].reverse(),
    );
    const details = Object.values(first.smartTerrain.ownedOutputs).filter(({ partId }) => partId === 'detail');
    expect(first.tileData).toEqual(second.tileData);
    expect(first.smartTerrain.ownedOutputs).toEqual(second.smartTerrain.ownedOutputs);
    expect(details).toEqual([]);
    expect(resolveSmartRecipeDocument(first)).toEqual(first);
  });

  it('round-trips normalized and cloned state without changing recipes, locks, or outputs', () => {
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    let document = paint(
      emptyDocument(true),
      'cyber.concrete',
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
    document = paint(document, 'cyber.fence', 'cyber-pink', horizontal(12, 4, 4));

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
