import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../../pages/roomImagePrimitives';
import { createDefaultRoomSnapshot, type RoomSnapshot } from '../../../persistence/roomModel';
import { renderExpandedRoomSharePreviewPng, renderRoomSharePreviewPng } from './roomPreviewImage';

const fixtureRoom = (name: string): RoomSnapshot => JSON.parse(
  readFileSync(`test/fixtures/smart-autotiling/references/${name}.room.json`, 'utf8'),
).snapshot as RoomSnapshot;

async function decodedPixelHash(png: Uint8Array): Promise<string> {
  const image = await decodePng(png);
  expect([image.width, image.height]).toEqual([1200, 630]);
  return createHash('sha256').update(image.pixels).digest('hex');
}

// Hashes of the decoded pixels from the uncompressed 3 MB encoder before F332: compression must not
// change a single pixel. Update them only when the drawing itself changes on purpose.
describe('API share preview PNGs (F332)', () => {
  it('draws the same pixels as before in a compressed PNG', async () => {
    const defaultCard = await renderRoomSharePreviewPng(createDefaultRoomSnapshot('0,0', { x: 0, y: 0 }));
    const desertCard = await renderRoomSharePreviewPng(fixtureRoom('desert-x-7-y-3'));

    expect(await decodedPixelHash(defaultCard)).toBe('6944f1b545c71a448cd702bf6760deed1202206abe150392cf89a3d1afad86d8');
    expect(await decodedPixelHash(desertCard)).toBe('70fda5bcdfcbc852bba7c2fcbad2a3d7ec953ae434aa52b20b1b5b31a3b12c65');
    expect(defaultCard.length).toBeLessThan(20_000);
    expect(desertCard.length).toBeLessThan(40_000);
  });

  it('draws the same Expanded Room pixels as before in a compressed PNG', async () => {
    const card = await renderExpandedRoomSharePreviewPng([
      { snapshot: fixtureRoom('desert-x-7-y-3'), coordinates: { x: 0, y: 0 } },
      { snapshot: fixtureRoom('cave-x-3-y-2'), coordinates: { x: 1, y: 0 } },
    ]);

    expect(await decodedPixelHash(card)).toBe('94329ace92862ff8974979ce30cd607a44781092211198893409a588c15c8f65');
    expect(card.length).toBeLessThan(60_000);
  });
});
