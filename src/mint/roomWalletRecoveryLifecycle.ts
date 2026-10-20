import type { PendingRoomWallet, PendingRoomWalletStore } from './pendingRoomWallet';
import type { RoomWalletIdentity, RoomWalletRecoveryResult } from './roomWalletRecovery';
import { waitForRoomWallet } from './roomWalletRecovery';

interface LifecycleHost {
  store(): PendingRoomWalletStore;
  enabled(): boolean;
  identity(): RoomWalletIdentity;
  check(pending: PendingRoomWallet, signal: AbortSignal): Promise<RoomWalletRecoveryResult>;
}

/** One finite burst per return/load. No pending approvals means no timer or request. */
export class RoomWalletRecoveryLifecycle {
  private active: { controller: AbortController; identity: RoomWalletIdentity; done: Promise<void> } | null = null;
  private readonly nextAutomaticCheck = new Map<string, number>();
  constructor(private readonly host: LifecycleHost) {}

  notify(): Promise<void> {
    const account = this.host.identity(), active = this.active;
    if (active && (!this.host.enabled() || account.userId !== active.identity.userId || account.wallet !== active.identity.wallet)) {
      active.controller.abort();
    }
    if (!this.host.enabled() || !account.userId || !account.wallet) return Promise.resolve();
    if (active && !active.controller.signal.aborted) return active.done;
    const pending = this.host.store().list().filter(p => p.userId === account.userId
      && p.wallet === account.wallet?.toLowerCase() && Date.now() >= (this.nextAutomaticCheck.get(p.id) ?? 0));
    if (!pending.length) return Promise.resolve();
    const controller = new AbortController();
    for (const p of pending) this.nextAutomaticCheck.set(p.id, Date.now() + 30_000);
    const burst = { controller, identity: { ...account }, done: Promise.resolve() };
    const timer = setTimeout(() => controller.abort(), 45_000);
    burst.done = this.run(pending, controller.signal).finally(() => {
      clearTimeout(timer); controller.abort();
      if (this.active === burst) this.active = null;
    });
    this.active = burst;
    return burst.done;
  }

  cancel(): void { this.active?.controller.abort(); }

  private async run(initial: PendingRoomWallet[], signal: AbortSignal): Promise<void> {
    let pending = initial;
    try {
      for (let attempt = 0; attempt < 3 && !signal.aborted && pending.length; attempt++) {
        if (attempt) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await waitForRoomWallet(new Promise<void>(resolve => { timer = setTimeout(resolve, attempt === 1 ? 1_000 : 3_000); }), signal); }
          finally { clearTimeout(timer); }
        }
        const next: PendingRoomWallet[] = [];
        for (const p of pending) {
          if (signal.aborted) return;
          try {
            const result = await waitForRoomWallet(this.host.check(p, signal), signal);
            if (result.status === 'pending') next.push(p);
          } catch { if (!signal.aborted) next.push(p); }
        }
        pending = next;
      }
    } catch { /* A hidden page, changed identity or deadline cancels the whole burst. */ }
  }
}
