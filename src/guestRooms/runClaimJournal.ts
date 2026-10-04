import type { GuestRunClaimResponse } from './runModel';
import type { GuestRunRecoveryIdentity } from './runRepository';
import { guestRunQueueStorage } from './runFinishQueue';

export const GUEST_RUN_CLAIM_KEY_PREFIX = 'wamp_guest_claim_v1:';
const RETENTION_MS = 14 * 86400000;
const MAX_PENDING = 20;
export interface GuestRunClaimIntent {
  schemaVersion: 1;
  claimId: string;
  userId: string;
  identity: GuestRunRecoveryIdentity;
  createdAt: number;
  phase: 'pending' | 'received' | 'presented';
}

/** Persist the request ID before sending; a lost committed reply must retry that ID. */
export class GuestRunClaimJournal {
  private readonly volatile = new Map<string, GuestRunClaimIntent>();
  constructor(private readonly storage: Storage | null = guestRunQueueStorage(), private readonly now = Date.now) {}

  list(): GuestRunClaimIntent[] {
    const entries = new Map(this.volatile);
    try {
      const keys: string[] = [];
      for (let i = 0; i < (this.storage?.length ?? 0); i++) {
        const key = this.storage?.key(i);
        if (key?.startsWith(GUEST_RUN_CLAIM_KEY_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        let entry: GuestRunClaimIntent | null = null;
        try { entry = JSON.parse(this.storage!.getItem(key) ?? 'null'); } catch { /* Discard only this corrupt intent. */ }
        if (validIntent(entry, this.now()) && key === GUEST_RUN_CLAIM_KEY_PREFIX + entry.claimId) {
          if (!entries.has(entry.claimId) || entry.phase === 'presented') entries.set(entry.claimId, entry);
        }
        else this.storage?.removeItem(key);
      }
    } catch { /* Retain this tab's requests if storage is blocked. */ }
    for (const [id, entry] of entries) if (!validIntent(entry, this.now())) { entries.delete(id); this.remove(id); }
    return [...entries.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  pending(userId: string): GuestRunClaimIntent[] { return this.list().filter(entry => entry.userId === userId && entry.phase !== 'presented'); }

  create(userId: string, identity: GuestRunRecoveryIdentity, claimId: string): GuestRunClaimIntent | null {
    const all = this.list();
    if (all.filter(entry => entry.phase !== 'presented').length >= MAX_PENDING) return null;
    // Old presented receipts are only presentation dedupe; never evict an unacknowledged request.
    for (const entry of all.filter(entry => entry.phase === 'presented').slice(0, Math.max(0, all.length - 99))) this.remove(entry.claimId);
    const entry: GuestRunClaimIntent = { schemaVersion: 1, userId, identity: { ...identity }, claimId, createdAt: this.now(), phase: 'pending' };
    if (!validIntent(entry, this.now())) return null;
    this.put(entry);
    return entry;
  }

  receive(entry: GuestRunClaimIntent): void {
    const current = this.list().find(candidate => candidate.claimId === entry.claimId);
    if (current?.phase === 'presented') return;
    this.put({ ...entry, phase: 'received' });
  }

  present(receipt: GuestRunClaimResponse): boolean {
    const entry = this.list().find(candidate => candidate.claimId === receipt.claimId && candidate.userId === receipt.userId);
    if (!entry || entry.phase === 'presented') return false;
    this.put({ ...entry, phase: 'presented' });
    return true;
  }

  remove(id: string): void {
    this.volatile.delete(id);
    try { this.storage?.removeItem(GUEST_RUN_CLAIM_KEY_PREFIX + id); } catch { /* Server request remains idempotent. */ }
  }

  private put(entry: GuestRunClaimIntent): void {
    // Store no browser-authored XP amounts; every displayed receipt is fetched again from the server.
    try { if (this.storage) { this.storage.setItem(GUEST_RUN_CLAIM_KEY_PREFIX + entry.claimId, JSON.stringify(entry)); this.volatile.delete(entry.claimId); return; } }
    catch { /* A blocked tab can still retry in this session. */ }
    this.volatile.set(entry.claimId, entry);
  }
}

function validIntent(entry: GuestRunClaimIntent | null, now: number): entry is GuestRunClaimIntent {
  return Boolean(entry && entry.schemaVersion === 1 && typeof entry.userId === 'string' && entry.userId.length > 0 && entry.userId.length <= 128
    && /^[a-f0-9-]{36}$/i.test(entry.claimId) && Number.isFinite(entry.createdAt) && entry.createdAt <= now + 60000 && entry.createdAt > now - RETENTION_MS
    && ['pending', 'received', 'presented'].includes(entry.phase) && /^guest-[A-Za-z0-9_-]{1,74}$/.test(entry.identity?.guestUserId)
    && /^[A-Za-z0-9_-]{32,160}$/.test(entry.identity?.recoveryToken));
}
