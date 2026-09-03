import { describe, expect, it } from 'vitest';
import { applySmartBrushCells, applySmartBrushOutlineCells, type SmartRecipeDocument } from './recipeSolver';
import { createRoomSmartTerrainState } from './model';
import { ROOM_HEIGHT, ROOM_WIDTH } from '../config/room';
import { decodeTileDataValue } from '../config/editorState';
import { CYBERCITY_EXTRAS_TILESET_FIRST_GID } from '../config/tilesets';
import { getSmartStyleDefinition } from './registry';

function emptyDocument(): SmartRecipeDocument {
  return {
    tileData: {
      background: Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => -1)),
      terrain: Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => -1)),
      foreground: Array.from({ length: ROOM_HEIGHT }, () => Array.from({ length: ROOM_WIDTH }, () => -1)),
    },
    smartTerrain: createRoomSmartTerrainState(),
  };
}

const EXTRAS_TO_SMART_NEON: Readonly<Record<number, number>> = { 0: 7, 1: 4, 2: 6, 12: 7, 13: 4, 14: 6 };

function localIndex(document: SmartRecipeDocument, x: number, y: number): number {
  const gid = decodeTileDataValue(document.tileData.terrain[y]![x]!).gid;
  const extrasLocal = gid - CYBERCITY_EXTRAS_TILESET_FIRST_GID;
  if (extrasLocal >= 0 && extrasLocal < 84 && EXTRAS_TO_SMART_NEON[extrasLocal] !== undefined) {
    return EXTRAS_TO_SMART_NEON[extrasLocal]!;
  }
  return gid - getSmartStyleDefinition('cyber-yellow').firstGid;
}

function decodedLocal(
  document: SmartRecipeDocument,
  layer: 'terrain' | 'foreground',
  x: number,
  y: number,
): { localIndex: number; flipX: boolean; flipY: boolean } {
  const decoded = decodeTileDataValue(document.tileData[layer][y]![x]!);
  return {
    localIndex: decoded.gid - getSmartStyleDefinition('cyber-yellow').firstGid,
    flipX: decoded.flipX,
    flipY: decoded.flipY,
  };
}

