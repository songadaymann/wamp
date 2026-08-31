import { describe, expect, it } from 'vitest';
import { applySmartBrushCells, applySmartBrushOutlineCells, type SmartRecipeDocument } from './recipeSolver';
import { createRoomSmartTerrainState } from './model';
import { ROOM_HEIGHT, ROOM_WIDTH } from '../config/room';
import { decodeTileDataValue } from '../config/editorState';
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

function localIndex(document: SmartRecipeDocument, x: number, y: number): number {
  const gid = decodeTileDataValue(document.tileData.terrain[y]![x]!).gid;
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

  it('routes Neon through its minimum-width horizontal recipe', () => {
    let document = applySmartBrushCells(emptyDocument(), {
      cells: [{ x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }, { x: 7, y: 8 }],
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    document = applySmartBrushCells(document, {
      cells: [{ x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }],
      mode: 'paint',
      brushId: 'cyber.neon',
      styleId: 'cyber-yellow',
    });
    expect(document.smartTerrain.semanticCells['terrain:4,8']).toBeUndefined();
    expect(Object.values(document.smartTerrain.recipes)).toContainEqual(expect.objectContaining({
      brushId: 'cyber.neon',
      sourceCells: [
        { layer: 'terrain', x: 4, y: 8 },
        { layer: 'terrain', x: 5, y: 8 },
        { layer: 'terrain', x: 6, y: 8 },
      ],
    }));
    expect(localIndex(document, 4, 8)).toBe(49);
    expect(localIndex(document, 5, 8)).toBe(50);
    expect(localIndex(document, 6, 8)).toBe(51);
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

  it('re-rolls catalog variety when the same concrete brush is painted again', () => {
    let document = applySmartBrushCells(emptyDocument(), {
      cells: Array.from({ length: 24 }, (_, index) => ({
        x: 4 + (index % 6),
        y: 6 + Math.floor(index / 6),
      })),
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    const first = localIndex(document, 6, 7);
    document = applySmartBrushCells(document, {
      cells: [{ x: 6, y: 7 }],
      mode: 'paint',
      brushId: 'cyber.concrete',
      styleId: 'cyber-yellow',
    });
    expect(document.smartTerrain.semanticCells['terrain:6,7']?.varietySalt).toBe(1);
    const seen = new Set<number>([first]);
    for (let step = 0; step < 8; step += 1) {
      document = applySmartBrushCells(document, {
        cells: [{ x: 6, y: 7 }],
        mode: 'paint',
        brushId: 'cyber.concrete',
        styleId: 'cyber-yellow',
      });
      seen.add(localIndex(document, 6, 7));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
