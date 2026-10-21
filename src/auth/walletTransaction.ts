/** Only a verified reverted receipt permits replacing an already submitted artwork transaction. */
export class WalletTransactionRevertedError extends Error {
  constructor(readonly hash: string) {
    super('The wallet transaction reverted. Try again.');
    this.name = 'WalletTransactionRevertedError';
  }
}

export type UnsubmittedWalletReason = 'cancelled' | 'insufficient-funds' | 'price-changed' | 'authorization-expired'
  | 'network-switch' | 'wallet-mismatch';

/** Only raised at a known pre-submission boundary, never by a receipt/read failure. */
export class WalletRequestNotSubmittedError extends Error {
  readonly cause: unknown;
  constructor(readonly reason: UnsubmittedWalletReason, message: string, cause?: unknown) {
    super(message);
    this.name = 'WalletRequestNotSubmittedError';
    this.cause = cause;
  }
}
