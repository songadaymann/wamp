import { AUTH_STATE_CHANGED_EVENT, getAuthDebugState } from '../auth/client';
import { getPendingRoomWalletStore, PENDING_ROOM_WALLET_KEY } from '../mint/pendingRoomWallet';
import { RoomWalletRecoveryLifecycle } from '../mint/roomWalletRecoveryLifecycle';
import { getRoomWalletRecovery } from '../mint/roomWalletRecoveryRuntime';
import { getActiveWorldId, WORLD_CONTEXT_CHANGED_EVENT } from '../worlds/clientContext';

export function installPendingRoomWalletRecovery(): () => void {
  const lifecycle = new RoomWalletRecoveryLifecycle({
    store: getPendingRoomWalletStore,
    enabled: () => document.visibilityState === 'visible' && document.documentElement.dataset.wallet === 'yes' && !getActiveWorldId(),
    identity: () => { const auth = getAuthDebugState(); return {
      userId: auth.authenticated ? auth.user?.id ?? null : null,
      wallet: auth.authenticated ? auth.user?.walletAddress?.toLowerCase() ?? null : null,
    }; },
    check: (pending, signal) => getRoomWalletRecovery().check(pending, signal),
  });
  const notify = () => { void lifecycle.notify(); };
  const storage = (event: StorageEvent) => { if (event.key === PENDING_ROOM_WALLET_KEY) notify(); };
  const cancel = () => lifecycle.cancel();
  const events = ['focus', AUTH_STATE_CHANGED_EVENT, WORLD_CONTEXT_CHANGED_EVENT, 'wallet-gate'];
  for (const event of events) window.addEventListener(event, notify);
  document.addEventListener('visibilitychange', notify);
  window.addEventListener('storage', storage);
  window.addEventListener('pagehide', cancel);
  notify();
  return () => {
    cancel();
    for (const event of events) window.removeEventListener(event, notify);
    document.removeEventListener('visibilitychange', notify);
    window.removeEventListener('storage', storage);
    window.removeEventListener('pagehide', cancel);
  };
}
