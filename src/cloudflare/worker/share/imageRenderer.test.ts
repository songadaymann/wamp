import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { renderApiCard, renderApiExpandedCard } from '../../../rendering/roomRenderers.testHarness';
import { encodePng } from '../../../utils/pngEncoder';

const fixtureRoom = (name: string): RoomSnapshot => JSON.parse(
  readFileSync(`test/fixtures/smart-autotiling/references/${name}.room.json`, 'utf8'),
).snapshot as RoomSnapshot;

async function decodedPixelHash(image: Awaited<ReturnType<typeof renderApiCard>>): Promise<string> {
  expect([image.width, image.height]).toEqual([1200, 630]);
  return createHash('sha256').update(image.pixels).digest('hex');
}

// F269/F389 intentionally change the drawing. These pins record the corrected real-art
// pixels, independently covered by game-renderer equivalence tests. Renderer versions
// are now Wamp-O-Gram 2 and Pages assets-v6, so existing crawlers can refresh their images.
describe('API share preview PNGs (F332)', () => {
  it('draws the corrected real-art pixels in a compressed PNG', async () => {
    const defaultCard = await renderApiCard(createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }));
    const desertCard = await renderApiCard(fixtureRoom('desert-x-7-y-3'));

    expect(await decodedPixelHash(defaultCard)).toBe('723a75d7b0f65554136e9e7c520e064cee2f0252fbd044ae04a2213cb511a7b4');
    expect(await decodedPixelHash(desertCard)).toBe('38c388aff5f5fa8a288f063cea4dffa3922e115f9cf7a8b052c7aa6e3c124392');
    expect((await encodePng(defaultCard.width, defaultCard.height, defaultCard.pixels)).length).toBeLessThan(100_000);
    expect((await encodePng(desertCard.width, desertCard.height, desertCard.pixels)).length).toBeLessThan(200_000);
  });

  it('draws the corrected Expanded Room pixels in a compressed PNG', async () => {
    const card = await renderApiExpandedCard([
      { snapshot: fixtureRoom('desert-x-7-y-3'), coordinates: { x: 0, y: 0 } },
      { snapshot: fixtureRoom('cave-x-3-y-2'), coordinates: { x: 1, y: 0 } },
    ]);

    expect(await decodedPixelHash(card)).toBe('f912f7546f9a06d6f23e8bba9cf6bc6cb5190f108df21ceaa86c94802ed1a6f0');
    expect((await encodePng(card.width, card.height, card.pixels)).length).toBeLessThan(200_000);
  });
});
