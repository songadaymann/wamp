import { describe, expect, it } from 'vitest';
import { createEmptyTileData } from '../persistence/roomModel';
import { createRoomSmartTerrainState } from './model';
import {
  applyRegisteredSmartBrushCells,
  constrainRegisteredSmartBrushStroke,
  getRegisteredSmartBrushRectangleCells,
  getRegisteredSmartRecipeOwnerId,
  getRegisteredSmartSemanticOwnerId,
  isRegisteredSmartRecipeBrush,
} from './brushEngine';

function emptyDocument() {
  return {
    tileData: createEmptyTileData(),
    smartTerrain: createRoomSmartTerrainState(),
  };
}

describe('registered Smart brush engine', () => {
  it('dispatches legacy and recipe brushes without editor family checks', () => {
    const forest = applyRegisteredSmartBrushCells(emptyDocument(), {
      brushId: 'forest.ground',
      styleId: 'forest',
      cells: [{ x: 2, y: 3 }],
      mode: 'paint',
    });
    expect(forest.smartTerrain.semanticCells['terrain:2,3']).toMatchObject({
      brushId: 'forest.ground',
      styleId: 'forest',
    });

    const cyber = applyRegisteredSmartBrushCells(emptyDocument(), {
      brushId: 'cyber.support',
      styleId: 'cyber-yellow',
      cells: [{ x: 4, y: 5 }, { x: 4, y: 6 }],
      mode: 'paint',
    });
    expect(Object.values(cyber.smartTerrain.recipes)).toContainEqual(expect.objectContaining({
      brushId: 'cyber.support',
      styleId: 'cyber-yellow',
    }));
  });

  it('rejects a style that the registered brush does not support', () => {
    expect(() => applyRegisteredSmartBrushCells(emptyDocument(), {
      brushId: 'cyber.support',
      styleId: 'forest',
      cells: [{ x: 1, y: 1 }],
      mode: 'paint',
    })).toThrow(/does not support style/);
  });

  it('normalizes strokes and rectangles from registry metadata', () => {
    expect(constrainRegisteredSmartBrushStroke(
      'cyber.neon', { x: 8, y: 9 }, { x: 2, y: 3 },
    )).toEqual({ x: 8, y: 3 });
    expect(constrainRegisteredSmartBrushStroke(
      'cyber.support', { x: 8, y: 9 }, { x: 2, y: 3 },
    )).toEqual({ x: 2, y: 9 });
    expect(constrainRegisteredSmartBrushStroke(
      'forest.ground', { x: 8, y: 9 }, { x: 2, y: 3 },
    )).toEqual({ x: 8, y: 9 });

    expect(getRegisteredSmartBrushRectangleCells('cyber.fence', 5, 7, 2, 12)).toEqual([
      { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 },
    ]);
    expect(getRegisteredSmartBrushRectangleCells('cyber.support', 2, 3, 3, 4)).toEqual([
      { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 3 }, { x: 3, y: 4 },
    ]);
  });

  it('delegates semantic and recipe owner namespaces to the registered engine', () => {
    expect(getRegisteredSmartSemanticOwnerId('forest.ground', 'terrain:2,3')).toBe(
      'legacy-semantic:terrain:2,3',
    );
    expect(getRegisteredSmartSemanticOwnerId('cyber.support', 'background:2,3')).toBe(
      'cyber:cell:background:2,3',
    );
    expect(getRegisteredSmartRecipeOwnerId('cyber.support', 'support-1')).toBe(
      'cyber:recipe:support-1',
    );
    expect(() => getRegisteredSmartRecipeOwnerId('forest.ground', 'ground-1')).toThrow(
      /cannot own a recipe/,
    );
    expect(isRegisteredSmartRecipeBrush('cyber.support')).toBe(true);
    expect(isRegisteredSmartRecipeBrush('cave.feature')).toBe(false);
  });
});
