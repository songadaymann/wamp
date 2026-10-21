import { ApiError, apiRequest } from '../api/request';
import type { WalletChallengeResponse, WalletVerifyResponse } from './model';

interface WalletConnection {
  address: string;
  provider: { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };
}

export class WalletAuthenticationChangedError extends Error {
  constructor() { super('Your account or connected wallet changed. Try again to approve the current account.'); }
}

/** Recheck the actual signer on both sides of the native signature prompt. */
export async function authenticateWallet(options: {
  connect: () => Promise<WalletConnection>;
  isCurrent: () => boolean;
  signal: AbortSignal;
}): Promise<WalletVerifyResponse> {
  const current = () => {
    if (options.signal.aborted || !options.isCurrent()) throw new WalletAuthenticationChangedError();
  };
  current();
  const { address, provider } = await options.connect();
  current();
  const { createWalletClient, custom } = await import('viem');
  const wallet = createWalletClient({ transport: custom(provider) });
  const signer = async () => {
    const [actual] = await wallet.getAddresses();
    current();
    if (!actual || actual.toLowerCase() !== address.toLowerCase()) throw new WalletAuthenticationChangedError();
    return actual;
  };
  await signer();
  const challenge = await apiRequest<WalletChallengeResponse>('/api/auth/wallet/challenge', {
    method: 'POST', body: JSON.stringify({ address }), signal: options.signal,
  });
  current();
  if (challenge.address.toLowerCase() !== address.toLowerCase()) throw new WalletAuthenticationChangedError();
  const actual = await signer();
  const signature = await wallet.signMessage({ account: actual, message: challenge.message });
  await signer();
  const response = await apiRequest<WalletVerifyResponse>('/api/auth/wallet/verify', {
    method: 'POST', body: JSON.stringify({ address: actual, message: challenge.message, signature }), signal: options.signal,
  });
  current();
  return response;
}

export function walletAuthenticationErrorMessage(error: unknown): string {
  if (error instanceof WalletAuthenticationChangedError) return error.message;
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return error.message;
  const seen = new Set<unknown>();
  let cause = error;
  for (let i = 0; i < 16 && cause && typeof cause === 'object' && !seen.has(cause); i++) {
    seen.add(cause);
    const rejection = cause as { code?: unknown; cause?: unknown };
    if (rejection.code === 4001) return 'Wallet approval cancelled. You can try again when you are ready.';
    cause = rejection.cause;
  }
  return 'Could not finish wallet sign-in. Check your connection and refresh WAMP to check your account before trying again.';
}
