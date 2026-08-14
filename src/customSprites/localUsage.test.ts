import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../persistence/roomModel';
import { isCustomSpriteUsedInLocalRoomStorage } from './localUsage';

describe('isCustomSpriteUsedInLocalRoomStorage', () => {
  it('checks current local drafts and ignores unrelated or malformed entries', () => {
    const room = createDefaultRoomSnapshot('2,3', { x: 2, y: 3 });
    room.placedObjects = [{ instanceId: 'kept-1', id: 'custom_sprite:kept', x: 16, y: 16 }];
    const storage = createStorage({
      unrelated: 'kept',
      'everybodys-platformer:room:bad': '{not-json',
      'everybodys-platformer:room:2,3': JSON.stringify({ draft: room, published: null }),
    });

    expect(isCustomSpriteUsedInLocalRoomStorage('kept', storage)).toBe(true);
    expect(isCustomSpriteUsedInLocalRoomStorage('unused', storage)).toBe(false);
  });
});

function createStorage(entries: Record<string, string>): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
