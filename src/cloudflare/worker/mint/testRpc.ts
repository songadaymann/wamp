import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ROOM_OWNERSHIP_TOKEN_ABI } from '../../../mint/roomOwnership';

// Public synthetic fixtures only; never used by the application or a live wallet.
export const FIXTURE_MINT_RPC = 'https://server-rpc.example/private-sentinel';
export const FIXTURE_MINT_CONTRACT = '0x1111111111111111111111111111111111111111';
export const FIXTURE_MINT_WALLET = '0x2222222222222222222222222222222222222222';
export const FIXTURE_MINT_AUTH_KEY: Hex = `0x${'01'.repeat(32)}`;
const authority = privateKeyToAccount(FIXTURE_MINT_AUTH_KEY).address;

export function createMintRpcFixture(chainId = 8453, tokenId = 0n) {
  const methods: string[] = [], urls: string[] = [];
  const state = { chainId, tokenId };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const body = init?.body ? String(init.body) : typeof input !== 'string' && !(input instanceof URL) ? await input.text() : '';
    urls.push(url);
    const q = JSON.parse(body) as { id: number; method: string; params: [{ data: Hex }] };
    methods.push(q.method);
    let result: string;
    if (q.method === 'eth_chainId') result = `0x${state.chainId.toString(16)}`;
    else if (q.method === 'eth_call') {
      const f = decodeFunctionData({ abi: ROOM_OWNERSHIP_TOKEN_ABI, data: q.params[0].data });
      if (f.functionName === 'mintPriceWei') result = encodeFunctionResult({ abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'mintPriceWei', result: 1000n });
      else if (f.functionName === 'mintAuthority') result = encodeFunctionResult({ abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'mintAuthority', result: authority });
      else if (f.functionName === 'tokenIdForRoomCoordinates') result = encodeFunctionResult({ abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'tokenIdForRoomCoordinates', result: state.tokenId });
      else if (f.functionName === 'ownerOf') result = encodeFunctionResult({ abi: ROOM_OWNERSHIP_TOKEN_ABI, functionName: 'ownerOf', result: FIXTURE_MINT_WALLET });
      else throw new Error('Unexpected fixture contract read');
    } else throw new Error('Unexpected fixture RPC method');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }), { headers: { 'Content-Type': 'application/json' } });
  };
  return { state, methods, urls, fetch };
}
