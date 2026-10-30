/** Listen-only detection is initialized by auth setup; this never requests an address. */
export function hasCryptoWallet(): boolean {
  return globalThis.document?.documentElement?.dataset.wallet === 'yes';
}

/** A provider alone is not consent to load wallet-specific room data. */
export function hasConnectedCryptoWallet(): boolean {
  return hasCryptoWallet() && globalThis.document?.documentElement?.dataset.walletConnected === 'true';
}
