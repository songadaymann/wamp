/** Only a verified reverted receipt permits replacing an already submitted artwork transaction. */
export class WalletTransactionRevertedError extends Error {
  constructor(readonly hash: string) {
    super('The wallet transaction reverted. Try again.');
    this.name = 'WalletTransactionRevertedError';
  }
}
