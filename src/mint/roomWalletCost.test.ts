import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatRoomEth, getRoomWalletCost, readRoomWalletBalance, roomWalletCostMessage } from './roomWalletCost';
const wallet = '0x2222222222222222222222222222222222222222';
const chain = { chainId: 8453, name: 'Untrusted display name', rpcUrl: 'https://must-not-use.invalid', blockExplorerUrl: null,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } };
const tx = { to: wallet, data: '0x01', chainId: 8453, value: '10000000000000000' };

describe('exact room collection amounts', () => {
  it('preserves wei precision and identifies the canonical network', () => {
    expect(formatRoomEth(1n)).toBe('0.000000000000000001');
    expect(formatRoomEth(1234567890123456789n)).toBe('1.234567890123456789');
    expect(getRoomWalletCost(tx, chain, 'mint', tx.value)).toEqual({ value: 10000000000000000n, amount: '0.01', network: 'Base' });
    expect(getRoomWalletCost({ ...tx, value: '0' }, chain, 'mint', '0').amount).toBe('0');
    expect(() => formatRoomEth(-1n)).toThrow();
  });
  it('refuses mismatched prices, networks, currencies and nonzero artwork charges', () => {
    expect(() => getRoomWalletCost(tx, chain, 'mint', '20000000000000000')).toThrow('cost changed');
    expect(() => getRoomWalletCost(tx, chain, 'artwork')).toThrow('cost changed');
    expect(() => getRoomWalletCost(tx, { ...chain, chainId: 84532 }, 'mint', tx.value)).toThrow('network changed');
    expect(() => getRoomWalletCost(tx, { ...chain, nativeCurrency: { ...chain.nativeCurrency, decimals: 6 } }, 'mint', tx.value)).toThrow();
    for (const value of ['-1', '0x10', '1e10', '01', (2n ** 256n).toString()]) expect(() => getRoomWalletCost({ ...tx, value }, chain, 'mint', value)).toThrow();
  });
  it('explains both fees without a made-up fiat quote or gas allowance', () => {
    const cost = getRoomWalletCost(tx, chain, 'mint', tx.value);
    const message = roomWalletCostMessage('mint', cost, wallet, 5000000000000000n);
    expect(message).toContain('0.01 ETH on Base'); expect(message).toContain('0.005 ETH');
    expect(message).toContain('separate transaction with its own fee'); expect(message).toContain('Add ETH');
    expect(message).not.toContain('$');
    expect(roomWalletCostMessage('mint', cost, wallet, null)).toContain('Balance unavailable');
  });
});

describe('finite installed-wallet balance reads', () => {
  const fetcher = vi.fn<typeof fetch>();
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal('fetch', fetcher);
    vi.stubGlobal('document', { documentElement: { dataset: { wallet: 'yes' } } }); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('uses only the public network and captured address, then releases its timer', async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x10' })));
    expect(await readRoomWalletBalance(8453, wallet, new AbortController().signal)).toBe(16n);
    expect(fetcher).toHaveBeenCalledWith('https://mainnet.base.org', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [wallet, 'latest'] });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not contact any endpoint for absent wallets, unsupported networks or cancelled contexts', async () => {
    document.documentElement.dataset.wallet = 'no'; await readRoomWalletBalance(8453, wallet, new AbortController().signal);
    document.documentElement.dataset.wallet = 'yes'; await readRoomWalletBalance(1, wallet, new AbortController().signal);
    const abort = new AbortController(); abort.abort(); await readRoomWalletBalance(8453, wallet, abort.signal);
    expect(fetcher).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['timeout', 'close'])('cancels a held balance read on %s with no retries or leftover timers', async kind => {
    fetcher.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })));
    const controller = new AbortController(), work = readRoomWalletBalance(8453, wallet, controller.signal);
    if (kind === 'close') controller.abort(); else await vi.advanceTimersByTimeAsync(5000);
    expect(await work).toBeNull(); expect(fetcher).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{ jsonrpc: '2.0', id: 1, result: '-1' }, { jsonrpc: '2.0', id: 2, result: '0x10' }, { jsonrpc: '2.0', id: 1, error: { code: -32000 } }])('honestly reports an unavailable/malformed result', async result => {
    fetcher.mockResolvedValue(new Response(JSON.stringify(result)));
    expect(await readRoomWalletBalance(8453, wallet, new AbortController().signal)).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
});
