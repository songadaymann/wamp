import type { RoomRecord } from '../../persistence/roomModel';

export interface RoomCollectionStageOptions {
  isCurrent?: () => boolean;
  stageLabel?: string;
  signal?: AbortSignal;
  cancel?: () => void;
}

interface CollectionStatus {
  text: string;
  accentText: string;
  linkLabel: string;
  linkHref: string | null;
}

interface CollectionIdentity { userId: string | null; wallet: string | null; signer?: string | null }
interface CollectionEvents {
  on(event: string, callback: () => void): unknown;
  off(event: string, callback: () => void): unknown;
}

export interface RoomCollectionFlowHost {
  captureContext(): () => boolean;
  isActive(): boolean;
  events?: CollectionEvents;
  getIdentity(): CollectionIdentity;
  watchIdentity?(onChange: () => void): () => void;
  mint(options: RoomCollectionStageOptions): Promise<RoomRecord | null>;
  artwork(options: RoomCollectionStageOptions): Promise<RoomRecord | null>;
  canAddArtwork(): boolean;
  isArtworkSubmitted(): boolean;
  isArtworkPending?(): boolean;
  isCollectionSubmitted?(): boolean;
  onStateChanged?(): void;
  onArtworkPending?(status: CollectionStatus): void;
  getStatus(): CollectionStatus;
  setStatus(status: CollectionStatus): void;
}

/** A confirmed mint survives an unsuccessful second artwork approval. */
export class RoomCollectionFlow {
  private active: object | null = null;
  constructor(private readonly host: RoomCollectionFlowHost) {}

  get isCollecting(): boolean { return this.active !== null; }

  collect(): Promise<RoomRecord | null> { return this.run(false); }

  addArtwork(): Promise<RoomRecord | null> { return this.run(true); }

  private async run(artworkOnly: boolean): Promise<RoomRecord | null> {
    if (this.active || !this.host.isActive()) return null;
    const operation = {}, context = this.host.captureContext(), identity = this.host.getIdentity();
    const recovering = this.host.isCollectionSubmitted?.() ?? false;
    const wallet = identity.wallet?.trim().toLowerCase() ?? null;
    let signerSeen = Boolean(identity.signer);
    let cancelled = false;
    const controller = new AbortController();
    const invalidate = () => { cancelled = true; controller.abort(); };
    const events = ['sleep', 'shutdown', 'destroy'];
    for (const event of events) this.host.events?.on(event, invalidate);
    const sameIdentity = () => {
      const next = this.host.getIdentity();
      const signer = next.signer?.trim().toLowerCase() ?? null;
      const signerCurrent = !wallet || (signer ? signer === wallet : !signerSeen);
      if (wallet && signer === wallet) signerSeen = true;
      return next.userId === identity.userId
        && (next.wallet?.trim().toLowerCase() ?? null) === wallet && signerCurrent;
    };
    const unwatchIdentity = this.host.watchIdentity?.(() => { if (!sameIdentity()) invalidate(); });
    const current = () => !cancelled && context() && this.host.isActive() && sameIdentity();
    this.active = operation;
    try {
      this.host.onStateChanged?.();
      if (artworkOnly) {
        try { return await this.host.artwork({ isCurrent: current, signal: controller.signal, cancel: invalidate, stageLabel: 'Add/update artwork' }); }
        catch {
          if (current()) this.host.setStatus({ text: 'Could not check room artwork. Choose Add/update artwork to try again.', accentText: '', linkLabel: '', linkHref: null });
          return null;
        }
      }
      let minted: RoomRecord | null;
      try { minted = await this.host.mint({ isCurrent: current, signal: controller.signal, cancel: invalidate, stageLabel: 'Step 1 of 2: Collect room' }); }
      catch {
        if (current()) this.host.setStatus({ text: 'Could not finish checking this collection. Check the room before trying again.', accentText: '', linkLabel: '', linkHref: null });
        return null;
      }
      if (!minted || recovering || !current() || !identity.userId || !wallet || !this.host.canAddArtwork()) return minted;
      const mintStatus = { ...this.host.getStatus() };
      try {
        const artwork = await this.host.artwork({ isCurrent: current, signal: controller.signal, cancel: invalidate, stageLabel: 'Step 2 of 2: Add artwork' });
        if (artwork) return artwork;
      } catch { /* Preserve the successful first stage; the existing artwork action retries only artwork. */ }
      if (current()) {
        const status = { ...mintStatus, accentText: `Collected token #${minted.mintedTokenId}`,
          text: this.host.isArtworkSubmitted()
            ? 'Your room is collected. The artwork approval was submitted. Choose Add/update artwork to check it without another wallet approval.'
            : this.host.isArtworkPending?.()
              ? 'Your room is collected. The artwork approval is not confirmed yet. Choose Add/update artwork to check it without another wallet approval.'
            : "Artwork wasn't added. Choose Add/update artwork to finish; your room is already collected.",
        };
        this.host.setStatus(status);
        this.host.onArtworkPending?.(status);
      }
      return minted;
    } finally {
      for (const event of events) this.host.events?.off(event, invalidate);
      unwatchIdentity?.();
      if (this.active === operation) this.active = null;
      if (context() && this.host.isActive()) this.host.onStateChanged?.();
    }
  }
}
