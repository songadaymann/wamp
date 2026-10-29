import { renderRoomImage } from '../../../roomImage/roomImageRenderer';
import { readFileSync, existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { decodePng } from '../../../roomImage/roomImagePrimitives';
import { encodePng } from '../../../utils/pngEncoder';
import { buildFeatureRoom, diffRasters, pixelAt, pixelHash, renderApiCard, renderApiExpandedCard,
  renderPagesCard, roomWith, renderCanvasRoom, installSoftwareBrowser } from '../../../rendering/roomRenderers.testHarness';
import type { Env } from '../core/types';
import { handleBackgroundImageRequest } from '../backgroundImages/routes';
import { renderExpandedRoomSharePreviewPng, renderRoomSharePreviewPng } from './imageRenderer';

vi.mock('../backgroundImages/routes', () => ({ handleBackgroundImageRequest: vi.fn() }));
const request = new Request('https://api.wamp.land/api/share/rooms/0%2C0/image');
const env = { ASSETS: { fetch: async (r: Request) => {
  const path = 'public' + new URL(r.url).pathname;
  return existsSync(path) ? new Response(new Uint8Array(readFileSync(path))) : new Response(null, { status: 404 });
} } } as Env;
beforeEach(() => vi.resetAllMocks());
beforeAll(() => installSoftwareBrowser());
afterAll(() => vi.unstubAllGlobals());

const solid = (color: string, id = 'room') => ({ ...createDefaultRoomSnapshot(id, { x: 0, y: 0 }), background: `solid:${color}` });

describe('API shares use the shared real-art painter', () => {
  it.each([
    ['complete feature room', buildFeatureRoom()],
    ['all tile layers and flips', roomWith(buildFeatureRoom(), { tiles: true, customTiles: true })],
    ['background tree and custom sprites', roomWith(buildFeatureRoom(), { objects: () => true })],
    ['starfield', createDefaultRoomSnapshot()],
    ['solid background', solid('#123456')],
  ] as const)('matches every Pages card pixel for %s', async (_name, snapshot) => {
    expect(diffRasters(await renderApiCard(snapshot), await renderPagesCard(snapshot)).count).toBe(0);
  });

  it.each(['none', 'desert', 'jungle_vines', 'spooky_moon', 'spooky_mountain'])(
    'uses canonical room-sized background pixels for %s, including repeat and base colour', async background => {
      const snapshot = { ...createDefaultRoomSnapshot('background-native', { x: -2, y: 3 }), background };
      const shared = await renderRoomImage(request, env, new URL(request.url), snapshot,
        { left: 0, top: 0, tileSize: 16 }, { width: 640, height: 352 }, false);
      const canonical = await renderCanvasRoom(snapshot, { tilePixelSize: 16 });
      expect(diffRasters(shared, canonical).count).toBe(0);
    });

  it('decodes Expanded Room uploads sequentially and evicts the previous cell photo', async () => {
    let active = 0, peak = 0;
    vi.mocked(handleBackgroundImageRequest).mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      const png = await encodePng(1, 1, new Uint8Array([80, 120, 160, 255]));
      active -= 1;
      return new Response(png.buffer as ArrayBuffer);
    });
    const cells = ['abcdefghA', 'abcdefghB', 'abcdefghA'].map((id, x) => ({ coordinates: { x, y: 0 },
      snapshot: { ...createDefaultRoomSnapshot(), background: `custom:${id}?fit=stretch` } }));
    const image = await decodePng(await renderExpandedRoomSharePreviewPng(cells, request, env));
    expect([image.width, image.height]).toEqual([1200, 630]);
    expect(peak).toBe(1);
    expect(handleBackgroundImageRequest).toHaveBeenCalledTimes(3);
  });

  it('loads an approved photo through the local handler with no HTTP self-fetch', async () => {
    vi.mocked(handleBackgroundImageRequest).mockImplementation(async () => new Response(
      (await encodePng(1, 1, new Uint8Array([80, 120, 160, 255]))).buffer as ArrayBuffer));
    const snapshot = { ...createDefaultRoomSnapshot(), background: 'custom:abcdefgh?fit=stretch' };
    const first = await decodePng(await renderRoomSharePreviewPng(snapshot, request, env));
    expect(pixelAt(first, 5, 5)).toEqual([80, 120, 160, 255]);
    expect(handleBackgroundImageRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleBackgroundImageRequest).mock.calls[0][1].pathname).toBe('/api/background-images/abcdefgh/image');
    // Approval is checked again for the next operation, even when the same upload was decoded before.
    vi.mocked(handleBackgroundImageRequest).mockRejectedValue(new Error('Unapproved upload'));
    const second = await decodePng(await renderRoomSharePreviewPng(snapshot, request, env));
    expect(pixelAt(second, 5, 5)).toEqual([5, 5, 5, 255]);
    expect(handleBackgroundImageRequest).toHaveBeenCalledTimes(2);
  });
});

describe('Expanded Room real-art composition', () => {
  it('uses the same single-room drawing for empty and one-cell inputs', async () => {
    const empty = await renderApiExpandedCard([]);
    expect(pixelHash(empty)).toBe(pixelHash(await renderApiCard(createDefaultRoomSnapshot())));
    const snapshot = buildFeatureRoom();
    expect(pixelHash(await renderApiExpandedCard([{ snapshot, coordinates: { x: -4, y: -3 } }]))).toBe(pixelHash(await renderApiCard(snapshot)));
  });

  it('keeps geometry, negative coordinates and footprint holes independent of input order', async () => {
    const cells = [
      { snapshot: solid('#ff0000'), coordinates: { x: -2, y: -2 } },
      { snapshot: solid('#00ff00'), coordinates: { x: -1, y: -2 } },
      { snapshot: solid('#0000ff'), coordinates: { x: -2, y: -1 } },
    ];
    const card = await renderApiExpandedCard(cells);
    expect(pixelHash(await renderApiExpandedCard([...cells].reverse()))).toBe(pixelHash(card));
    expect(pixelAt(card, 400, 200)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(card, 800, 200)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(card, 400, 450)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(card, 800, 450)).toEqual([14, 21, 36, 255]);
  });

  it('fits all sixteen cells without the old minimum-size clipping', async () => {
    const cells = Array.from({ length: 16 }, (_, x) => ({ snapshot: solid(x === 15 ? '#00ff00' : '#ff0000'), coordinates: { x, y: 0 } }));
    const card = await renderApiExpandedCard(cells);
    expect([card.width, card.height]).toEqual([1200, 630]);
    expect(pixelAt(card, 30, 315)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(card, 1170, 315)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(card, 1190, 315)).toEqual([14, 21, 36, 255]);
  });
});
