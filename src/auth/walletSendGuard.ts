import { WalletRequestNotSubmittedError } from './walletTransaction';

interface WalletProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
}

/** One explicit cost consent permits one provider send, including SDK namespace fallbacks. */
export function createSingleSendProvider(provider: WalletProvider, chainId: number,
  current: () => boolean, onBeforeSend?: () => void): WalletProvider {
  let sendAttempted = false;
  let sendFailure: unknown;
  return { request: async args => {
    if (args.method === 'eth_sendTransaction' || args.method === 'wallet_sendTransaction') {
      // viem can try a wallet namespace fallback even for an ambiguous -32000 error.
      // One consent permits one provider send; preserve the original failure for recovery.
      if (sendAttempted) throw sendFailure ?? new Error('This wallet approval was already requested. Check it before starting another.');
      if (!current()) throw new Error('This room action is no longer current.');
      if (!Array.isArray(args.params) || !args.params[0] || typeof args.params[0] !== 'object') throw new Error('Invalid prepared room transaction.');
      // The generic viem formatter omits this standard RPC field. Keep the prepared network explicit.
      const params = [{ ...args.params[0], chainId: `0x${chainId.toString(16)}` }];
      onBeforeSend?.();
      sendAttempted = true;
      try { return await provider.request({ ...args, params }); }
      catch (error) { sendFailure = error; throw error; }
    }
    return provider.request(args);
  } };
}

/** Only explicit node rejections classify an unsubmitted request; unknown outcomes remain recoverable. */
export function classifyWalletRpcRejection(error: unknown, insufficientFundsMessage: RegExp): WalletRequestNotSubmittedError | null {
  const seen = new Set<unknown>();
  const causes: unknown[] = [error];
  for (let index = 0; index < causes.length && index < 32; index++) {
    const cause = causes[index];
    if (!cause || typeof cause !== 'object' || seen.has(cause)) continue;
    seen.add(cause);
    const reason = cause as { details?: unknown; shortMessage?: unknown; message?: unknown; code?: unknown; cause?: unknown; data?: { originalError?: unknown } };
    causes.push(reason.cause, reason.data?.originalError);
    const text = [reason.details, reason.shortMessage, reason.message].filter(v => typeof v === 'string').join(' ');
    if ((reason.code === -32000 || reason.code === -32003) && insufficientFundsMessage.test(text.toLowerCase())) {
      return new WalletRequestNotSubmittedError('insufficient-funds', 'Your wallet needs ETH for this action and its network fee.', error);
    }
    if (reason.code === 3 || reason.code === -32000 || reason.code === -32003) {
      if (text.includes('Incorrect mint price.')) return new WalletRequestNotSubmittedError('price-changed', 'The collection price changed.', error);
      if (text.includes('Mint authorization expired.')) return new WalletRequestNotSubmittedError('authorization-expired', 'The collection approval expired.', error);
    }
  }
  return null;
}
