import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData } from 'viem';
import { ROOM_OWNERSHIP_TOKEN_ABI } from '../../../mint/roomOwnership';
import { createDefaultRoomRecord, cloneRoomSnapshot } from '../../../persistence/roomModel';
import type { Env } from '../core/types';
import { HttpError } from '../core/http';
import { apiErrorResponse } from '../ops/errors';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), price: vi.fn(), sign: vi.fn() }));
vi.mock('../auth/request', () => ({ requireWalletLinkedRequestAuth: mocks.auth }));
vi.mock('../rooms/store', () => ({ loadRoomRecordForMutation: mocks.load, loadRoomRecord: vi.fn() }));
vi.mock('./service', async importOriginal => ({
  ...await importOriginal<typeof import('./service')>(),
  loadRoomMintPriceWei: mocks.price,
  signRoomMintAuthorization: mocks.sign,
}));

import { handleRoomMintPrepare, handleRoomTokenMetadataPrepare } from './routes';

const wallet = '0x2222222222222222222222222222222222222222';
const contract = '0x1111111111111111111111111111111111111111';
const privateRpc = 'https://server-rpc.example/server-only-sentinel';
const coordinates = { x: 3, y: -2 };
const tokenUri = 'data:application/json;base64,e30=';
const signature = `0x${'ab'.repeat(65)}`;
let rpcChainId = 8453;

function environment(chainId = 8453): Env {
  return {
    ROOM_MINT_CHAIN_ID: String(chainId), ROOM_MINT_CHAIN_NAME: 'Configured chain name',
    ROOM_MINT_RPC_URL: privateRpc, ROOM_MINT_CONTRACT_ADDRESS: contract,
    ROOM_MINT_BLOCK_EXPLORER_URL: 'https://explorer.example',
  } as Env;
}

function record(minted = false) {
  const room = createDefaultRoomRecord('3,-2', coordinates);
  room.published = cloneRoomSnapshot(room.draft);
  room.claimerUserId = 'builder';
  room.permissions.canMint = !minted;
  room.permissions.canSaveDraft = true;
  if (minted) {
    room.mintedChainId = 8453; room.mintedContractAddress = contract;
    room.mintedTokenId = '42'; room.mintedOwnerWalletAddress = wallet;
  }
  return room;
}

function prepare(kind: 'mint' | 'metadata', env = environment()) {
  const path = kind === 'mint' ? 'mint/prepare' : 'mint/metadata/prepare';
  const request = new Request(`https://api.wamp.land/api/rooms/3,-2/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://wamp.land' },
    body: JSON.stringify(kind === 'metadata' ? { tokenUri } : {}),
  });
  return kind === 'mint'
    ? handleRoomMintPrepare(request, env, '3,-2', coordinates)
    : handleRoomTokenMetadataPrepare(request, env, '3,-2', coordinates);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'builder', walletAddress: wallet } });
  mocks.price.mockResolvedValue('12345'); mocks.sign.mockResolvedValue(signature);
  mocks.load.mockResolvedValue(record());
  rpcChainId = 8453;
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)) as { id: number; method: string };
    expect(q.method).toBe('eth_chainId');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result: `0x${rpcChainId.toString(16)}` }), { headers: { 'Content-Type': 'application/json' } });
  }));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('mint and metadata prepare network information', () => {
  it.each(['mint', 'metadata'] as const)('keeps transport diagnostics out of the public error response (%s)', async kind => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.load.mockRejectedValue(new Error(`RPC transport unavailable: ${privateRpc}`));
    const error: unknown = await prepare(kind).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const request = new Request('https://api.wamp.land/api/rooms/3,-2/mint/prepare', { method: 'POST' });
    const response = apiErrorResponse(request, new URL(request.url), error);
    const text = await response.text();
    expect(response.status).toBe(500); expect(text).not.toContain(privateRpc);
    expect(text).not.toContain('server-only-sentinel'); expect(JSON.parse(text).requestId).toBeTruthy();
  });

  it.each(['mint', 'metadata'] as const)('keeps authentication ahead of configuration and chain reads (%s)', async kind => {
    mocks.auth.mockRejectedValue(new HttpError(401, 'Sign in first.'));
    await expect(prepare(kind)).rejects.toMatchObject({ status: 401 });
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.price).not.toHaveBeenCalled();
  });

  it.each([
    ['mint', 8453, 'https://mainnet.base.org'], ['mint', 84532, 'https://sepolia.base.org'],
    ['metadata', 8453, 'https://mainnet.base.org'], ['metadata', 84532, 'https://sepolia.base.org'],
  ] as const)('returns public wallet data while preserving transaction and private server configuration (%s/%s)', async (kind, chainId, rpcUrl) => {
    rpcChainId = chainId;
    mocks.load.mockResolvedValue(record(kind === 'metadata'));
    const env = environment(chainId), response = await prepare(kind, env), text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain('server-only-sentinel'); expect(text).not.toContain(privateRpc);
    const body = JSON.parse(text);
    expect(body.chain).toEqual({ chainId, name: 'Configured chain name', rpcUrl,
      blockExplorerUrl: 'https://explorer.example', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } });
    expect(body.roomCoordinates).toEqual(coordinates); expect(body.linkedWalletAddress).toBe(wallet);
    expect(body.transaction).toMatchObject({ to: contract, chainId, value: kind === 'mint' ? '12345' : '0' });
    const transaction = decodeFunctionData({ abi: ROOM_OWNERSHIP_TOKEN_ABI, data: body.transaction.data });
    if (kind === 'mint') {
      expect(body.priceWei).toBe('12345'); expect(transaction.functionName).toBe('mintRoom');
      expect(transaction.args).toEqual([3, -2, wallet, expect.any(BigInt), signature]);
      expect(mocks.price.mock.calls[0][0].rpcUrl).toBe(privateRpc);
      expect(mocks.sign.mock.calls[0][1].rpcUrl).toBe(privateRpc);
    } else {
      expect(body.tokenId).toBe('42'); expect(transaction.functionName).toBe('setRoomTokenURI');
      expect(transaction.args).toEqual([3, -2, tokenUri]); expect(mocks.sign).not.toHaveBeenCalled();
    }
    expect(env.ROOM_MINT_RPC_URL).toBe(privateRpc);
  });

  it.each(['mint', 'metadata'] as const)('fails closed for an unsupported wallet chain before reads or signing (%s)', async kind => {
    await expect(prepare(kind, environment(1))).rejects.toMatchObject({ status: 503 });
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.price).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('retains the claimer-only mint gate', async () => {
    mocks.load.mockResolvedValue({ ...record(), claimerUserId: 'other-builder' });
    await expect(prepare('mint')).rejects.toMatchObject({ status: 403 });
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('retains the minted-owner and edit-permission metadata gates', async () => {
    mocks.load.mockResolvedValue({ ...record(true), mintedOwnerWalletAddress: contract });
    await expect(prepare('metadata')).rejects.toMatchObject({ status: 403 });
    const room = record(true); room.permissions.canSaveDraft = false; mocks.load.mockResolvedValue(room);
    await expect(prepare('metadata')).rejects.toMatchObject({ status: 403 });
  });
});
