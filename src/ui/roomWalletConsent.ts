import type { PreparedWalletTransaction, RoomMintChainInfo } from '../mint/roomOwnership';
import { getRoomWalletCost, readRoomWalletBalance, roomWalletCostMessage } from '../mint/roomWalletCost';
import { hasCryptoWallet } from '../mint/walletGate';
import { requestBusyConfirmation, showBusyOverlay } from './appFeedback';

export async function requestRoomWalletConsent(options: {
  title: string;
  kind: 'mint' | 'artwork';
  transaction: PreparedWalletTransaction;
  chain: RoomMintChainInfo;
  priceWei?: string;
  wallet: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const cost = getRoomWalletCost(options.transaction, options.chain, options.kind, options.priceWei);
  if (!hasCryptoWallet() || options.signal.aborted || !options.isCurrent()) return false;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const gate = () => { if (!hasCryptoWallet()) abort(); };
  const current = () => !controller.signal.aborted && !options.signal.aborted && hasCryptoWallet() && options.isCurrent();
  options.signal.addEventListener('abort', abort, { once: true });
  window.addEventListener('wallet-gate', gate);
  try {
    while (current()) {
      showBusyOverlay(options.title, 'Checking your balance...', { close: abort, check: abort, showCheck: false });
      const balance = await readRoomWalletBalance(options.chain.chainId, options.wallet, controller.signal);
      if (!current()) return false;
      const low = balance !== null && balance <= cost.value;
      const accepted = await requestBusyConfirmation(options.title,
        roomWalletCostMessage(options.kind, cost, options.wallet, balance), {
          confirmLabel: low ? 'Check balance' : 'Continue to wallet',
          cancelLabel: options.kind === 'artwork' ? 'Not now' : 'Cancel', signal: controller.signal,
        });
      if (!accepted || !current()) return false;
      if (!low) return true;
    }
    return false;
  } finally {
    options.signal.removeEventListener('abort', abort);
    window.removeEventListener('wallet-gate', gate);
    controller.abort();
  }
}
