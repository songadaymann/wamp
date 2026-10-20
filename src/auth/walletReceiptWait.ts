import { waitForRoomWallet } from '../mint/roomWalletRecovery';

/** One user-started receipt wait. Closing it removes every owned timer/listener. */
export async function waitForWalletReceipt<T>(
  read: () => Promise<T>, notMinedYet: (error: unknown) => boolean, signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new DOMException('Wallet receipt wait cancelled.', 'AbortError');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const deadline = setTimeout(cancel, 180_000);
  try {
    while (true) {
      if (controller.signal.aborted) throw new DOMException('Wallet receipt wait cancelled.', 'AbortError');
      try { return await waitForRoomWallet(read(), controller.signal); }
      catch (error) { if (controller.signal.aborted || !notMinedYet(error)) throw error; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await waitForRoomWallet(new Promise<void>(resolve => { timer = setTimeout(resolve, 2_000); }), controller.signal);
      } finally { clearTimeout(timer); }
    }
  } finally {
    clearTimeout(deadline); signal.removeEventListener('abort', cancel); controller.abort();
  }
}
