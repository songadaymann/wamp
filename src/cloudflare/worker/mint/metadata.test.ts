import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, type Hex } from 'viem';
import { ROOM_OWNERSHIP_TOKEN_ABI } from '../../../mint/roomOwnership';
import { sha256Hex } from '../../../mint/roomMetadata';
import { createSession } from '../auth/store';
import { fixture } from '../activity/testDatabase';
import { handleRoomRequest } from '../rooms/routes';
import { loadRoomRecord } from '../rooms/store';
import { observeRoomTokenMetadata, persistRoomTokenMetadataState, verifyRoomTokenMetadataTransaction } from './metadata';
import type { RoomMintConfig } from '../core/types';
import { handleRoomTokenMetadataConfirm } from './routes';
import { createMintRpcFixture, FIXTURE_MINT_CONTRACT as contract, FIXTURE_MINT_WALLET as wallet, FIXTURE_MINT_RPC as rpc } from './testRpc';

const tx = `0x${'ab'.repeat(32)}` as Hex;
const payload = (version = 6, format = 4, x = 0, y = 0) => `data:application/json;base64,${Buffer.from(JSON.stringify({ wamp_room: format === 1
  ? { v: 1, roomId: `${x},${y}`, coordinates: [x, y], background: 'blue', tiles: {}, version }
  : { v: format, c: [x, y], b: 'blue', pv: version } })).toString('base64')}`;
