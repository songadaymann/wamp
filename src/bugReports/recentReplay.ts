import type { ReplayAction, ReplaySample } from '../analytics/replay/model';
import { BUG_EVIDENCE_LIMIT, BUG_FRAME_COUNT, BUG_REPLAY_MS, type BugContext, type BugEvidence } from './model';

/** Time and byte bounded; at most one capture in flight, with generation-safe privacy resets. */
export class RecentBugReplay {
  private frames: ReplaySample[] = [];
  private bytes = 0;
  private generation = 0;
  private busy = false;
  private nextAt = 0;
  private interval = 125;
  private frozen = false;
  private allowed = true;
  private captures = 0;
  private slow = 0;
  private maxCaptureMs = 0;
  constructor(private readonly capture: () => Promise<string | null>, private readonly now = () => performance.now()) {}
  setAllowed(value: boolean): void {
    if (value === this.allowed) return;
    this.allowed = value; this.generation++; this.frames = []; this.bytes = 0;
  }
  setFrozen(value: boolean): void { this.frozen = value; }
  setPhone(value: boolean): void { this.interval = Math.max(this.interval, value ? 250 : 125); }
  latestImage(): string | null {
    const latest = this.frames.at(-1);
    return this.allowed && latest && this.now() - latest.time < 1500 ? latest.image : null;
  }
  async onFrame(context: BugContext | (() => BugContext), actions: ReplayAction[] = []): Promise<void> {
    const time = this.now();
    this.trim(time);
    if (!this.allowed || this.frozen || this.busy || time < this.nextAt) return;
    this.nextAt = time + this.interval;
    const current = typeof context === 'function' ? context() : context;
    if (current.mode === 'browse') return;
    this.busy = true;
    const generation = this.generation;
    const capturedActions = actions.splice(0, 12);
    try {
      const image = await this.capture();
      if (generation !== this.generation || !this.allowed || this.frozen) return;
      const duration = this.now() - time;
      this.captures++; this.maxCaptureMs = Math.max(this.maxCaptureMs, duration);
      if (duration > 50) { this.slow++; this.interval = Math.min(1000, this.interval * 2); }
      const frame: ReplaySample = { sequence: 0, time: Math.round(time), mode: current.mode, screen: 'game',
        room: current.roomId, player: current.player, actions: capturedActions, image };
      this.frames.push(frame); this.bytes += JSON.stringify(frame).length;
      this.trim(this.now());
    } finally { this.busy = false; }
  }
  private trim(now: number): void {
    while (this.frames.length && (this.frames[0].time < now - BUG_REPLAY_MS || this.frames.length > BUG_FRAME_COUNT
      || this.bytes > BUG_EVIDENCE_LIMIT - 30_000)) {
      this.bytes -= JSON.stringify(this.frames.shift()!).length;
    }
  }
  freeze(): BugEvidence {
    this.trim(this.now()); this.frozen = true;
    if (!this.allowed) return { samples: [], screenshot: null, reason: 'disabled' };
    const offset = this.frames[0]?.time ?? 0;
    const screenshot = this.latestImage();
    const samples = this.frames.map((frame, sequence) => ({ ...frame, sequence, time: frame.time - offset,
      player: frame.player ? { ...frame.player } : null, actions: [...frame.actions] }));
    return screenshot || samples.some(s => s.image) ? { samples, screenshot, reason: 'captured' }
      : { samples: [], screenshot: null, reason: 'unavailable' };
  }
  debug(): Record<string, unknown> {
    return { frames: this.frames.length, bytes: this.bytes, intervalMs: this.interval, busy: this.busy,
      allowed: this.allowed, frozen: this.frozen, captures: this.captures, slowCaptures: this.slow, maxCaptureMs: Math.round(this.maxCaptureMs) };
  }
  destroy(): void { this.generation++; this.allowed = false; this.frames = []; this.bytes = 0; }
}
