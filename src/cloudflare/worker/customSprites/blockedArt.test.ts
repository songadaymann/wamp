import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomSpriteDefinition } from '../../../customSprites/model';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { fixture } from '../activity/testDatabase';
import { maskBlockedArtInSnapshots } from './blockedArt';

const NOW = '2026-10-21T12:00:00.000Z';
const sprite = (id: string): CustomSpriteDefinition => ({
  id, name: id, size: 16, kind: 'decoration', pixels: ['#ff0000', null], status: 'active', createdAt: NOW, updatedAt: NOW,
});
const roomWith = (id: string, sprites: string[]): RoomSnapshot => ({
  ...createDefaultRoomSnapshot(id, { x: Number(id.split(',')[0]), y: 0 }),
  customSprites: sprites.map(sprite),
});

let f: ReturnType<typeof fixture>;
beforeEach(() => {
  f = fixture(false);
  for (const [id, status] of [['vandal-art', 'blocked'], ['nice-art', 'active']]) {
    f.sqlite.prepare(`INSERT INTO custom_sprites (id, definition_json, name, normalized_name, kind, size, status, created_at, updated_at)
      VALUES (?, '{}', ?, ?, 'decoration', 16, ?, ?, ?)`).run(id, id, id, status, NOW, NOW);
  }
});
afterEach(() => f.sqlite.close());

describe('masking blocked community art in share and gram images (F189)', () => {
  it('masks every snapshot drawn together with one query', async () => {
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    const plain = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });
    const [vandal, nice, untouched] = await maskBlockedArtInSnapshots(f.env, [
      roomWith('1,0', ['vandal-art', 'nice-art']),
      roomWith('2,0', ['nice-art']),
      plain,
    ]);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(vandal.customSprites?.map((entry) => entry.status)).toEqual(['blocked', 'active']);
    expect(nice.customSprites?.map((entry) => entry.status)).toEqual(['active']);
    expect(untouched).toBe(plain);
  });

  it('skips the query when nothing embeds community art', async () => {
    const prepare = vi.spyOn(f.env.DB, 'prepare');
    const plain = createDefaultRoomSnapshot('0,0', { x: 0, y: 0 });

    expect(await maskBlockedArtInSnapshots(f.env, [plain])).toEqual([plain]);
    expect(prepare).not.toHaveBeenCalled();
  });
});
