import { describe, expect, it, vi } from 'vitest';
import { checkRoomWalletReceipt } from './roomWalletReceipt';
import { pending } from './roomWalletTestFixtures';

function fixture(status = '0x0') {
  const p = pending();
  const receipt = { status, transactionHash: p.txHash, from: p.wallet, to: p.contractAddress, blockNumber: '0x1234' };
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ result: '0x2105' }))
    .mockImplementation(async () => Response.json({ result: receipt }));
  return { p, receipt, request, signal: new AbortController().signal };
}
describe('read-only known-hash receipt check', () => {
  it.each(['0x0', '0x1'])('recognizes a verified %s receipt without any wallet request', async status => {
    const f = fixture(status);
    expect(await checkRoomWalletReceipt(f.p, f.signal, f.request)).toBe(status === '0x0' ? 'reverted' : 'success');
    expect(f.request.mock.calls.map(c => JSON.parse(c[1]!.body as string).method)).toEqual(['eth_chainId', 'eth_getTransactionReceipt']);
    expect(f.request.mock.calls.every(c => c[0] === 'https://mainnet.base.org')).toBe(true);
  });
  it.each(['chain', 'hash', 'from', 'to', 'status', 'block'])('keeps a mismatched %s unknown', async field => {
    const f = fixture();
    if (field === 'chain') f.request.mockReset().mockResolvedValue(Response.json({ result: '0x1' }));
    if (field === 'hash') f.receipt.transactionHash = '0x' + 'a'.repeat(64);
    if (field === 'from') f.receipt.from = '0x' + 'a'.repeat(40);
    if (field === 'to') f.receipt.to = '0x' + 'a'.repeat(40);
    if (field === 'status') f.receipt.status = 'unknown';
    if (field === 'block') f.receipt.blockNumber = '';
    expect(await checkRoomWalletReceipt(f.p, f.signal, f.request)).toBeNull();
  });
  it('does not query a missing hash, unsupported chain or supplied endpoint', async () => {
    const f = fixture();
    expect(await checkRoomWalletReceipt({ ...f.p, txHash: null }, f.signal, f.request)).toBeNull();
    expect(await checkRoomWalletReceipt({ ...f.p, chainId: 1 }, f.signal, f.request)).toBeNull(); expect(f.request).not.toHaveBeenCalled();
  });
  it('treats network failure as unknown, never a reverted transaction', async () => {
    const f = fixture(); f.request.mockReset().mockRejectedValue(new Error('RPC unavailable'));
    expect(await checkRoomWalletReceipt(f.p, f.signal, f.request)).toBeNull();
  });
});
