import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api/baseUrl', () => ({ getApiBaseUrl: () => 'https://api.example' }));
import { createRoomRepository, createDefaultRoomRecord, createRoomSummaryFromRecord } from './roomRepository';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('connected-wallet room request opt-in', () => {
  it.each(['yes', 'no'])('allows explicitly pending recovery without reconnecting, but never overrides the wallet gate (%s)', async wallet => {
    vi.stubEnv('VITE_ROOM_STORAGE_BACKEND', 'remote');
    vi.stubGlobal('document', { documentElement: { dataset: { wallet, walletConnected: 'false' } } });
    const summary = createRoomSummaryFromRecord({ ...createDefaultRoomRecord(), mintedTokenId: '42' });
    const fetch = vi.fn(async (_input: string) => Response.json(summary)); vi.stubGlobal('fetch', fetch);
    const result = await createRoomRepository().refreshRoomOwnership('0,0', { x: 0, y: 0 }, { recoverPendingWallet: true });
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get('crypto')).toBe(wallet === 'yes' ? '1' : null);
    expect(result.mintedTokenId).toBe(wallet === 'yes' ? '42' : null);
    expect(result.isProtected).toBe(true);
  });

  it.each(['absent', 'installed', 'connected'])('requests crypto details only with a connected wallet: %s', async state => {
    vi.stubEnv('VITE_ROOM_STORAGE_BACKEND', 'remote');
    vi.stubGlobal('document', { documentElement: { dataset: { wallet: state === 'absent' ? 'no' : 'yes', walletConnected: String(state === 'connected') } } });
    const record = { ...createDefaultRoomRecord(), mintedTokenId: '42' };
    const summary = createRoomSummaryFromRecord(record);
    const fetch = vi.fn(async (input: string) => Response.json(input.includes('/current?')
      ? { summary, draft: record.draft, published: null } : input.includes('/summary?') || input.includes('/ownership/') ? summary : record));
    vi.stubGlobal('fetch', fetch);
    const repository = createRoomRepository(), xy = { x: 0, y: 0 };
    const results = [await repository.loadRoom('0,0', xy), await repository.loadRoomSummary('0,0', xy),
      (await repository.loadRoomCurrent('0,0', xy)).summary, await repository.refreshRoomOwnership('0,0', xy)];
    for (const [url] of fetch.mock.calls) expect(new URL(url).searchParams.get('crypto')).toBe(state === 'connected' ? '1' : null);
    for (const result of results) {
      expect(result.isProtected).toBe(true);
      expect(result.mintedTokenId).toBe(state === 'connected' ? '42' : null);
    }
  });

  it('discards a response that completes after the wallet disconnects', async () => {
    vi.stubEnv('VITE_ROOM_STORAGE_BACKEND', 'remote');
    const dataset = { wallet: 'yes', walletConnected: 'true' };
    vi.stubGlobal('document', { documentElement: { dataset } });
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const pending = createRoomRepository().loadRoomSummary('0,0', { x: 0, y: 0 });
    dataset.walletConnected = 'false';
    finish(Response.json(createRoomSummaryFromRecord({ ...createDefaultRoomRecord(), mintedTokenId: '42' })));
    expect(await pending).toMatchObject({ isProtected: true, mintedTokenId: null });
  });
});
