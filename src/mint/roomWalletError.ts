import { WalletRequestNotSubmittedError, WalletTransactionRevertedError } from '../auth/walletTransaction';

export function roomWalletErrorMessage(error: unknown, kind: 'mint' | 'artwork', chain = 'the room’s network', wallet?: string | null): string {
  const account = wallet && /^0x[0-9a-f]{40}$/i.test(wallet) ? ` ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '';
  const seen = new Set<unknown>();
  for (let cause = error; cause && typeof cause === 'object' && !seen.has(cause); cause = (cause as { cause?: unknown }).cause) {
    seen.add(cause);
    if (cause instanceof WalletTransactionRevertedError) return 'The transaction reverted. Check the room, then try again.';
    if (cause instanceof WalletRequestNotSubmittedError) {
      switch (cause.reason) {
        case 'cancelled': return 'You cancelled in your wallet. Try again when you are ready.';
        case 'insufficient-funds': return `Your wallet needs more ETH on ${chain} for this action and its network fee. Add ETH, then try again.`;
        case 'price-changed': return 'The collection price changed. Try again to review the current price before opening your wallet.';
        case 'authorization-expired': return 'This collection approval expired. Try again to prepare a new approval and review its cost.';
        case 'network-switch': return `Switch your wallet to ${chain}, then try again.`;
        case 'wallet-mismatch': return `Switch to your linked wallet${account}, then try again.`;
      }
    }
    if ((cause as { code?: unknown }).code === 4001) return 'You cancelled in your wallet. Try again when you are ready.';
  }
  const message = error instanceof Error ? error.message : '';
  if (/^User rejected/i.test(message)) return 'You cancelled in your wallet. Try again when you are ready.';
  if (/wallet network changed|switch.*network/i.test(message)) return `Switch your wallet to ${chain}, then try again.`;
  if (/wallet.*(?:does not match|changed while preparing)/i.test(message)) return `Switch to your linked wallet${account}, then try again.`;
  if (/room cost.*changed/i.test(message)) return 'The room cost or network changed. Try again to review a fresh approval.';
  if (kind === 'artwork' && /too large to store its artwork/i.test(message)) return 'This room is too large to store its artwork in one transaction. Your room is still collected.';
  return kind === 'mint' ? 'Could not collect this room. Try again to prepare a fresh approval.'
    : 'Could not add the room artwork. Your room is still collected. Try Add/update artwork again.';
}
