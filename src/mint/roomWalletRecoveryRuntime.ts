import { getAuthDebugState } from '../auth/client';
import { createRoomRepository } from '../persistence/roomRepository';
import { getActiveWorldId } from '../worlds/clientContext';
import { getPendingRoomWalletStore } from './pendingRoomWallet';
import { RoomWalletRecovery } from './roomWalletRecovery';
import { checkRoomWalletReceipt } from './roomWalletReceipt';

function getRoomWalletIdentity() {
  const auth = getAuthDebugState();
  return { userId: auth.authenticated ? auth.user?.id ?? null : null,
    wallet: auth.authenticated ? auth.user?.walletAddress?.toLowerCase() ?? null : null };
}

let shared: { store: ReturnType<typeof getPendingRoomWalletStore>; recovery: RoomWalletRecovery } | undefined;
export function getRoomWalletRecovery(): RoomWalletRecovery {
  const store = getPendingRoomWalletStore();
  if (!shared || shared.store !== store) {
    const repository = createRoomRepository();
    shared = { store, recovery: new RoomWalletRecovery({ store, getIdentity: getRoomWalletIdentity,
      isOverworld: () => getActiveWorldId() === null,
      refresh: (pending, signal) => repository.refreshRoomOwnership(pending.roomId, pending.coordinates, { signal }),
      receipt: checkRoomWalletReceipt,
    }) };
  }
  return shared.recovery;
}
