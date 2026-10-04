import { getFrameRateMode, subscribeFrameRateMode, type FrameRateMode } from '../performance/frameRateMode';

const SAMPLE_COUNT = 24;
const FRAME_MS = 1000 / 60;
// Two 120Hz or four 240Hz ticks comfortably pass despite rAF timestamp jitter.
const AUTO_MIN_FRAME_MS = 1000 / 70;

export class FrameCadenceGate {
  private mode: FrameRateMode;
  private previousNativeAt: number | null = null;
  private previousRenderAt: number | null = null;
  private nextForcedAt: number | null = null;
  private samples: number[] = [];
  private nativeHz: number | null = null;
  private autoCap = false;
  private renderedFrames = 0;
  private nativeFrames = 0;
  constructor(mode: FrameRateMode = 'auto') { this.mode = mode; }

  setMode(mode: FrameRateMode): void { this.mode = mode; this.reset(); }
  reset(): void {
    this.previousNativeAt = null; this.previousRenderAt = null; this.nextForcedAt = null;
    this.samples = []; this.nativeHz = null; this.autoCap = false;
  }
  shouldRender(now: number): boolean {
    if (!Number.isFinite(now)) return true;
    if (this.previousNativeAt !== null) {
      const delta = now - this.previousNativeAt;
      if (delta <= 0 || delta > 250) this.reset();
      else this.samples.push(delta);
    }
    this.previousNativeAt = now;
    this.nativeFrames += 1;
    if (this.samples.length === SAMPLE_COUNT) {
      const sorted = this.samples.sort((a, b) => a - b);
      const median = (sorted[11] + sorted[12]) / 2;
      const stable = sorted.filter(value => Math.abs(value - median) <= median * 0.12).length >= 20;
      if (stable) {
        this.nativeHz = 1000 / median;
        this.autoCap = [120, 240].some(hz => Math.abs(this.nativeHz! - hz) <= hz * 0.045);
      }
      this.samples = [];
    }
    const elapsed = this.previousRenderAt === null ? Infinity : now - this.previousRenderAt;
    let render = true;
    if (this.mode === 'auto' && this.autoCap) render = elapsed >= AUTO_MIN_FRAME_MS;
    if (this.mode === '60' && this.nextForcedAt !== null) render = now + 0.1 >= this.nextForcedAt;
    if (render) {
      this.previousRenderAt = now;
      this.renderedFrames += 1;
      if (this.mode === '60') {
        // Retain the deadline remainder rather than discarding elapsed time.
        const previous = this.nextForcedAt ?? now;
        this.nextForcedAt = previous + Math.max(1, Math.floor((now - previous + 0.1) / FRAME_MS) + 1) * FRAME_MS;
      }
    }
    return render;
  }
  describe() { return { mode: this.mode, nativeHz: this.nativeHz, autoCap: this.mode === 'auto' && this.autoCap,
    renderedFrames: this.renderedFrames, nativeFrames: this.nativeFrames }; }
}

export interface FrameCadenceScheduler {
  isRunning: boolean;
  callback: FrameRequestCallback;
  start(callback: FrameRequestCallback, forceSetTimeOut: boolean, delay: number): void;
}
let activeGate: FrameCadenceGate | null = null;
export function getFrameCadenceDebugState() { return activeGate?.describe() ?? null; }

export function installFrameCadencePacing(scheduler: FrameCadenceScheduler, doc: Document = document): () => void {
  const gate = new FrameCadenceGate(getFrameRateMode());
  activeGate = gate;
  const originalStart = scheduler.start;
  let currentRawCallback = scheduler.callback;
  let currentWrappedCallback = scheduler.callback;
  const wrap = (callback: FrameRequestCallback): FrameRequestCallback => time => {
    if (doc.hidden) { gate.reset(); callback(time); return; }
    if (gate.shouldRender(time)) callback(time);
  };
  // All loop starts, including visibility wakes and graphics recovery, retain pacing.
  const start: FrameCadenceScheduler['start'] = function (callback, forceSetTimeOut, delay) {
    if (scheduler.isRunning) return;
    gate.reset();
    currentRawCallback = callback;
    currentWrappedCallback = wrap(callback);
    originalStart.call(scheduler, currentWrappedCallback, forceSetTimeOut, delay);
  };
  scheduler.start = start;
  if (scheduler.isRunning) {
    currentWrappedCallback = wrap(currentRawCallback);
    scheduler.callback = currentWrappedCallback;
  }
  const unsubscribe = subscribeFrameRateMode(mode => gate.setMode(mode));
  const reset = () => gate.reset();
  doc.addEventListener('visibilitychange', reset);
  return () => {
    unsubscribe(); doc.removeEventListener('visibilitychange', reset);
    if (scheduler.start === start) scheduler.start = originalStart;
    if (scheduler.callback === currentWrappedCallback) scheduler.callback = currentRawCallback;
    if (activeGate === gate) activeGate = null;
  };
}
