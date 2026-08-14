import { describe, expect, it, vi } from 'vitest';
import type { CustomSpriteDefinition } from '../../customSprites/model';
import { selectCustomSpriteTileForCourseRoom } from './customSpriteTiles';

const SPRITE: CustomSpriteDefinition = {
  id: 'sprite_test',
  name: 'Test',
  size: 16,
  kind: 'decoration',
  pixels: Array.from({ length: 256 }, () => '#ffffff'),
  status: 'active',
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
};

describe('selectCustomSpriteTileForCourseRoom', () => {
  it('requires a selected expanded-room cell', () => {
    expect(selectCustomSpriteTileForCourseRoom(SPRITE, null)).toEqual({
      selected: false,
      statusText: 'Select an expanded-room cell before saving a tile.',
    });
  });

  it('blocks read-only cells before mutating their runtime', () => {
    const useCustomSpriteAsTile = vi.fn(() => true);
    const result = selectCustomSpriteTileForCourseRoom(SPRITE, {
      canSaveDraft: false,
      label: '2,3',
      useCustomSpriteAsTile,
    });

    expect(result.selected).toBe(false);
    expect(result.statusText).toContain('read-only');
    expect(useCustomSpriteAsTile).not.toHaveBeenCalled();
  });

  it('selects the tile through the chosen cell runtime', () => {
    const useCustomSpriteAsTile = vi.fn(() => true);
    const result = selectCustomSpriteTileForCourseRoom(SPRITE, {
      canSaveDraft: true,
      label: '2,3',
      useCustomSpriteAsTile,
    });

    expect(result).toEqual({
      selected: true,
      statusText: 'Saved as tile in 2,3. Click in that room to paint it.',
    });
    expect(useCustomSpriteAsTile).toHaveBeenCalledWith(SPRITE);
  });

  it('preserves the runtime error when tile selection fails', () => {
    expect(selectCustomSpriteTileForCourseRoom(SPRITE, {
      canSaveDraft: true,
      label: '2,3',
      useCustomSpriteAsTile: () => false,
    })).toEqual({ selected: false, statusText: null });
  });
});
