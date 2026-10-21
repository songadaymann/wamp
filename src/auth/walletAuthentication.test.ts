import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { ApiError, apiRequest } from '../api/request';
import { authenticateWallet, walletAuthenticationErrorMessage, WalletAuthenticationChangedError } from './walletAuthentication';

vi.mock('../api/request', async original => ({ ...await original<typeof import('../api/request')>(), apiRequest: vi.fn() }));
const request = vi.mocked(apiRequest);
const user = { id: 'current-account', walletAddress: null, email: 'player@example.test', displayName: 'Player' };
function setup() {
  const account = privateKeyToAccount(generatePrivateKey());
  let address = account.address, current = true, signed = 0;
  const controller = new AbortController();
  const provider = { request: vi.fn(async (q: { method: string; params?: unknown[] | object }): Promise<unknown> => {
    if (q.method === 'eth_accounts') return [address];
    if (q.method === 'personal_sign' && Array.isArray(q.params)) {
      signed++;
      return account.signMessage({ message: { raw: q.params[0] as `0x${string}` } });
    }
    throw new Error('Unexpected method ' + q.method);
  }) };
  const message = 'Link this wallet to your current WAMP account.\nWAMP account: Player (current-account)\nNonce: isolated';
  request.mockImplementation(async path => path.endsWith('/challenge')
    ? { address: account.address.toLowerCase(), message, expiresAt: new Date(Date.now() + 60000).toISOString() }
    : { authenticated: true, linkedWallet: true, user: { ...user, walletAddress: account.address.toLowerCase() } });
  const options = { signal: controller.signal, isCurrent: () => current,
    connect: async () => ({ address: account.address, provider }) };
  return { account, provider, options, controller, message, signed: () => signed,
    switchWallet: () => { address = privateKeyToAccount(generatePrivateKey()).address; }, leave: () => { current = false; } };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('wallet proof client boundary', () => {
  it('uses the actual connected signer and preserves the challenge in a verifiable signature', async () => {
    const f = setup();
    expect(await authenticateWallet(f.options)).toMatchObject({ linkedWallet: true, user: { id: user.id } });
    expect(f.signed()).toBe(1); expect(request).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(request.mock.calls[1][1]?.body));
    expect(body.address).toBe(f.account.address); expect(body.message).toBe(f.message);
    expect(await verifyMessage({ address: f.account.address, message: body.message, signature: body.signature })).toBe(true);
  });
  it.each(['cancel', 'context', 'wallet'])('stops before signing when %s changes while the challenge loads', async change => {
    const f = setup(), implementation = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      const response = await implementation(path, init);
      if (change === 'cancel') f.controller.abort(); else if (change === 'context') f.leave(); else f.switchWallet();
      return response;
    });
    await expect(authenticateWallet(f.options)).rejects.toBeInstanceOf(WalletAuthenticationChangedError);
    expect(f.signed()).toBe(0); expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'context', 'wallet'])('does not submit a late signature after %s changes', async change => {
    const f = setup(), rpc = f.provider.request.getMockImplementation()!;
    f.provider.request.mockImplementation(async q => {
      const result = await rpc(q);
      if (q.method === 'personal_sign') {
        if (change === 'cancel') f.controller.abort(); else if (change === 'context') f.leave(); else f.switchWallet();
      }
      return result;
    });
    await expect(authenticateWallet(f.options)).rejects.toBeInstanceOf(WalletAuthenticationChangedError);
    expect(f.signed()).toBe(1); expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not sign or verify when the server supplies a challenge for another wallet', async () => {
    const f = setup(); request.mockResolvedValue({ address: privateKeyToAccount(generatePrivateKey()).address, message: f.message });
    await expect(authenticateWallet(f.options)).rejects.toBeInstanceOf(WalletAuthenticationChangedError);
    expect(f.signed()).toBe(0); expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not contact a wallet or API after its installed-wallet lifetime ends', async () => {
    const f = setup(), connect = vi.fn(f.options.connect); f.controller.abort();
    await expect(authenticateWallet({ ...f.options, connect })).rejects.toBeInstanceOf(WalletAuthenticationChangedError);
    expect(connect).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
  it('keeps an actionable API conflict and never retries the signature automatically', async () => {
    const f = setup(); request.mockRejectedValue(new ApiError('Switch to your linked wallet.', 409));
    await expect(authenticateWallet(f.options)).rejects.toThrow('Switch to your linked wallet.');
    expect(request).toHaveBeenCalledTimes(1); expect(f.signed()).toBe(0);
  });
  it('shows a readable cancellation without including provider payloads', () => {
    const error = { message: 'Private provider payload', cause: { code: 4001 } };
    expect(walletAuthenticationErrorMessage(error)).toBe('Wallet approval cancelled. You can try again when you are ready.');
    expect(walletAuthenticationErrorMessage(new ApiError('Log out of WAMP and use the wallet account.', 409))).toContain('Log out of WAMP');
    expect(walletAuthenticationErrorMessage(new ApiError('Private server diagnostics', 500))).not.toContain('Private');
  });
});
