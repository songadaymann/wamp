import { describe, expect, it } from 'vitest';
import { SmartTileController, type SmartTileEditorSelection } from './smartTileController';

describe('SmartTileController', () => {
  it('reads live selection state and owns constrained gesture anchors', () => {
    let selection: SmartTileEditorSelection = {
      brushId: 'cyber.neon',
      styleId: 'cyber-yellow',
    };
    const controller = new SmartTileController(() => selection);
    const first = controller.normalizeStrokeCell({ x: 3, y: 4 }, null);
    expect(first).toEqual({ cell: { x: 3, y: 4 }, anchor: null });
    expect(controller.normalizeStrokeCell({ x: 8, y: 9 }, first.anchor)).toEqual({
      cell: { x: 8, y: 9 },
      anchor: null,
    });

    selection = { brushId: 'forest.ground', styleId: 'forest' };
    expect(controller.normalizeStrokeCell({ x: 8, y: 9 }, first.anchor)).toEqual({
      cell: { x: 8, y: 9 },
      anchor: null,
    });
  });

  it('uses registry rectangle behavior instead of tileset-specific editor branches', () => {
    let selection: SmartTileEditorSelection = {
      brushId: 'cyber.fence',
      styleId: 'cyber-pink',
      sourceLayer: 'background',
    };
    const controller = new SmartTileController(() => selection);
    expect(controller.getRectangleCells(1, 6, 3, 9)).toBeNull();
    selection = { brushId: 'cyber.support', styleId: 'cyber-pink' };
    expect(controller.getRectangleCells(1, 6, 2, 7)).toEqual([
      { x: 1, y: 6 }, { x: 1, y: 7 }, { x: 2, y: 6 }, { x: 2, y: 7 },
    ]);
  });
});
