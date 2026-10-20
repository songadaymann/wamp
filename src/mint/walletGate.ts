/** Listen-only detection is initialized by auth setup; this never requests an address. */
export function hasCryptoWallet(): boolean {
  return globalThis.document?.documentElement?.dataset.wallet === 'yes';
}
