import { getAuthDebugState } from '../auth/client';
import { GuestRunClaimJournal, type GuestRunClaimIntent } from './runClaimJournal';
import type { GuestRunClaimResponse, GuestRunClaimedListResponse } from './runModel';
import { captureGuestRunIdentity, createGuestRunRepository, GuestRunApiError, type GuestRunRecoveryIdentity, type GuestRunRepository } from './runRepository';
import { getGuestRunService, type GuestRunService } from './runService';

export const GUEST_ACCOUNT_PROGRESS_EVENT = 'wamp:guest-account-progress';
export interface GuestClaimSyncResult { retry: boolean; error: string | null }
interface Options {
  repository?: Pick<GuestRunRepository, 'claim' | 'listPending' | 'listClaimed'>;
  runs?: Pick<GuestRunService, 'flush'>;
  journal?: GuestRunClaimJournal;
  userId?: () => string | null;
  identity?: () => GuestRunRecoveryIdentity;
  uuid?: () => string;
  notify?: (receipt: GuestRunClaimResponse) => void;
}

export function guestClaimAccountId(): string | null {
  const auth = getAuthDebugState();
  return auth.authenticated && !auth.loading ? auth.user?.id ?? null : null;
}

export class GuestRunClaimService {
  private readonly repo;
  private readonly runs;
  private readonly journal;
  private readonly userId;
  private readonly identity;
  private readonly uuid;
  private readonly notify;
  private readonly verified = new Map<string, GuestRunClaimResponse>();
  private syncing: Promise<GuestClaimSyncResult> | null = null;
  constructor(options: Options = {}) {
    this.repo = options.repository ?? createGuestRunRepository(); this.runs = options.runs ?? getGuestRunService();
    this.journal = options.journal ?? new GuestRunClaimJournal(); this.userId = options.userId ?? guestClaimAccountId;
    this.identity = options.identity ?? captureGuestRunIdentity; this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.notify = options.notify ?? (receipt => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(GUEST_ACCOUNT_PROGRESS_EVENT, { detail: receipt })); });
  }

  sync(): Promise<GuestClaimSyncResult> {
    if (this.syncing) return this.syncing;
    this.syncing = this.runSync().catch(() => ({ retry: true, error: 'Progress is saved for retry. We will try again when the connection returns.' }))
      .finally(() => { this.syncing = null; });
    return this.syncing;
  }

  receipts(): GuestRunClaimResponse[] {
    const userId = this.userId(); const ids = new Set(this.journal.pending(userId ?? '').map(entry => entry.claimId));
    return [...this.verified.values()].filter(receipt => receipt.userId === userId && ids.has(receipt.claimId));
  }

  markPresented(receipt: GuestRunClaimResponse): boolean {
    if (receipt.userId !== this.userId() || this.verified.get(receipt.claimId) !== receipt) return false;
    const presented = this.journal.present(receipt);
    this.verified.delete(receipt.claimId);
    return presented;
  }

  async history(): Promise<GuestRunClaimedListResponse | null> {
    const userId = this.userId(); if (!userId) return null;
    const history = await this.repo.listClaimed();
    return this.userId() === userId && history.userId === userId ? history : null;
  }

  private async runSync(): Promise<GuestClaimSyncResult> {
    const userId = this.userId();
    const finishes = await this.runs.flush();
    let retry = finishes.length === 10 || finishes.some(result => result.status === 'queued');
    if (!userId || this.userId() !== userId) return { retry, error: null };
    // Retry original IDs even when all clears were already moved and the pending list is empty.
    const old = this.journal.pending(userId).filter(entry => !this.verified.has(entry.claimId));
    for (const entry of old.slice(0, 5)) {
      if (this.userId() !== userId) return { retry: true, error: null };
      if (!await this.send(entry)) return { retry: true, error: 'We are still saving your guest progress. Keep your browser data while we retry.' };
    }
    retry ||= old.length > 5;
    if (this.userId() !== userId) return { retry: true, error: null };
    const identity = { ...this.identity() };
    const pending = await this.repo.listPending(identity);
    if (!pending.totalClears || this.userId() !== userId) return { retry, error: null };
    const entry = this.journal.create(userId, identity, this.uuid());
    if (!entry) return { retry: true, error: 'Finish saving earlier progress before saving more clears.' };
    if (!await this.send(entry)) return { retry: true, error: 'We are still saving your guest progress. Keep your browser data while we retry.' };
    return { retry: retry || (this.verified.get(entry.claimId)?.remainingClears ?? 0) > 0, error: null };
  }

  private async send(entry: GuestRunClaimIntent): Promise<boolean> {
    if (this.userId() !== entry.userId) return false;
    try {
      const receipt = await this.repo.claim(entry.claimId, entry.identity, entry.userId);
      if (!validReceipt(receipt, entry)) throw new Error('Claim receipt account or amounts do not match the request.');
      this.journal.receive(entry);
      // Another tab may have shown this exact receipt while the request was in flight.
      if (!this.journal.pending(entry.userId).some(candidate => candidate.claimId === receipt.claimId)) return true;
      this.verified.set(receipt.claimId, receipt);
      if (this.verified.size > 20) this.verified.delete(this.verified.keys().next().value!);
      if (this.userId() === entry.userId) this.notify(receipt);
      return true;
    } catch (error) {
      if (error instanceof GuestRunApiError && [400, 410].includes(error.status)) this.journal.remove(entry.claimId);
      // Unauthorized, changed-account, throttle, network and lost replies retain the original request.
      return false;
    }
  }
}

function validReceipt(value: GuestRunClaimResponse, entry: GuestRunClaimIntent): boolean {
  return value?.claimId === entry.claimId && value.userId === entry.userId
    && [value.clearsSaved, value.pxpAwarded, value.remainingClears].every(number => Number.isSafeInteger(number) && number >= 0)
    && value.clearsSaved <= 50 && value.pxpAwarded <= value.clearsSaved * 40;
}

let service: GuestRunClaimService | null = null;
export function getGuestRunClaimService(): GuestRunClaimService { return service ??= new GuestRunClaimService(); }