async function setup(uri = payload()) {
  const f = fixture(), provider = createMintRpcFixture(8453, 42n); provider.state.tokenUri = uri;
  Object.assign(f.env, { ROOM_MINT_CHAIN_ID: '8453', ROOM_MINT_CONTRACT_ADDRESS: contract, ROOM_MINT_RPC_URL: rpc });
  f.sqlite.prepare('UPDATE users SET wallet_address=? WHERE id=?').run(wallet, 'p1');
  f.sqlite.prepare('UPDATE rooms SET minted_chain_id=8453,minted_contract_address=?,minted_token_id=?,minted_owner_wallet_address=?,minted_owner_synced_at=? WHERE id=?')
    .run(contract, '42', wallet, '2026-10-19T00:00:00Z', '0,0');
  const session = await createSession(f.env, 'p1'), requests: { method: string; params?: unknown[] }[] = [];
  const state = { txUri: uri, txFunction: 'setRoomTokenURI' as 'setRoomTokenURI' | 'setTokenURI', receiptStatus: '0x1', transactionRoom: [0, 0] as [number, number], transactionTokenId: 42n };
  const serve = async (input: RequestInfo | URL, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)) as { id: number; method: string; params?: unknown[] }; requests.push(q);
    const result = (value: unknown) => Response.json({ jsonrpc: '2.0', id: q.id, result: value });
    if (q.method === 'eth_getTransactionReceipt') return result({ transactionHash: tx, transactionIndex: '0x0', blockHash: '0x'+'bc'.repeat(32), blockNumber: '0xf', from: wallet, to: contract, gasUsed: '0x5208', cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', logs: [], logsBloom: '0x'+'0'.repeat(512), status: state.receiptStatus, type: '0x2' });
    if (q.method === 'eth_getTransactionByHash') return result({ hash: tx, nonce: '0x0', blockHash: '0x'+'bc'.repeat(32), blockNumber: '0xf', transactionIndex: '0x0', from: wallet, to: contract, value: '0x0', gas: '0x5208', gasPrice: '0x1', type: '0x2', chainId: '0x2105', r: '0x1', s: '0x1', v: '0x0', input: state.txFunction === 'setTokenURI'
      ? encodeFunctionData({ abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'setTokenURI', args: [state.transactionTokenId, state.txUri] })
      : encodeFunctionData({ abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'setRoomTokenURI', args: [...state.transactionRoom, state.txUri] }) });
    return provider.fetch(input, init);
  };
  vi.stubGlobal('fetch', vi.fn(serve));
  const headers = { Origin: 'https://wamp.land', 'Content-Type': 'application/json', Cookie: `ep_session=${session}` };
  const refresh = () => {
    // Each refresh here stands for one made after the short window in which a repeat reuses the last read.
    f.sqlite.prepare("DELETE FROM rate_limit_events WHERE bucket = 'room-chain:refreshed'").run();
    const request = new Request('https://api.wamp.land/api/rooms/0,0/ownership/refresh', { method: 'POST', headers }); return handleRoomRequest(request, new URL(request.url), f.env);
  };
  const confirm = async (version = 999, hash?: string) => handleRoomTokenMetadataConfirm(new Request('https://api.wamp.land/api/rooms/0,0/mint/metadata/confirm', { method: 'POST', headers, body: JSON.stringify({ txHash: tx, metadataRoomVersion: version, metadataHash: hash ?? await sha256Hex(provider.state.tokenUri) }) }), f.env, '0,0', { x: 0, y: 0 });
  const stored = () => f.sqlite.prepare('SELECT minted_metadata_room_version,minted_metadata_hash,minted_metadata_updated_at,minted_owner_wallet_address,claimer_user_id FROM rooms WHERE id=?').get('0,0') as { minted_metadata_room_version: number | null; minted_metadata_hash: string | null; minted_metadata_updated_at: string | null; minted_owner_wallet_address: string; claimer_user_id: string };
  const loadRecord = () => loadRoomRecord(f.env, '0,0', { x: 0, y: 0 }, 'p1', wallet);
  return { ...f, provider, requests, state, refresh, confirm, stored, loadRecord, serve };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('canonical room artwork observations and recovery', () => {
  it.each([1, 2, 3, 4])('reconciles unchanged-owner legacy/compact payload v%i and avoids repeated writes', async format => {
    const f = await setup(payload(6, format));
    try {
      expect(await (await f.refresh()).json()).toMatchObject({ mintedMetadataRoomVersion: 6, mintedMetadataHash: await sha256Hex(f.provider.state.tokenUri) });
      expect(f.stored()).toMatchObject({ minted_metadata_room_version: 6, minted_owner_wallet_address: wallet, claimer_user_id: 'builder' });
      const before = f.stored(), writes: string[] = [], prepare = f.env.DB.prepare.bind(f.env.DB);
      f.env.DB.prepare = (sql: string) => { if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) && !/rate_limit_events/.test(sql)) writes.push(sql); return prepare(sql); };
      await f.refresh(); expect(f.stored()).toEqual(before); expect(writes).toEqual([]);
      const calls = f.requests.filter(q => q.method === 'eth_call'); expect(calls).toHaveLength(6); expect(calls.every(q => q.params?.[1] === '0x10')).toBe(true);
    } finally { f.sqlite.close(); }
  });
  it('records the actual older version instead of copying the published version', async () => {
    const f = await setup(payload(3));
    try { f.sqlite.prepare("UPDATE rooms SET published_json=json_set(published_json,'$.version',8) WHERE id=?").run('0,0'); await f.refresh(); expect(f.stored()?.minted_metadata_room_version).toBe(3); }
    finally { f.sqlite.close(); }
  });
  it.each(['', 'https://untrusted.invalid/metadata', payload(0), payload(1.5), payload(9, 4, 1, 1), 'data:application/json;base64,e30='])('does not turn blank/unsupported/invalid/foreign URI into a current version (%s)', async uri => {
    const f = await setup(uri);
    try { await f.refresh(); expect(f.stored()).toMatchObject({ minted_metadata_room_version: null, minted_metadata_hash: await sha256Hex(uri) }); expect(f.requests.every(q => q.method.startsWith('eth_'))).toBe(true); }
    finally { f.sqlite.close(); }
  });
  it('updates a known cache when the owner changes the URI or clears it', async () => {
    const f = await setup();
    try { await f.refresh(); f.provider.state.tokenUri = payload(7); await f.refresh(); expect(f.stored()?.minted_metadata_room_version).toBe(7); f.provider.state.tokenUri=''; await f.refresh(); expect(f.stored()?.minted_metadata_room_version).toBe(null); }
    finally { f.sqlite.close(); }
  });
  it('keeps metadata reads out of ordinary saves and all idle time', async () => {
    const f = await setup();
    try {
      const request = new Request('https://api.wamp.land/api/rooms/0,0/draft', { method: 'PUT', headers: { Origin: 'https://wamp.land', 'Content-Type':'application/json', Cookie: `ep_session=${await createSession(f.env,'p1')}` }, body: JSON.stringify({ ...f.record.draft, title:'Holder edit' }) });
      expect((await handleRoomRequest(request,new URL(request.url),f.env)).status).toBe(200);
      expect(f.requests.map(q=>q.method)).toEqual(['eth_chainId','eth_call','eth_call']);
      vi.useFakeTimers(); await vi.advanceTimersByTimeAsync(600000); expect(f.requests).toHaveLength(3); expect(vi.getTimerCount()).toBe(0);
    } finally { f.sqlite.close(); }
  });
  it.each(['request', 'body'] as const)('bounds a stalled URI %s and performs no delayed writes or idle retries', async kind => {
    const f = await setup();
    try {
      await f.refresh(); const before = f.stored(); let stalled = false, calls = 0; vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        calls++; const q = JSON.parse(String(init?.body));
        if (q.method !== 'eth_call' || !q.params[0].data.startsWith('0xc87b56dd')) return f.serve(input, init);
        stalled = true;
        if (kind === 'request') return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error(rpc)), { once: true }));
        return Promise.resolve(new Response(new ReadableStream({ start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        } }), { headers: { 'Content-Type': 'application/json' } }));
      }));
      const pending = f.refresh().catch((error: unknown) => error); await vi.waitFor(() => expect(stalled).toBe(true));
      await vi.advanceTimersByTimeAsync(kind === 'request' ? 5100 : 12100);
      expect(await pending).toMatchObject({ status: 503 }); expect(f.stored()).toEqual(before);
      const settledCalls = calls; await vi.advanceTimersByTimeAsync(600000); expect(calls).toBe(settledCalls); expect(vi.getTimerCount()).toBe(0);
    } finally { f.sqlite.close(); }
  });
  it('preserves known cache and ownership if the URI read fails', async () => {
    const f=await setup();
    try {
      await f.refresh();const before=f.stored();vi.stubGlobal('fetch',vi.fn((input:RequestInfo|URL,init?:RequestInit)=>{
        const q=JSON.parse(String(init?.body));if(q.method==='eth_call'&&q.params[0].data.startsWith('0xc87b56dd'))return Promise.resolve(Response.json({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:rpc}}));return f.serve(input,init);
      }));
      await expect(f.refresh()).rejects.toMatchObject({status:503});expect(f.stored()).toEqual(before);
    }finally{f.sqlite.close();}
  });
});

