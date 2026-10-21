import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { createMintRpcFixture, FIXTURE_MINT_CONTRACT, FIXTURE_MINT_RPC } from './testRpc';
import { handleCollectionPrice } from './price';
import type { Env } from '../core/types';

function setup(chain = 8453, actual = chain) {
  const provider = createMintRpcFixture(actual);
  vi.stubGlobal('fetch', vi.fn(provider.fetch));
  const env = { ROOM_MINT_CHAIN_ID: String(chain), ROOM_MINT_RPC_URL: FIXTURE_MINT_RPC,
    ROOM_MINT_CONTRACT_ADDRESS: FIXTURE_MINT_CONTRACT } as Env;
  const request = (query = '', headers = {}) => new Request(`https://api.wamp.land/api/collections/price${query}`, { headers });
  return { env, provider, request };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('read-only collection price', () => {
  it.each([8453, 84532])('reads the actual price on chain %s without a signer, room or wallet', async chain => {
    const f = setup(chain), r = await handleCollectionPrice(f.request(), f.env), text = await r.text();
    expect(r.status).toBe(200); expect(r.headers.get('Cache-Control')).toBe('public, max-age=20');
    expect(JSON.parse(text)).toEqual({ chainId: chain, priceWei: '1000', contractAddress: FIXTURE_MINT_CONTRACT,
      quotedAt: expect.stringMatching(/^\d{4}-/) });
    expect(text).not.toContain(FIXTURE_MINT_RPC); expect(text).not.toContain('transaction'); expect(text).not.toContain('signature');
    expect(f.provider.methods).toEqual(['eth_chainId', 'eth_call']);
  });
  it('refuses a mismatched chain before reading price', async () => {
    const f = setup(8453, 84532);
    await expect(handleCollectionPrice(f.request(), f.env)).rejects.toMatchObject({ status: 503, message: 'Collection price is temporarily unavailable.' });
    expect(f.provider.methods).toEqual(['eth_chainId']);
  });
  it.each([{ ROOM_MINT_DISABLED: '1' }, { ROOM_MINT_CHAIN_ID: '' }, { ROOM_MINT_CHAIN_ID: '1' }])('fails closed for unavailable configuration %j', async change => {
    const f = setup(); Object.assign(f.env, change);
    await expect(handleCollectionPrice(f.request(), f.env)).rejects.toMatchObject({ status: 503 }); expect(f.provider.methods).toEqual([]);
  });
  it('keeps private RPC failures out of the public error', async () => {
    const f = setup(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error(FIXTURE_MINT_RPC); }));
    await expect(handleCollectionPrice(f.request(), f.env)).rejects.toMatchObject({ status: 503, message: 'Collection price is temporarily unavailable.' });
  });
  it('rejects cache-busting query parameters without RPC work', async () => {
    const f = setup(); await expect(handleCollectionPrice(f.request('?room=0,0'), f.env)).rejects.toMatchObject({ status: 400 });
    expect(f.provider.methods).toEqual([]);
  });
  it('serves a shared quote with request CORS and validates credentials before cache hits', async () => {
    const f = setup(), db = fixture(); f.env.DB = db.env.DB;
    let cached: Response | undefined; const writes: Promise<unknown>[] = [];
    const match = vi.fn(async () => cached?.clone());
    vi.stubGlobal('caches', { default: { match, put: async (_key: Request, value: Response) => { cached = value; } } });
    const context = { waitUntil: (p: Promise<unknown>) => { writes.push(p); } };
    try {
      await handleCollectionPrice(f.request(), f.env, context); await Promise.all(writes);
      const hit = await handleCollectionPrice(f.request('', { Origin: 'https://wamp.land' }), f.env, context);
      expect(hit.headers.get('X-WAMP-Cache')).toBe('hit'); expect(hit.headers.get('Access-Control-Allow-Origin')).toBe('https://wamp.land');
      expect(f.provider.methods).toEqual(['eth_chainId', 'eth_call']);
      const before = match.mock.calls.length;
      await expect(handleCollectionPrice(f.request('', { Authorization: 'Bearer invalid' }), f.env, context)).rejects.toMatchObject({ status: 401 });
      expect(match).toHaveBeenCalledTimes(before);
    } finally { db.sqlite.close(); }
  });
});
