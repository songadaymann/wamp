import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoomMintConfig } from '../core/types';
import { createRoomMintPublicClient } from './service';
import { buildWalletMintChainInfo } from './walletChainInfo';

const config: RoomMintConfig = {
  chainId: 8453,
  chainName: 'Base',
  rpcUrl: 'https://server-rpc.example/server-only-sentinel',
  contractAddress: '0x1111111111111111111111111111111111111111',
  blockExplorerUrl: 'https://basescan.org',
};

afterEach(() => vi.unstubAllGlobals());

describe('wallet network configuration boundary', () => {
  it.each([
    [8453, 'https://mainnet.base.org'],
    [84532, 'https://sepolia.base.org'],
  ])('uses the public endpoint for chain %s independently of server settings', (chainId, rpcUrl) => {
    const chain = buildWalletMintChainInfo({ ...config, chainId });
    expect(chain).toEqual({
      chainId, name: config.chainName, rpcUrl, blockExplorerUrl: config.blockExplorerUrl,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    });
    expect(JSON.stringify(chain)).not.toContain('server-only-sentinel');
    expect(JSON.stringify(chain)).not.toContain(config.contractAddress);
  });

  it('does not access a private transport property while building the wallet response', () => {
    const privateConfig = { ...config, get rpcUrl(): string { throw new Error('private transport accessed'); } };
    expect(buildWalletMintChainInfo(privateConfig).rpcUrl).toBe('https://mainnet.base.org');
  });

  it.each([1, 31337])('rejects unsupported wallet setup without falling back to private transport (%s)', chainId => {
    expect(() => buildWalletMintChainInfo({ ...config, chainId })).toThrow(
      expect.objectContaining({ status: 503, message: 'Wallet network setup is unavailable for the configured mint chain.' }),
    );
  });

  it('retains the private transport for server reads', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0x2105' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await createRoomMintPublicClient(config, { retryCount: 0 }).getChainId()).toBe(8453);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toBe(config.rpcUrl);
  });
});