describe('verified artwork confirmation and guarded cache persistence',()=>{
  it.each(['setRoomTokenURI','setTokenURI'] as const)('derives version from the chain for %s, ignoring client version999',async kind=>{
    const f=await setup(payload(6,1));f.state.txFunction=kind;
    try{const response=await f.confirm();expect(response.status).toBe(200);expect(f.stored()).toMatchObject({minted_metadata_room_version:6,claimer_user_id:'builder'});const checks=f.requests.filter(q=>q.method==='eth_call').slice(-3);expect(checks.every(q=>q.params?.[1]==='0x10')).toBe(true);}
    finally{f.sqlite.close();}
  });
  it.each(['hash','revert','room','token','canonical'] as const)('rejects a bad %s without recording metadata',async kind=>{
    const f=await setup(kind==='canonical'?payload(6,4,9,9):payload());
    if(kind==='revert')f.state.receiptStatus='0x0';if(kind==='room')f.state.transactionRoom=[1,1];if(kind==='token'){f.state.txFunction='setTokenURI';f.state.transactionTokenId=43n;}
    try{await expect(f.confirm(999,kind==='hash'?'0'.repeat(64):await sha256Hex(f.provider.state.tokenUri))).rejects.toMatchObject({status:kind==='hash'?409:400});expect(f.stored()?.minted_metadata_hash).toBe(null);}
    finally{f.sqlite.close();}
  });
  it.each(['chain','contract','token'] as const)('rejects mismatched stored %s identity',async kind=>{
    const f=await setup();
    try{
      const record=await f.loadRecord();const config: RoomMintConfig={chainId:8453,chainName:'Base',rpcUrl:rpc,contractAddress:contract,blockExplorerUrl:null};
      if(kind==='chain')record.mintedChainId=84532;if(kind==='contract')record.mintedContractAddress=`0x${'33'.repeat(20)}`;if(kind==='token')record.mintedTokenId='43';
      await expect(verifyRoomTokenMetadataTransaction(config,tx,record,await sha256Hex(f.provider.state.tokenUri))).rejects.toMatchObject({status:409});expect(f.stored()?.minted_metadata_hash).toBe(null);
    }finally{f.sqlite.close();}
  });
  it.each(['identity','metadata'] as const)('does not overwrite a concurrent %s change',async kind=>{
    const f=await setup();
    try{
      const record=await f.loadRecord(),observation=await observeRoomTokenMetadata(f.provider.state.tokenUri,{x:0,y:0});
      f.sqlite.prepare(kind==='identity'?'UPDATE rooms SET minted_token_id=? WHERE id=?':'UPDATE rooms SET minted_metadata_hash=? WHERE id=?').run(kind==='identity'?'99':'newer-observation','0,0');
      await expect(persistRoomTokenMetadataState(f.env,record,{...observation,chainId:8453,contractAddress:contract,tokenId:'42',updatedAt:new Date().toISOString()})).rejects.toMatchObject({status:409});expect(f.stored()?.minted_metadata_room_version).toBe(null);
    }finally{f.sqlite.close();}
  });
});
