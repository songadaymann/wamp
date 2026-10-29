import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { maskBlockedArtInSnapshots } from '../customSprites/blockedArt';
import { loadPublishedRoom } from '../rooms/store';
import { loadCachedShareArtwork } from './cachedArtwork';
import { renderRoomSharePreviewPng } from './roomPreviewImage';
import { handleRoomShareRequest } from './routes';

vi.mock('../rooms/store', () => ({ loadPublishedRoom: vi.fn(), loadRoomSnapshotsByReferences: vi.fn() }));
vi.mock('../customSprites/blockedArt', () => ({ maskBlockedArtInSnapshots: vi.fn() }));
vi.mock('./cachedArtwork', () => ({ loadCachedShareArtwork: vi.fn() }));
vi.mock('./roomPreviewImage', () => ({ ROOM_SHARE_IMAGE_WIDTH: 1200, ROOM_SHARE_IMAGE_HEIGHT: 630,
  renderRoomSharePreviewPng: vi.fn(), renderExpandedRoomSharePreviewPng: vi.fn() }));
const snapshot = createDefaultRoomSnapshot('1,-2', { x: 1, y: -2 });
const cached = { url: 'https://tiles.wamp.land/world-tiles/leaf.png', key: 'world-tiles/leaf.png', width: 642, height: 354 };
let get: ReturnType<typeof vi.fn>;
let env: Env;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadPublishedRoom).mockResolvedValue(snapshot);
  vi.mocked(maskBlockedArtInSnapshots).mockImplementation(async (_env, snapshots) => [...snapshots]);
  vi.mocked(loadCachedShareArtwork).mockResolvedValue(cached);
  vi.mocked(renderRoomSharePreviewPng).mockResolvedValue(new Uint8Array([9, 8, 7]));
  get = vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
  env = { EXPANDED_ROOMS_ENABLED: '0', WORLD_TILE_BUCKET: { get } } as unknown as Env;
});
const request = async (kind: string, method = 'GET') => {
  const url = new URL(`https://api.wamp.land/api/share/rooms/1%2C-2${kind ? `/${kind}` : ''}`);
  return handleRoomShareRequest(new Request(url, { method }), url, env);
};

describe('share routes use cached map artwork', () => {
  it('advertises cached public art and real dimensions in metadata and HTML', async () => {
    expect(await (await request('meta')).json()).toMatchObject({ imageUrl: cached.url, imageWidth: 642, imageHeight: 354 });
    const html = await (await request('')).text();
    expect(html).toContain(cached.url);
    expect(html).toContain('content="642"');
    expect(renderRoomSharePreviewPng).not.toHaveBeenCalled();
  });

  it.each(['image', 'image.png'])('serves cached bytes through the existing %s endpoint', async kind => {
    const response = await request(kind);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(get).toHaveBeenCalledWith(cached.key);
    expect(renderRoomSharePreviewPng).not.toHaveBeenCalled();
  });

  it('keeps HEAD bodyless without fetching or rendering PNG bytes', async () => {
    expect(await (await request('image', 'HEAD')).text()).toBe('');
    expect(get).not.toHaveBeenCalled();
    expect(renderRoomSharePreviewPng).not.toHaveBeenCalled();
  });

  it.each(['unready', 'deleted', 'unavailable'])( 'renders fallback when cached artwork is %s', async state => {
    if (state === 'unready') vi.mocked(loadCachedShareArtwork).mockResolvedValue(null);
    if (state === 'deleted') get.mockResolvedValue(null);
    if (state === 'unavailable') get.mockRejectedValue(new Error('R2 unavailable'));
    expect([...new Uint8Array(await (await request('image')).arrayBuffer())]).toEqual([9, 8, 7]);
    expect(renderRoomSharePreviewPng).toHaveBeenCalledWith(snapshot);
  });

  it('uses masked fallback for blocked art rather than an old cached leaf', async () => {
    const masked = { ...snapshot, title: 'masked fixture' };
    vi.mocked(maskBlockedArtInSnapshots).mockResolvedValue([masked, masked]);
    const meta = await (await request('meta')).json();
    expect(meta.imageUrl).toContain('/api/share/rooms/1%2C-2/image');
    expect(meta.imageWidth).toBe(1200);
    await request('image');
    expect(loadCachedShareArtwork).not.toHaveBeenCalled();
    expect(renderRoomSharePreviewPng).toHaveBeenCalledWith(masked);
  });
});
