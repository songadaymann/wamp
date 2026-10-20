import { afterEach, describe, expect, it, vi } from 'vitest';

import { ROOM_OWNERSHIP_TOKEN_ABI } from '../../../mint/roomOwnership';
import { createDefaultRoomRecord } from '../../../persistence/roomModel';
import { getRoomMintNetwork, parseRoomChainId } from '../../../mint/roomNetwork';
import type { Env, RoomMintConfig } from '../core/types';
import { fixture } from '../activity/testDatabase';
import { createVerifiedRoomMintPublicClient } from './network';
import { createMintRpcFixture, FIXTURE_MINT_RPC, FIXTURE_MINT_CONTRACT, FIXTURE_MINT_WALLET, FIXTURE_MINT_AUTH_KEY } from './testRpc';
import { getOptionalRoomMintConfig, loadRoomMintPriceWei, readRoomMintStateFromChain, signRoomMintAuthorization, syncRoomOwnershipFromChain, verifyMintTransactionForRoom, verifyRoomTokenMetadataTransaction } from './service';

const privateRpc = FIXTURE_MINT_RPC, contract = FIXTURE_MINT_CONTRACT, wallet = FIXTURE_MINT_WALLET, dummyKey = FIXTURE_MINT_AUTH_KEY;
const config: RoomMintConfig = { chainId: 8453, chainName: 'Base', blockExplorerUrl: 'https://basescan.org', contractAddress: contract, rpcUrl: privateRpc };
const environment = (id: string | undefined = '8453') => ({ ROOM_MINT_CHAIN_ID: id, ROOM_MINT_RPC_URL: privateRpc, ROOM_MINT_CONTRACT_ADDRESS: contract } as Env);
function rpc(chainId = 8453, tokenId = 0n) {
  const f = createMintRpcFixture(chainId, tokenId), fetch = vi.fn(f.fetch);
  vi.stubGlobal('fetch', fetch); return { ...f, fetch };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('explicit room networks', () => {
  it.each([undefined, '', ' ', '0', '-1', '1.2', 'NaN', '8453e0', '9007199254740993'])('rejects missing/invalid enabled mint chain %s', value => {
    expect(() => getOptionalRoomMintConfig({ ...environment(), ROOM_MINT_CHAIN_ID: value })).toThrow(expect.objectContaining({ status: 503 }));
  });
  it.each([8453, 84532])('uses matching names/explorers for explicit chain %s', chainId => {
    expect(getOptionalRoomMintConfig(environment(String(chainId)))).toMatchObject({ chainId, chainName: getRoomMintNetwork(chainId)?.name, blockExplorerUrl: getRoomMintNetwork(chainId)?.blockExplorerUrl });
  });
  it('keeps disabled/unconfigured environments off and preserves explicit labels', () => {
    expect(getOptionalRoomMintConfig({} as Env)).toBeNull(); expect(getOptionalRoomMintConfig({ ...environment(undefined), ROOM_MINT_DISABLED: '1' })).toBeNull();
    expect(getOptionalRoomMintConfig({ ...environment(), ROOM_MINT_CHAIN_NAME: 'Custom Base', ROOM_MINT_BLOCK_EXPLORER_URL: 'https://explorer.example' })).toMatchObject({ chainName: 'Custom Base', blockExplorerUrl: 'https://explorer.example' });
    expect(() => getOptionalRoomMintConfig(environment('1'))).toThrow(expect.objectContaining({ status: 503 }));
    expect(Object.isFrozen(getOptionalRoomMintConfig(environment()))).toBe(true);
  });
  it('requires explicit positive safe decimal network IDs in preview links', () => {
    for (const value of [undefined, null, '', '0', '8453junk', '0x2105', '1e3', '9007199254740993']) expect(parseRoomChainId(value)).toBeNull();
    expect(parseRoomChainId(' 8453 ')).toBe(8453); expect(parseRoomChainId('84532')).toBe(84532); expect(parseRoomChainId('1')).toBe(1);
  });
});

describe('verified server reads', () => {
  it.each([8453, 84532])('checks the actual private transport before reading on %s', async chainId => {
    const f = rpc(chainId); expect(await loadRoomMintPriceWei({ ...config, chainId })).toBe('1000');
    expect(f.methods).toEqual(['eth_chainId', 'eth_call']); expect(f.urls).toEqual([privateRpc, privateRpc]);
  });
  it('rejects a mismatch before contract reads, signature creation or receipt lookup', async () => {
    const f = rpc(84532), operations = [
      () => loadRoomMintPriceWei(config), () => readRoomMintStateFromChain(config, { x: 0, y: 0 }),
      () => signRoomMintAuthorization({ ...environment(), ROOM_MINT_AUTH_PRIVATE_KEY: dummyKey }, config, { x: 0, y: 0 }, wallet, 1n),
      () => verifyMintTransactionForRoom(config, `0x${'ab'.repeat(32)}`, { x: 0, y: 0 }),
      () => verifyRoomTokenMetadataTransaction(config, `0x${'ab'.repeat(32)}`, { ...createDefaultRoomRecord('0,0', { x: 0, y: 0 }), mintedTokenId: '42', mintedChainId: config.chainId, mintedContractAddress: config.contractAddress }, 'fixture-metadata-hash'),
    ];
    for (const operation of operations) await expect(operation()).rejects.toMatchObject({ status: 503 });
    expect(f.methods).toEqual(operations.map(() => 'eth_chainId'));
  });
  it('does not retain validation across operations or configuration changes', async () => {
    const f = rpc(); await loadRoomMintPriceWei(config);
    await expect(loadRoomMintPriceWei({ ...config, chainId: 84532 })).rejects.toMatchObject({ status: 503 });
    expect(f.methods).toEqual(['eth_chainId', 'eth_call', 'eth_chainId']);
  });
  it('isolates concurrent operations with different expected networks', async () => {
    const f = rpc();
    const [matching, wrong] = await Promise.allSettled([loadRoomMintPriceWei(config), loadRoomMintPriceWei({ ...config, chainId: 84532 })]);
    expect(matching).toEqual({ status: 'fulfilled', value: '1000' });
    expect(wrong).toMatchObject({ status: 'rejected', reason: { status: 503 } });
    expect(f.methods.filter(m => m === 'eth_chainId')).toHaveLength(2);
    expect(f.methods.filter(m => m === 'eth_call')).toHaveLength(1);
  });
  it('snapshots transport/network while validation is in flight', async () => {
    const f = rpc(); const changing = { ...config }; const pending = createVerifiedRoomMintPublicClient(changing);
    changing.rpcUrl = 'https://different.example'; changing.chainId = 84532;
    const client = await pending; await client.readContract({ address: contract, abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'mintPriceWei' });
    expect(f.urls).toEqual([privateRpc, privateRpc]);
  });
  it('keeps provider diagnostics private and retries only on the next operation', async () => {
    const fetch = vi.fn(async () => { throw new Error(privateRpc); }); vi.stubGlobal('fetch', fetch);
    const error: unknown = await loadRoomMintPriceWei(config).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503 }); expect(String(error)).not.toContain(privateRpc); expect(fetch).toHaveBeenCalledOnce();
    const recovered = rpc(); expect(await loadRoomMintPriceWei(config)).toBe('1000'); expect(recovered.methods).toEqual(['eth_chainId', 'eth_call']);
  });
  it('bounds a stalled network probe and leaves no timer behind', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error(privateRpc)), { once: true }))));
    const result = loadRoomMintPriceWei(config).catch((e: unknown) => e); await vi.advanceTimersByTimeAsync(2100);
    expect(await result).toMatchObject({ status: 503 }); expect(vi.getTimerCount()).toBe(0);
  });
  it('does not persist wrong-network ownership and preserves tolerant save fallback', async () => {
    const f = fixture(); const provider = rpc(84532, 42n); const env = { ...f.env, ...environment() };
    try {
      const before = f.sqlite.prepare('SELECT minted_chain_id,minted_token_id,minted_owner_wallet_address FROM rooms WHERE id=?').get('0,0');
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await syncRoomOwnershipFromChain(env, f.record, null, 'use-stored')).toBe(f.record);
      await expect(syncRoomOwnershipFromChain(env, f.record, null, 'throw')).rejects.toMatchObject({ status: 503 });
      expect(f.sqlite.prepare('SELECT minted_chain_id,minted_token_id,minted_owner_wallet_address FROM rooms WHERE id=?').get('0,0')).toEqual(before);
      expect(provider.methods).toEqual(['eth_chainId', 'eth_chainId']);
      expect(await syncRoomOwnershipFromChain({ ...env, ROOM_MINT_CHAIN_ID: '' }, f.record, null, 'use-stored')).toBe(f.record);
    } finally { f.sqlite.close(); }
  });
  it('persists verified ownership on the configured network without changing the claim', async () => {
    const f = fixture(); const provider = rpc(8453, 42n);
    try {
      const updated = await syncRoomOwnershipFromChain({ ...f.env, ...environment() }, f.record, null, 'throw');
      expect(updated).toMatchObject({ mintedChainId: 8453, mintedTokenId: '42', mintedOwnerWalletAddress: wallet, claimerUserId: 'builder' });
      expect(f.sqlite.prepare('SELECT minted_chain_id,minted_token_id,minted_owner_wallet_address,claimer_user_id FROM rooms WHERE id=?').get('0,0')).toEqual({ minted_chain_id: 8453, minted_token_id: '42', minted_owner_wallet_address: wallet, claimer_user_id: 'builder' });
      expect(provider.methods).toEqual(['eth_chainId', 'eth_call', 'eth_call']);
    } finally { f.sqlite.close(); }
  });
});
