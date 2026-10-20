import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionResponse } from './model';
import { WalletTransactionRevertedError } from './walletTransaction';

const wallet = '0x2222222222222222222222222222222222222222';
const otherWallet = '0x3333333333333333333333333333333333333333';
const hash = '0x' + 'a'.repeat(64);
const fixture = vi.hoisted(() => ({
  request: vi.fn(), address: '0x2222222222222222222222222222222222222222',
  session: {} as AuthSessionResponse,
}));
vi.mock('../api/request', () => ({ apiRequest: vi.fn(async () => fixture.session) }));
vi.mock('../profiles/profileRepository', () => ({ createProfileRepository: () => ({ loadProfileSummary: async () => null }) }));
vi.mock('@reown/appkit', () => ({ createAppKit: () => ({
  ready: async () => {}, getAddress: () => fixture.address,
  getAccount: () => ({ address: fixture.address, isConnected: true }), subscribeAccount: () => () => {},
  getWalletProvider: () => ({ request: fixture.request }),
}) }));
vi.mock('@reown/appkit-adapter-wagmi', () => ({ WagmiAdapter: class {} }));
vi.mock('@reown/appkit/networks', () => ({ base: { id: 8453 }, mainnet: { id: 1 }, baseSepolia: { id: 84532 } }));

const chain = { chainId: 8453, name: 'Base', rpcUrl: 'https://rpc.invalid', blockExplorerUrl: 'https://explorer.invalid', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 } };
const transaction = { to: wallet, data: '0x01', value: '0', chainId: 8453 };
const receipt = { transactionHash: hash, blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x10', transactionIndex: '0x0', from: wallet, to: wallet,
  cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '0'.repeat(512), status: '0x1', type: '0x2' };
async function rpc({ method }: { method: string }): Promise<unknown> {
  if (method === 'wallet_switchEthereumChain') return null;
  if (method === 'eth_accounts') return [fixture.address];
  if (method === 'eth_sendTransaction') return hash;
  if (method === 'eth_getTransactionReceipt') return receipt;
  if (method === 'eth_blockNumber') return '0x10';
  throw new Error('Unexpected wallet request ' + method);
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('VITE_REOWN_PROJECT_ID', 'public-test-project-id'); fixture.address = wallet;
  fixture.session = { authenticated: true, user: { id: 'buyer', displayName: 'Buyer', walletAddress: wallet, email: null } };
  fixture.request.mockImplementation(rpc);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'https://wamp.land', search: '' } }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function client() { const auth = await import('./client'); await auth.refreshAuthSession(); return auth; }
const sent = () => fixture.request.mock.calls.filter(([q]) => q.method === 'eth_sendTransaction');

describe('prepared room transactions through the real wallet sender and viem provider', () => {
  it('stops an invalidated room before opening or contacting the wallet', async () => {
    const auth = await client(); await expect(auth.sendPreparedWalletTransaction(transaction, chain, { isCurrent: () => false })).rejects.toThrow('no longer current');
    expect(fixture.request).not.toHaveBeenCalled();
  });
  it('rechecks cancellation after the provider switches chains, before sending', async () => {
    const auth = await client(); let current = true;
    fixture.request.mockImplementation(async q => { if (q.method === 'wallet_switchEthereumChain') current = false; return rpc(q); });
    await expect(auth.sendPreparedWalletTransaction(transaction, chain, { expectedWalletAddress: wallet, isCurrent: () => current })).rejects.toThrow('no longer current');
    expect(sent()).toHaveLength(0);
  });
  it('rejects a changed signer even when it now matches a different linked account', async () => {
    const auth = await client(); fixture.address = otherWallet;
    fixture.session = { authenticated: true, user: { id: 'other', displayName: 'Other', walletAddress: otherWallet, email: null } };
    await auth.refreshAuthSession();
    await expect(auth.sendPreparedWalletTransaction(transaction, chain, { expectedWalletAddress: wallet, isCurrent: () => true })).rejects.toThrow('connected wallet changed');
    expect(sent()).toHaveLength(0);
  });
  it('records the submitted hash before receipt waiting, using only the isolated EIP-1193 provider', async () => {
    const auth = await client(); let release!: () => void;
    const onSubmitted = vi.fn(); const hold = new Promise<void>(resolve => { release = resolve; });
    fixture.request.mockImplementation(async q => { if (q.method === 'eth_getTransactionReceipt') await hold; return rpc(q); });
    const work = auth.sendPreparedWalletTransaction(transaction, chain, { expectedWalletAddress: wallet, isCurrent: () => true, onSubmitted });
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledWith({ hash, from: wallet }));
    expect(sent()).toHaveLength(1); expect(sent()[0][0].params[0]).toMatchObject({ from: wallet, to: wallet, data: '0x01', value: '0x0' });
    release(); await expect(work).resolves.toEqual({ hash, from: wallet });
  });
  it('distinguishes a proven reverted receipt from an unknown receipt failure', async () => {
    const auth = await client(), onSubmitted = vi.fn();
    fixture.request.mockImplementation(async q => q.method === 'eth_getTransactionReceipt' ? { ...receipt, status: '0x0' } : rpc(q));
    await expect(auth.sendPreparedWalletTransaction(transaction, chain, { expectedWalletAddress: wallet, onSubmitted })).rejects.toEqual(new WalletTransactionRevertedError(hash));
    expect(onSubmitted).toHaveBeenCalledWith({ hash, from: wallet }); expect(sent()).toHaveLength(1);
  });
});
