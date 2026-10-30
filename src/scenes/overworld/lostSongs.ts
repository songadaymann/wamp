import type { LostSongPlaySession, LostSongSample, LostSongTarget } from '../../lostSongs/model';
import { LostSongApiError, type LostSongIdentity } from '../../lostSongs/repository';
import { getLostSongService, type LostSongService } from '../../lostSongs/service';

export interface LostSongPlayContext {
  target: LostSongTarget;
  practice: boolean;
  position: { x: number; y: number };
}
interface LostSongPlayHost {
  getContext(roomId?: string): LostSongPlayContext | null;
  showStatus(message: string): void;
  onFoundChanged(): void;
}
interface Proof {
  key: string; target: LostSongTarget; identity: LostSongIdentity; startedAt: number;
  session: Promise<LostSongPlaySession>; samples: LostSongSample[]; lastSampleAt: number;
  ready: boolean;
}
/** Server sessions last 30 minutes; a proof is reused well inside that, and only for a few recent rooms. */
const PROOF_REUSE_MS = 20 * 60_000;
const MAX_KEPT_PROOFS = 16;
/** Small personal pickup controller; it never mutates goal traces or shared objects. */
export class OverworldLostSongController {
  // Kept across leaving a room and respawning, so re-entry does not start another server session.
  private proofs = new Map<string, Proof>();
  private pending = new Set<string>();
  private practice = new Set<string>();
  private retryAfter = 0;
  private lastUpdateAt = 0;
  private unsubscribe: (() => void) | null = null;
  private alive = false;
  constructor(private readonly host: LostSongPlayHost, private readonly service: LostSongService = getLostSongService()) {}
  start(): void {
    this.alive = true;
    this.unsubscribe = this.service.subscribe(() => this.host.onFoundChanged());
  }
  destroy(): void { this.alive = false; this.unsubscribe?.(); this.unsubscribe = null; this.proofs.clear(); this.practice.clear(); }
  isGhosted(roomId: string): boolean {
    return this.service.hasFound(roomId) || this.pending.has(roomId) || this.practice.has(roomId);
  }
  update(): boolean {
    const now = Date.now();
    if (now - this.lastUpdateAt < 100) return false;
    this.lastUpdateAt = now;
    const context = this.host.getContext();
    if (!context) { this.practice.clear(); return true; }
    if (context.practice || this.service.hasFound(context.target.roomId)) return true;
    const proof = this.getProof(context);
    if (proof) this.sample(proof, context.position);
    return true;
  }
  collect(roomId: string): void {
    if (this.isGhosted(roomId)) return;
    const context = this.host.getContext(roomId);
    if (!context) return;
    if (context.practice) {
      this.practice.add(roomId); this.host.onFoundChanged();
      this.host.showStatus('Lost Song found in practice. Explore other published rooms to save finds.');
      return;
    }
    const proof = this.getProof(context);
    if (!proof) return;
    this.sample(proof, context.position);
    const samples = proof.samples.map(sample => ({ ...sample }));
    this.pending.add(roomId); this.host.onFoundChanged();
    this.host.showStatus('Saving Lost Song…');
    void this.save(proof, samples, proof.ready);
  }
  private getProof(context: LostSongPlayContext): Proof | null {
    const key = JSON.stringify([context.target, this.service.getUserId()]);
    const kept = this.proofs.get(key);
    if (kept && Date.now() - kept.startedAt < PROOF_REUSE_MS) return kept;
    this.proofs.delete(key);
    if (Date.now() < this.retryAfter) return null;
    const identity = this.service.identity();
    const startedAt = Date.now(), session = this.service.repository.play(context.target, identity);
    // Starts early on entry. Attach a handler immediately, even before a pickup.
    void session.then(() => {
      const proof = this.proofs.get(key);
      if (proof?.session === session) {
        proof.startedAt = Date.now(); proof.samples = []; proof.ready = true;
      }
    }).catch(error => {
      if (this.proofs.get(key)?.session !== session || !this.alive) return;
      this.proofs.delete(key); this.retryAfter = Date.now() + 5000;
      if (error instanceof LostSongApiError && error.status === 409) {
        this.host.showStatus(error.message);
      } else this.host.showStatus('Song progress is unavailable. Touch the song to retry.');
    });
    const proof: Proof = { key, target: context.target, identity, startedAt, session, samples: [], lastSampleAt: 0, ready: false };
    this.proofs.set(key, proof);
    for (const oldest of this.proofs.keys()) {
      if (this.proofs.size <= MAX_KEPT_PROOFS) break;
      this.proofs.delete(oldest);
    }
    return proof;
  }
  private sample(proof: Proof, position: { x: number; y: number }): void {
    const atMs = Math.max(0, Date.now() - proof.startedAt), last = proof.samples.at(-1);
    if (last && atMs <= last.atMs) { last.x = position.x; last.y = position.y; return; }
    // A respawn, portal or debug pose starts a new local segment.
    if (last && (Math.abs(position.x - last.x) > 64 + (atMs - last.atMs)
      || Math.abs(position.y - last.y) > 64 + 2 * (atMs - last.atMs))) proof.samples = [];
    proof.samples.push({ atMs, x: Math.round(position.x * 10) / 10, y: Math.round(position.y * 10) / 10 });
    if (proof.samples.length > 128) proof.samples.shift();
    proof.lastSampleAt = atMs;
  }
  private async save(proof: Proof, samples: LostSongSample[], wasReady: boolean): Promise<void> {
    try {
      const session = await proof.session;
      if (!wasReady) samples = [{ ...samples.at(-1)!, atMs: 0 }];
      let receipt;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          receipt = await this.service.repository.find({ sessionId: session.id, token: session.token, samples }, proof.identity);
          break;
        } catch (error) {
          if (error instanceof LostSongApiError && error.status < 500) throw error;
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      if (!receipt) throw new Error('Missing song receipt.');
      const durable = this.service.confirm(receipt, proof.identity);
      if (this.alive && this.service.getUserId() === proof.identity.userId) this.host.showStatus(proof.identity.userId === null
        ? durable ? 'Lost Song saved on this device. Sign in to keep your finds.' : 'Lost Song saved for this visit. Sign in to keep it.'
        : 'Lost Song found!' + (receipt.xp ? ' +5 player XP.' : ''));
    } catch (error) {
      if (this.proofs.get(proof.key) === proof && error instanceof LostSongApiError && error.status === 409) this.proofs.delete(proof.key);
      if (this.alive && this.service.getUserId() === proof.identity.userId) this.host.showStatus(error instanceof LostSongApiError ? error.message : 'Lost Song could not save. Touch it again to retry.');
    } finally {
      this.pending.delete(proof.target.roomId);
      if (this.alive) this.host.onFoundChanged();
    }
  }
}