describe('cyber letter matcher wiring', () => {
  it('paints isolated concrete as the AAAA seed tile', () => {
    const document = applySmartBrushCells(emptyDocument(), {
      cells: [{ x: 5, y: 5 }],
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    expect(document.smartTerrain.semanticCells['terrain:5,5']?.brushId).toBe('cyber.concrete');
    expect(localIndex(document, 5, 5)).toBe(20);
  });

  it('stamps 49 on a Concrete edge and 51 inside a Concrete blob on the first Neon click', () => {
    const concrete = Array.from({ length: 30 }, (_, index) => ({
      x: 3 + (index % 6),
      y: 6 + Math.floor(index / 6),
    }));
    let document = applySmartBrushCells(emptyDocument(), {
      cells: concrete,
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    document = applySmartBrushCells(document, {
      cells: [{ x: 3, y: 8 }],
      mode: 'paint',
      brushId: 'cyber.neon',
      styleId: 'cyber-yellow',
    });
    expect(document.smartTerrain.semanticCells['terrain:3,8']?.brushId).toBe('cyber.neon');
    expect(Object.values(document.smartTerrain.recipes).some((recipe) => recipe.brushId === 'cyber.neon')).toBe(false);
    expect(localIndex(document, 3, 8)).toBe(49);

    document = applySmartBrushCells(document, {
      cells: [{ x: 5, y: 8 }],
      mode: 'paint',
      brushId: 'cyber.neon',
      styleId: 'cyber-yellow',
    });
    expect(localIndex(document, 5, 8)).toBe(51);
  });

  it('stamps 51 when Neon is painted in the void', () => {
    const document = applySmartBrushCells(emptyDocument(), {
      cells: [{ x: 8, y: 4 }],
      mode: 'paint',
      brushId: 'cyber.neon',
      styleId: 'cyber-yellow',
    });
    expect(localIndex(document, 8, 4)).toBe(51);
  });

  it('stamps 6 on a vertical Neon column in the void', () => {
    const document = applySmartBrushCells(emptyDocument(), {
      cells: [{ x: 8, y: 4 }, { x: 8, y: 5 }, { x: 8, y: 6 }],
      mode: 'paint',
      brushId: 'cyber.neon',
      styleId: 'cyber-yellow',
    });
    expect(localIndex(document, 8, 4)).toBe(7);
    expect(localIndex(document, 8, 5)).toBe(6);
    expect(localIndex(document, 8, 6)).toBe(7);
  });

  it('does not overlay Cyber A10 on a concrete ring or a plus', () => {
    const ring = applySmartBrushCells(emptyDocument(), {
      cells: [
        { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 },
        { x: 10, y: 11 }, { x: 12, y: 11 },
        { x: 10, y: 12 }, { x: 11, y: 12 }, { x: 12, y: 12 },
      ],
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    const plus = applySmartBrushCells(emptyDocument(), {
      cells: [
        { x: 11, y: 10 },
        { x: 10, y: 11 }, { x: 11, y: 11 }, { x: 12, y: 11 },
        { x: 11, y: 12 },
      ],
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    const block = applySmartBrushCells(emptyDocument(), {
      cells: Array.from({ length: 24 }, (_, index) => ({
        x: 4 + (index % 6),
        y: 6 + Math.floor(index / 6),
      })),
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    const firstGid = getSmartStyleDefinition('cyber-yellow').firstGid;
    const a10Count = (document: SmartRecipeDocument): number => (
      (['background', 'terrain', 'foreground'] as const)
        .flatMap((layer) => document.tileData[layer].flat())
        .filter((value) => {
          const gid = decodeTileDataValue(value).gid;
          return gid >= firstGid && gid - firstGid === 9;
        }).length
    );
    expect(a10Count(ring)).toBe(0);
    expect(a10Count(plus)).toBe(0);
    expect(a10Count(block)).toBe(0);
  });

  it('paints a rectangle outline as a hollow E-frame instead of inverted tunnel mids', () => {
    const outline = applySmartBrushOutlineCells(emptyDocument(), {
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
      filledCells: Array.from({ length: 40 }, (_, index) => ({
        x: 4 + (index % 8),
        y: 6 + Math.floor(index / 8),
      })),
      outlineCells: [
        ...[0, 1, 2, 3, 4, 5, 6, 7].flatMap((offset) => [
          { x: 4 + offset, y: 6 },
          { x: 4 + offset, y: 10 },
        ]),
        ...[7, 8, 9].flatMap((y) => [
          { x: 4, y },
          { x: 11, y },
        ]),
      ],
    });
    expect(decodedLocal(outline, 'terrain', 7, 6)).toEqual({
      localIndex: 68, flipX: false, flipY: false,
    });
    expect(decodedLocal(outline, 'terrain', 7, 10)).toEqual({
      localIndex: 68, flipX: false, flipY: false,
    });
    expect(localIndex(outline, 4, 8)).toBe(31);
    expect(localIndex(outline, 11, 8)).toBe(31);
    expect(localIndex(outline, 4, 6)).toBe(67);
    expect(outline.tileData.terrain[8]![7]).toBe(-1);
  });

  it('stamps unflipped 64 for interior concrete fill', () => {
    let document = applySmartBrushCells(emptyDocument(), {
      cells: Array.from({ length: 24 }, (_, index) => ({
        x: 4 + (index % 6),
        y: 6 + Math.floor(index / 6),
      })),
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    expect(decodedLocal(document, 'terrain', 6, 7)).toEqual({
      localIndex: 64, flipX: false, flipY: false,
    });
    document = applySmartBrushCells(document, {
      cells: [{ x: 6, y: 7 }],
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    expect([64, 82]).toContain(decodedLocal(document, 'terrain', 6, 7).localIndex);
  });

  it('stamps 83Y on the bottom-left of a Concrete NW / Shell SE square', () => {
    const ox = 10;
    const oy = 7;
    const cells = Array.from({ length: 16 }, (_, index) => ({
      x: ox + (index % 4),
      y: oy + Math.floor(index / 4),
    }));
    let document = applySmartBrushCells(emptyDocument(), {
      cells,
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    document = applySmartBrushCells(document, {
      cells: cells.filter((cell) => (cell.x - ox) + (cell.y - oy) >= 3),
      mode: 'paint',
      brushId: 'cyber.shell',
      styleId: 'cyber-yellow',
    });
    expect(decodedLocal(document, 'terrain', 10, 10)).toEqual({
      localIndex: 83, flipX: false, flipY: true,
    });
    expect(decodedLocal(document, 'terrain', 13, 7)).toEqual({
      localIndex: 17, flipX: false, flipY: false,
    });
  });

  it('keeps a Shell stair on 52 when the same brush is painted again', () => {
    const ox = 10;
    const oy = 7;
    const cells = Array.from({ length: 16 }, (_, index) => ({
      x: ox + (index % 4),
      y: oy + Math.floor(index / 4),
    }));
    let document = applySmartBrushCells(emptyDocument(), {
      cells,
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    document = applySmartBrushCells(document, {
      cells: cells.filter((cell) => (cell.x - ox) + (cell.y - oy) >= 3),
      mode: 'paint',
      brushId: 'cyber.shell',
      styleId: 'cyber-yellow',
    });
    expect(decodedLocal(document, 'terrain', 12, 8).localIndex).toBe(52);
    document = applySmartBrushCells(document, {
      cells: [{ x: 12, y: 8 }],
      mode: 'paint',
      brushId: 'cyber.shell',
      styleId: 'cyber-yellow',
    });
    expect(decodedLocal(document, 'terrain', 12, 8).localIndex).toBe(52);
  });
});
