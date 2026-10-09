import type { LostSongFindReceipt } from './model';
import { captureLostSongIdentity, createLostSongRepository, type LostSongIdentity, type LostSongRepository } from './repository';

const STORAGE_KEY = 'ep_lost_songs_v1';
const MAX_GUEST_FINDS = 5000;
const GUEST_RETENTION_MS = 30 * 86_400_000;
interface GuestFind { roomId: string; foundAt: string }

/** A session cache. Published receipts alone enter guest storage or account progress. */
export class LostSongService {
  private userId: string | null = null;
  private guestFinds: GuestFind[] = [];
  private found = new Set<string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private total = 0;
  private pending = false;
  private status = '';
  private loaded = false;
  private load: Promise<void> | null = null;
  private claimAfter = 0;
  private guestDurable = false;
  constructor(
    readonly repository: LostSongRepository = createLostSongRepository(),
    private readonly storage: Storage | null = safeStorage(),
    private readonly identityFactory = captureLostSongIdentity,
  ) {
    try {
      const raw: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
      this.guestDurable = Boolean(storage);
      if (Array.isArray(raw)) this.guestFinds = raw.filter((row): row is GuestFind => Boolean(row
        && typeof row === 'object' && typeof row.roomId === 'string' && /^-?\d{1,6},-?\d{1,6}$/.test(row.roomId)
        && typeof row.foundAt === 'string' && Date.parse(row.foundAt) > Date.now() - GUEST_RETENTION_MS)).slice(-MAX_GUEST_FINDS);
    } catch { /* Storage can be blocked; confirmed progress still lives for this tab. */ }
    this.resetGuestView();
  }
  identity(): LostSongIdentity { return this.identityFactory(this.userId); }
  getUserId(): string | null { return this.userId; }
  hasFound(roomId: string): boolean { return this.found.has(roomId); }
  snapshot() { return { total: this.total, pending: this.pending, status: this.status, guest: this.userId === null, durable: this.guestDurable }; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async setUser(userId: string | null): Promise<void> {
    if (this.userId !== userId) {
      this.userId = userId; this.revision++; this.loaded = false; this.load = null; this.claimAfter = 0;
      this.found = new Set(); this.total = 0; this.status = ''; this.pending = false;
      if (!userId) this.resetGuestView();
      this.emit();
    }
    if (!userId) return;
    if (this.load) return this.load;
    if (Date.now() < this.claimAfter) return;
    if (this.loaded && (!this.guestFinds.length || Date.now() < this.claimAfter)) return;
    const revision = this.revision, identity = this.identity();
    this.pending = true; this.emit();
    const run = this.loadAccount(revision, identity);
    this.load = run;
    try { await run; } finally { if (revision === this.revision) { this.load = null; this.pending = false; this.emit(); } }
  }
  private async loadAccount(revision: number, identity: LostSongIdentity): Promise<void> {
    const current = () => revision === this.revision;
    try {
      let claimFailed = false;
      try {
        let batches = 0;
        for (const chunk of chunks(this.guestFinds.map(find => find.roomId), 50)) {
          if (!current()) return;
          if (++batches > 8) break;
          const receipt = await this.repository.claim(chunk, identity);
          const handled = new Set([...receipt.claimed, ...receipt.skipped]);
          this.guestFinds = this.guestFinds.filter(find => !handled.has(find.roomId)); this.saveGuest();
          if (!current()) return;
          for (const id of receipt.claimed) this.addFound(id);
        }
      } catch {
        if (!current()) return;
        claimFailed = true;
      }
      this.claimAfter = Date.now() + 65_000;
      if (!this.loaded) {
        let cursor = '';
        const found = new Set<string>(); let total = 0;
        do {
          const page = await this.repository.progress(cursor);
          if (!current()) return;
          for (const id of page.roomIds) found.add(id);
          total = page.total;
          if (page.nextCursor === cursor) throw new Error('Progress pagination stalled.');
          cursor = page.nextCursor ?? '';
        } while (cursor);
        // A pickup can finish while the initial list is loading.
        for (const id of this.found) found.add(id);
        this.found = found; this.total = Math.max(total, found.size); this.loaded = true;
      }
      this.status = claimFailed ? 'Guest finds are waiting to save. Return to retry.'
        : this.guestFinds.length ? 'More guest finds will save when you return.' : '';
    } catch {
      if (current()) { this.claimAfter = Date.now() + 65_000; this.status = 'Song progress could not load. Return to retry.'; }
    }
  }
  confirm(receipt: LostSongFindReceipt, identity: LostSongIdentity): boolean {
    if (identity.userId === null) {
      if (!this.guestFinds.some(find => find.roomId === receipt.roomId)) {
        this.guestFinds.push({ roomId: receipt.roomId, foundAt: receipt.foundAt });
        this.guestFinds = this.guestFinds.slice(-MAX_GUEST_FINDS); this.saveGuest();
      }
      if (this.userId === null) this.addFound(receipt.roomId);
    } else if (this.userId === identity.userId) this.addFound(receipt.roomId);
    this.emit();
    return identity.userId !== null || this.guestDurable;
  }
  private addFound(id: string): void { if (!this.found.has(id)) { this.found.add(id); this.total++; } }
  private resetGuestView(): void { this.found = new Set(this.guestFinds.map(find => find.roomId)); this.total = this.found.size; }
  private saveGuest(): void {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.guestFinds)); this.guestDurable = Boolean(this.storage); }
    catch { this.guestDurable = false; }
  }
  private emit(): void { for (const listener of this.listeners) listener(); }
}
function* chunks<T>(items: T[], count: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += count) yield items.slice(i, i + count);
}
function safeStorage(): Storage | null { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } }
let service: LostSongService | null = null;
export function getLostSongService(): LostSongService { return service ??= new LostSongService(); }
