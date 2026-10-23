import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../persistence/roomModel';
import { maskBlockedCustomArt } from './blockedArt';
import { BLOCKED_ART_COLOR } from './blocklist';
import type { CustomSpriteDefinition } from './model';
import { createCustomSpriteCanvas } from './registry';

const NOW = '2026-10-23T00:00:00.000Z';
function sprite(id: string, status: CustomSpriteDefinition['status'] = 'active'): CustomSpriteDefinition {
  return {
    id, name: id, size: 16, kind: 'decoration', status, createdAt: NOW, updatedAt: NOW,
    pixels: Array.from({ length: 256 }, (_, index) => (index % 3 === 0 ? null : '#00ff00')),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('blocked community art', () => {
  it("replaces a blocked sprite's pixels in a room, leaving other sprites and the original alone", () => {
    const room: RoomSnapshot = { ...createDefaultRoomSnapshot('1,0', { x: 1, y: 0 }), customSprites: [sprite('vandal-art'), sprite('nice-art')] };
    const masked = maskBlockedCustomArt(room, new Set(['vandal-art']));
    expect(masked.customSprites?.[0]).toMatchObject({ id: 'vandal-art', status: 'blocked' });
    expect(new Set(masked.customSprites?.[0].pixels)).toEqual(new Set([BLOCKED_ART_COLOR]));
    expect(masked.customSprites?.[0].pixels).toHaveLength(256);
    expect(masked.customSprites?.[1]).toBe(room.customSprites?.[1]);
    expect(room.customSprites?.[0]).toMatchObject({ status: 'active', pixels: sprite('vandal-art').pixels });
  });

  it('draws a sprite marked blocked as the placeholder, even when the blocked list has not loaded', () => {
    const fills: Array<[string, number, number, number, number]> = [];
    const context = {
      imageSmoothingEnabled: true, fillStyle: '',
      clearRect: () => undefined,
      fillRect: (x: number, y: number, width: number, height: number) => { fills.push([context.fillStyle, x, y, width, height]); },
    };
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });

    createCustomSpriteCanvas(sprite('vandal-art', 'blocked'));
    expect(fills).toEqual([[BLOCKED_ART_COLOR, 0, 0, 16, 16]]);
    fills.length = 0;
    createCustomSpriteCanvas(sprite('nice-art'));
    expect(fills).toHaveLength(170);
    expect(new Set(fills.map(([color]) => color))).toEqual(new Set(['#00ff00']));
  });
});
