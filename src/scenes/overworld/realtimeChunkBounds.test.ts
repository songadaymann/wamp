import { describe, expect, it } from 'vitest';
import { realtimeChunkBounds } from './realtimeChunkBounds';

describe('realtime coverage independently of terrain streaming', () => {
  it('caps a large camera window to nine centered chunks without changing the input', () => {
    const terrain = { minChunkX: -4, maxChunkX: 4, minChunkY: -4, maxChunkY: 4 };
    expect(realtimeChunkBounds(terrain)).toEqual({ minChunkX: -1, maxChunkX: 1, minChunkY: -1, maxChunkY: 1 });
    expect(terrain.minChunkX).toBe(-4);
    expect(realtimeChunkBounds({ minChunkX: 7, maxChunkX: 13, minChunkY: -13, maxChunkY: -7 }))
      .toEqual({ minChunkX: 9, maxChunkX: 11, minChunkY: -11, maxChunkY: -9 });
  });
  it('keeps the local playing/editing room covered during a stale window or teleport', () => {
    expect(realtimeChunkBounds({ minChunkX: -2, maxChunkX: 2, minChunkY: -2, maxChunkY: 2 }, { x: -17, y: 33 }))
      .toEqual({ minChunkX: -4, maxChunkX: -2, minChunkY: 3, maxChunkY: 5 });
    expect(realtimeChunkBounds(null)).toBeNull();
    expect(realtimeChunkBounds({ minChunkX: 0, maxChunkX: 0, minChunkY: 0, maxChunkY: 0 }))
      .toEqual({ minChunkX: 0, maxChunkX: 0, minChunkY: 0, maxChunkY: 0 });
  });
});
