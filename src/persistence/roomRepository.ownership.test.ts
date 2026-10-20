import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api/baseUrl', () => ({ getApiBaseUrl: () => 'https://api.example' }));
import { createRoomRepository } from './roomRepository';
import { setActiveWorldId } from '../worlds/clientContext';

afterEach(() => { setActiveWorldId(null); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('explicit repository ownership refresh', () => {
  it('posts with credentials, active-world scope and the operation signal', async () => {
    vi.stubEnv('VITE_ROOM_STORAGE_BACKEND', 'remote'); setActiveWorldId('world-one');
    const fetch = vi.fn(async () => Response.json({ id: '0,0' })); vi.stubGlobal('fetch', fetch);
    const abort = new AbortController(); await createRoomRepository().refreshRoomOwnership('0,0', { x: 0, y: 0 }, { signal: abort.signal });
    expect(fetch).toHaveBeenCalledWith('https://api.example/api/rooms/0%2C0/ownership/refresh?x=0&y=0&worldId=world-one', expect.objectContaining({ method: 'POST', credentials: 'include', signal: abort.signal }));
  });
  it.each([404, 503])('never substitutes local ownership for a failed remote refresh (%s)', async status => {
    vi.stubEnv('VITE_ROOM_STORAGE_BACKEND', 'auto');
    const getItem = vi.fn(() => null); vi.stubGlobal('localStorage', { getItem });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Ownership unavailable' }, { status })));
    await expect(createRoomRepository().refreshRoomOwnership('0,0', { x: 0, y: 0 })).rejects.toMatchObject({ status });
    expect(getItem).not.toHaveBeenCalled();
  });
  it('passes cancellation through the initial summary read too', async () => {
    vi.stubEnv('VITE_ROOM_STORAGE_BACKEND', 'remote');
    const fetch = vi.fn(async () => Response.json({ id: '0,0' })); vi.stubGlobal('fetch', fetch);
    const abort = new AbortController(); await createRoomRepository().loadRoomSummary('0,0', { x: 0, y: 0 }, { signal: abort.signal });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/summary?'), expect.objectContaining({ signal: abort.signal }));
  });
});
