import { describe, expect, it } from 'vitest';
import type { PlacedObject } from '../../config';
import { getPlacedObjectEditorDepth } from './documentPresentationController';

describe('editor document presentation', () => {
  it('preserves the editor depth contract for every object layer', () => {
    expect(getPlacedObjectEditorDepth(object())).toBe(25);
    expect(getPlacedObjectEditorDepth(object('terrain'))).toBe(25);
    expect(getPlacedObjectEditorDepth(object('background'))).toBe(5);
    expect(getPlacedObjectEditorDepth(object('foreground'))).toBe(60);
  });
});

function object(layer?: PlacedObject['layer']): PlacedObject {
  return {
    id: 'coin_gold',
    instanceId: 'coin-1',
    x: 16,
    y: 16,
    layer,
  };
}
