import { describe, expect, it } from 'vitest';
import { drawCustomRoomTileToContext } from '../customTiles/draw';
import { BLOCKED_ART_COLOR, isCustomSpriteBlocked, onBlockedCustomSpritesChanged, setBlockedCustomSpriteIds } from './blocklist';

describe('blocked community sprites (F189)', () => {
  it('reports only the sprites whose blocked state changed', () => {
    const changes: string[][] = [];
    onBlockedCustomSpritesChanged((changed) => changes.push([...changed].sort()));
    setBlockedCustomSpriteIds(['a', 'b']);
    setBlockedCustomSpriteIds(['b', 'a']);
    setBlockedCustomSpriteIds(['b', 'c']);
    expect(changes).toEqual([['a', 'b'], ['a', 'c']]);
    expect(isCustomSpriteBlocked('c')).toBe(true);
    expect(isCustomSpriteBlocked('a')).toBe(false);
    expect(isCustomSpriteBlocked(null)).toBe(false);
    setBlockedCustomSpriteIds([]);
  });

  it('draws a tile made from a blocked sprite as a flat placeholder', () => {
    const fills: Array<{ style: string; rect: number[] }> = [];
    const context = { fillStyle: '' } as { fillStyle: string; fillRect(...rect: number[]): void };
    context.fillRect = (...rect: number[]) => { fills.push({ style: context.fillStyle, rect }); };
    const tile = {
      id: 't1', name: 't1', pixels: ['#ff0000', '#00ff00'], collision: 'solid' as const,
      sourceSpriteId: 'vandal-art', createdAt: '', updatedAt: '',
    };
    setBlockedCustomSpriteIds(['vandal-art']);
    drawCustomRoomTileToContext(context as unknown as CanvasRenderingContext2D, tile, 4, 8, 16);
    expect(fills).toEqual([{ style: BLOCKED_ART_COLOR, rect: [4, 8, 16, 16] }]);

    fills.length = 0;
    setBlockedCustomSpriteIds([]);
    drawCustomRoomTileToContext(context as unknown as CanvasRenderingContext2D, tile, 4, 8, 16);
    expect(fills.map((fill) => fill.style)).toEqual(['#ff0000', '#00ff00']);
  });
});
