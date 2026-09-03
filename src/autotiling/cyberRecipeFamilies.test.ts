import { describe, expect, it } from 'vitest';
import {
  getCyberFamilyId,
  isCyberSpanBrushId,
  isCyberStyleId,
} from './cyberRecipeFamily';
import { resolveCyberRubbleBorderPlacements } from './cyberRubbleResolver';
import {
  resolveCyberFramedPanelTiles,
  resolveCyberHorizontalMiddleTile,
  resolveCyberLinearFamilyTiles,
} from './cyberSpanResolver';

describe('Cyber recipe families', () => {
  it('keeps brush classification outside the document coordinator', () => {
    expect(getCyberFamilyId('cyber.concrete')).toBe('structure');
    expect(getCyberFamilyId('cyber.support')).toBe('support');
    expect(isCyberSpanBrushId('cyber.neon')).toBe(false);
    expect(isCyberSpanBrushId('cyber.rubble')).toBe(false);
    expect(isCyberStyleId('cyber-pink')).toBe(true);
    expect(isCyberStyleId('forest')).toBe(false);
  });

  it('resolves span and panel art without mutating a room document', () => {
    expect(resolveCyberLinearFamilyTiles('platform', 'cyber-yellow', 4).map((tile) => ({
      localIndex: tile.localIndex,
      flipX: tile.flipX,
    }))).toEqual([
      { localIndex: 71, flipX: true },
      { localIndex: 68, flipX: false },
      { localIndex: 68, flipX: false },
      { localIndex: 71, flipX: false },
    ]);
    expect(resolveCyberHorizontalMiddleTile('neon-strip', 'cyber-yellow', 6).localIndex).toBe(50);
    expect(resolveCyberFramedPanelTiles('cyber-pink', 3).map((row) => (
      row.map(({ localIndex }) => localIndex)
    ))).toEqual([[44, 45, 46], [56, 57, 58]]);
  });

  it('maps rubble topology to owned border parts independently', () => {
    expect(resolveCyberRubbleBorderPlacements({
      above: false, right: false, below: true, left: false,
    })).toEqual([{ part: 'top' }]);
    expect(resolveCyberRubbleBorderPlacements({
      above: true, right: false, below: true, left: true,
    })).toEqual([
      { part: 'topLeft', flipX: true },
      { part: 'bottom', layer: 'background' },
    ]);
    expect(resolveCyberRubbleBorderPlacements({
      above: true, right: true, below: true, left: true,
    })).toEqual([]);
  });
});
