import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, type Hex } from 'viem';
import { ROOM_OWNERSHIP_TOKEN_ABI } from '../../../mint/roomOwnership';
import { getRoomMintNetwork } from '../../../mint/roomNetwork';
import { fixture } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import { apiErrorResponse } from '../ops/errors';
import { handleRoomMintPrepare, handleRoomTokenMetadataPrepare } from './routes';
import { createMintRpcFixture, FIXTURE_MINT_RPC, FIXTURE_MINT_CONTRACT, FIXTURE_MINT_WALLET, FIXTURE_MINT_AUTH_KEY } from './testRpc';

type Kind = 'mint' | 'metadata';
const coordinates = { x: 0, y: 0 }, tokenUri = 'data:application/json;base64,e30=';
async function setup(chainId = 8453, actualChainId = chainId, kind: Kind = 'mint', local = false) {
  const f = fixture(), provider = createMintRpcFixture(actualChainId, kind === 'metadata' ? 42n : 0n);
  Object.assign(f.env, { ROOM_MINT_CHAIN_ID: String(chainId), ROOM_MINT_RPC_URL: local ? 'http://127.0.0.1:9999' : FIXTURE_MINT_RPC, ROOM_MINT_CONTRACT_ADDRESS: FIXTURE_MINT_CONTRACT, ROOM_MINT_AUTH_PRIVATE_KEY: FIXTURE_MINT_AUTH_KEY });
  f.sqlite.prepare('UPDATE users SET wallet_address=? WHERE id=?').run(FIXTURE_MINT_WALLET, 'builder');
  if (kind === 'metadata') f.sqlite.prepare('UPDATE rooms SET minted_chain_id=?,minted_contract_address=?,minted_token_id=?,minted_owner_wallet_address=? WHERE id=?')
    .run(chainId, FIXTURE_MINT_CONTRACT, '42', FIXTURE_MINT_WALLET, '0,0');
  const session = await createSession(f.env, 'builder'); vi.stubGlobal('fetch', vi.fn(provider.fetch));
  const request = (authenticated = true) => new Request(`https://api.wamp.land/api/rooms/0,0/${kind === 'mint' ? 'mint' : 'mint/metadata'}/prepare`, { method: 'POST', headers: { Origin: 'https://wamp.land', 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `ep_session=${session}` } : {}) }, body: JSON.stringify(kind === 'mint' ? {} : { tokenUri }) });
  const prepare = (authenticated = true) => kind === 'mint' ? handleRoomMintPrepare(request(authenticated), f.env, '0,0', coordinates) : handleRoomTokenMetadataPrepare(request(authenticated), f.env, '0,0', coordinates);
  const ownership = () => f.sqlite.prepare('SELECT minted_chain_id,minted_contract_address,minted_token_id,minted_owner_wallet_address,claimer_user_id FROM rooms WHERE id=?').get('0,0');
  return { ...f, provider, request, prepare, ownership };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('real mint handlers, sessions, database and viem network checks', () => {
  it.each([8453, 84532])('prepares a valid mint on explicit chain %s without exposing its server endpoint', async chainId => {
    const f = await setup(chainId);
    try {
      const before = f.ownership(), r = await f.prepare(), text = await r.text(), body = JSON.parse(text) as { chain: { chainId: number; rpcUrl: string; name: string }; transaction: { to: string; chainId: number; data: Hex; value: string }; priceWei: string; linkedWalletAddress: string };
      expect(r.status).toBe(200); expect(body.chain).toMatchObject({ chainId, rpcUrl: getRoomMintNetwork(chainId)?.rpcUrl, name: getRoomMintNetwork(chainId)?.name });
      expect(body.transaction).toMatchObject({ to: FIXTURE_MINT_CONTRACT, chainId, value: '1000' }); expect(body.priceWei).toBe('1000'); expect(body.linkedWalletAddress).toBe(FIXTURE_MINT_WALLET);
      const decoded = decodeFunctionData({ abi: ROOM_OWNERSHIP_TOKEN_ABI, data: body.transaction.data }); expect(decoded.functionName).toBe('mintRoom');
      expect(decoded.args).toEqual([0, 0, FIXTURE_MINT_WALLET, expect.any(BigInt), expect.stringMatching(/^0x[0-9a-f]{130}$/)]);
      expect(text).not.toContain(FIXTURE_MINT_RPC); expect(text).not.toContain('private-sentinel');
      expect(f.provider.methods).toEqual(['eth_chainId', 'eth_call', 'eth_chainId', 'eth_call', 'eth_chainId', 'eth_call']);
      expect(f.provider.urls.every(url => url === FIXTURE_MINT_RPC)).toBe(true); expect(f.ownership()).toEqual(before);
    } finally { f.sqlite.close(); }
  });
  it.each([8453, 84532])('prepares metadata on explicit chain %s only after its network is verified', async chainId => {
    const f = await setup(chainId, chainId, 'metadata');
    try {
      const r = await f.prepare(), text = await r.text(), body = JSON.parse(text) as { chain: { chainId: number; rpcUrl: string }; tokenId: string; transaction: { chainId: number; value: string; data: Hex } };
      expect(r.status).toBe(200); expect(body.chain).toMatchObject({ chainId, rpcUrl: getRoomMintNetwork(chainId)?.rpcUrl }); expect(body.tokenId).toBe('42');
      expect(body.transaction).toMatchObject({ chainId, value: '0' }); const decoded = decodeFunctionData({ abi: ROOM_OWNERSHIP_TOKEN_ABI, data: body.transaction.data });
      expect(decoded.functionName).toBe('setRoomTokenURI'); expect(decoded.args).toEqual([0, 0, tokenUri]); expect(text).not.toContain(FIXTURE_MINT_RPC);
      expect(f.provider.methods).toEqual(['eth_chainId', 'eth_call', 'eth_call', 'eth_chainId']);
    } finally { f.sqlite.close(); }
  });
  it.each(['mint', 'metadata'] as const)('rejects wrong-network %s before changing ownership or returning instructions', async kind => {
    const f = await setup(8453, 84532, kind);
    try { const before = f.ownership(); await expect(f.prepare()).rejects.toMatchObject({ status: 503 }); expect(f.provider.methods).toEqual(['eth_chainId']); expect(f.ownership()).toEqual(before); }
    finally { f.sqlite.close(); }
  });
  it('does not let the local ownership fallback bypass metadata network validation', async () => {
    const f = await setup(8453, 84532, 'metadata', true); vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { const before = f.ownership(); await expect(f.prepare()).rejects.toMatchObject({ status: 503 }); expect(f.provider.methods).toEqual(['eth_chainId', 'eth_chainId']); expect(f.ownership()).toEqual(before); }
    finally { f.sqlite.close(); }
  });
  it.each(['mint', 'metadata'] as const)('keeps authentication before configuration/provider access (%s)', async kind => {
    const f = await setup(8453, 8453, kind); f.env.ROOM_MINT_CHAIN_ID = '';
    try { await expect(f.prepare(false)).rejects.toMatchObject({ status: 401 }); expect(f.provider.methods).toEqual([]); await expect(f.prepare()).rejects.toMatchObject({ status: 503 }); expect(f.provider.methods).toEqual([]); }
    finally { f.sqlite.close(); }
  });
  it('returns a private-safe public error after a provider failure', async () => {
    const f = await setup(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(FIXTURE_MINT_RPC); }));
    try { const error: unknown = await f.prepare().catch((e: unknown) => e), r = apiErrorResponse(f.request(), new URL(f.request().url), error), text = await r.text(); expect(r.status).toBe(503); expect(text).not.toContain(FIXTURE_MINT_RPC); expect(text).not.toContain('private-sentinel'); expect(JSON.parse(text).error).toContain('temporarily unavailable'); }
    finally { f.sqlite.close(); }
  });
});
