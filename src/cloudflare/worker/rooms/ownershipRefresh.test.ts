import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import { createMintRpcFixture, FIXTURE_MINT_CONTRACT, FIXTURE_MINT_WALLET, FIXTURE_MINT_RPC } from '../mint/testRpc';
import { handleRoomRequest } from './routes';

const seller = '0x1111111111111111111111111111111111111111';
async function setup(viewer = 'p1') {
  const f = fixture(), provider = createMintRpcFixture(8453, 42n);
  Object.assign(f.env, { ROOM_MINT_CHAIN_ID: '8453', ROOM_MINT_CONTRACT_ADDRESS: FIXTURE_MINT_CONTRACT, ROOM_MINT_RPC_URL: FIXTURE_MINT_RPC });
  for (const [id, wallet] of [['builder', seller], ['p1', FIXTURE_MINT_WALLET], ['p2', `0x${'33'.repeat(20)}`]]) {
    f.sqlite.prepare('UPDATE users SET wallet_address=? WHERE id=?').run(wallet, id);
  }
  f.sqlite.prepare('UPDATE rooms SET minted_chain_id=8453,minted_contract_address=?,minted_token_id=?,minted_owner_wallet_address=? WHERE id=?').run(FIXTURE_MINT_CONTRACT, '42', seller, '0,0');
  const cookie = await createSession(f.env, viewer); vi.stubGlobal('fetch', vi.fn(provider.fetch));
  const run = (authenticated = true) => {
    const request = new Request('https://api.wamp.land/api/rooms/0,0/ownership/refresh', { method: 'POST', headers: { Origin: 'https://wamp.land', ...(authenticated ? { Cookie: `ep_session=${cookie}` } : {}) } });
    return handleRoomRequest(request, new URL(request.url), f.env);
  };
  const save = () => {
    const request = new Request('https://api.wamp.land/api/rooms/0,0/draft', { method: 'PUT',
      headers: { Origin: 'https://wamp.land', 'Content-Type': 'application/json', Cookie: `ep_session=${cookie}` },
      body: JSON.stringify({ ...f.record.draft, title: 'New holder draft' }) });
    return handleRoomRequest(request, new URL(request.url), f.env);
  };
  const ownership = () => f.sqlite.prepare('SELECT minted_owner_wallet_address,claimer_user_id FROM rooms WHERE id=?').get('0,0');
  return { ...f, provider, run, save, ownership };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('explicit room ownership refresh, real sessions/database/provider protocol', () => {
  it.each([['p1', true], ['builder', false], ['p2', false]] as const)('refreshes holder permissions for %s without replacing the builder', async (viewer, canSaveDraft) => {
    const f = await setup(viewer);
    try {
      const response = await f.run(), body = await response.json(); expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(body).toMatchObject({ mintedOwnerWalletAddress: FIXTURE_MINT_WALLET, claimerUserId: 'builder', permissions: { canSaveDraft } });
      expect(f.ownership()).toEqual({ minted_owner_wallet_address: FIXTURE_MINT_WALLET, claimer_user_id: 'builder' });
      expect(f.provider.methods).toEqual(['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_call', 'eth_call']);
    } finally { f.sqlite.close(); }
  });
  it.each([['p1', true], ['builder', false]] as const)('enforces a real draft write after transfer for %s', async (viewer, allowed) => {
    const f = await setup(viewer);
    try {
      if (allowed) {
        const response = await f.save(); expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ draft: { title: 'New holder draft' } });
      } else {
        const before = f.sqlite.prepare('SELECT draft_json FROM rooms WHERE id=?').get('0,0');
        await expect(f.save()).rejects.toMatchObject({ status: 403 });
        expect(f.sqlite.prepare('SELECT draft_json FROM rooms WHERE id=?').get('0,0')).toEqual(before);
      }
      expect(f.ownership()).toEqual({ minted_owner_wallet_address: FIXTURE_MINT_WALLET, claimer_user_id: 'builder' });
    } finally { f.sqlite.close(); }
  });
  it('authenticates before configuration or RPC access', async () => {
    const f = await setup(); f.env.ROOM_MINT_CHAIN_ID = '';
    try { await expect(f.run(false)).rejects.toMatchObject({ status: 401 }); expect(f.provider.methods).toEqual([]); }
    finally { f.sqlite.close(); }
  });
  it.each(['disabled', 'missing', 'wrong-local-network', 'missing-token'] as const)('does not present stored ownership as fresh when %s', async kind => {
    const f = await setup();
    if (kind === 'disabled') f.env.ROOM_MINT_DISABLED = '1';
    if (kind === 'missing') { delete f.env.ROOM_MINT_CONTRACT_ADDRESS; delete f.env.ROOM_MINT_RPC_URL; }
    if (kind === 'wrong-local-network') { f.env.ROOM_MINT_RPC_URL = 'http://127.0.0.1:9999'; f.provider.state.chainId = 84532; }
    if (kind === 'missing-token') f.provider.state.tokenId = 0n;
    try { const before = f.ownership(); await expect(f.run()).rejects.toMatchObject({ status: kind === 'missing-token' ? 409 : 503 }); expect(f.ownership()).toEqual(before); }
    finally { f.sqlite.close(); }
  });
  it('bounds a stalled contract read without retrying after the manual wait', async () => {
    const f = await setup(); vi.useFakeTimers(); const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string }; methods.push(request.method);
      if (request.method === 'eth_chainId') return Promise.resolve(Response.json({ jsonrpc: '2.0', id: request.id, result: '0x2105' }));
      if (request.method === 'eth_blockNumber') return Promise.resolve(Response.json({ jsonrpc: '2.0', id: request.id, result: '0x10' }));
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error(FIXTURE_MINT_RPC)), { once: true }));
    }));
    try {
      const before = f.ownership(), pending = f.run().catch((error: unknown) => error);
      await vi.waitFor(() => expect(methods).toEqual(['eth_chainId', 'eth_blockNumber', 'eth_call']));
      await vi.advanceTimersByTimeAsync(5_100); expect(await pending).toMatchObject({ status: 503 });
      expect(methods).toEqual(['eth_chainId', 'eth_blockNumber', 'eth_call']); expect(f.ownership()).toEqual(before); expect(vi.getTimerCount()).toBe(0);
    } finally { f.sqlite.close(); }
  });
  it('sanitizes provider failures and recovers on the next explicit attempt', async () => {
    const f = await setup(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(FIXTURE_MINT_RPC); }));
    try {
      const before = f.ownership(); const error: unknown = await f.run().catch((e: unknown) => e);
      expect(error).toMatchObject({ status: 503 }); expect(String(error)).not.toContain(FIXTURE_MINT_RPC); expect(f.ownership()).toEqual(before);
      vi.stubGlobal('fetch', vi.fn(f.provider.fetch)); expect((await f.run()).status).toBe(200);
    } finally { f.sqlite.close(); }
  });
  it.each(['eth_chainId', 'eth_blockNumber', 'eth_call'])('aborts a stalled %s response body at the whole-operation deadline', async stalledMethod => {
    const f = await setup(); vi.useFakeTimers(); const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string }; methods.push(request.method);
      if (request.method !== stalledMethod) return Promise.resolve(Response.json({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_blockNumber' ? '0x10' : '0x2105' }));
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      } }), { headers: { 'Content-Type': 'application/json' } }));
    }));
    try {
      const before = f.ownership(), pending = f.run().catch((error: unknown) => error);
      await vi.waitFor(() => expect(methods).toContain(stalledMethod));
      await vi.advanceTimersByTimeAsync(12_100); expect(await pending).toMatchObject({ status: 503 });
      expect(methods).toEqual(stalledMethod === 'eth_chainId' ? ['eth_chainId'] : stalledMethod === 'eth_blockNumber' ? ['eth_chainId', 'eth_blockNumber'] : ['eth_chainId', 'eth_blockNumber', 'eth_call']);
      expect(f.ownership()).toEqual(before); expect(vi.getTimerCount()).toBe(0);
    } finally { f.sqlite.close(); }
  });
});
