export type MobilePerformanceContext = Record<string, unknown>;

export interface MobilePerformanceSegmentSummary {
  label: string;
  count: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
  lastMs: number;
}

export interface MobilePerformanceSnapshot {
  enabled: boolean;
  reason: string;
  runningMs: number;
  totalFrames: number;
  recentFrames: number;
  approximateFps: number;
  frameDeltaMs: MetricSummary;
  updateMs: MetricSummary;
  stutterFrames: {
    over33ms: number;
    over50ms: number;
    over100ms: number;
  };
  slowUpdates: {
    over16ms: number;
    over33ms: number;
  };
  topSegments: MobilePerformanceSegmentSummary[];
  slowEvents: MobilePerformanceSlowEvent[];
  context: MobilePerformanceContext;
}

export interface MobilePerformanceProfilerApi {
  get: (reason?: string) => MobilePerformanceSnapshot;
  report: (reason?: string) => string;
  log: (reason?: string) => MobilePerformanceSnapshot;
  reset: () => MobilePerformanceSnapshot;
  setHud: (enabled: boolean) => MobilePerformanceSnapshot;
}

export interface MobilePerformanceProfilerOptions {
  getContext?: () => MobilePerformanceContext;
}

interface MetricSummary {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

interface SegmentStats {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  recentSamples: number[];
}

interface CurrentFrame {
  startedAt: number;
  deltaMs: number;
  segments: Map<string, number>;
  context: MobilePerformanceContext;
}

interface FrameSample {
  at: number;
  deltaMs: number;
  updateMs: number;
  segments: [string, number][];
  context: MobilePerformanceContext;
}

interface MobilePerformanceSlowEvent {
  atMs: number;
  reason: string;
  deltaMs: number;
  updateMs: number;
  topSegments: [string, number][];
  context: MobilePerformanceContext;
}

const MAX_RECENT_FRAMES = 360;
const MAX_RECENT_SEGMENT_SAMPLES = 240;
const MAX_SLOW_EVENTS = 24;
const DEFAULT_LOG_INTERVAL_MS = 5000;
const DEFAULT_HUD_INTERVAL_MS = 500;
const SLOW_FRAME_DELTA_MS = 50;
const VERY_SLOW_FRAME_DELTA_MS = 100;
const SLOW_UPDATE_MS = 33;

export function createMobilePerformanceProfiler(
  options: MobilePerformanceProfilerOptions = {},
): MobilePerformanceProfiler | null {
  if (!isMobilePerformanceProfilerEnabled()) {
    return null;
  }

  return new MobilePerformanceProfiler(options);
}

export function isMobilePerformanceProfilerEnabled(): boolean {
  const params = new URLSearchParams(window.location.search);
  return (
    isTruthySearchValue(params.get('mobilePerf')) ||
    isTruthySearchValue(params.get('perf'))
  );
}

export class MobilePerformanceProfiler {
  private readonly startedAt = performance.now();
  private readonly segmentStats = new Map<string, SegmentStats>();
  private readonly recentFrames: FrameSample[] = [];
  private readonly slowEvents: MobilePerformanceSlowEvent[] = [];
  private readonly logIntervalMs: number;
  private readonly hudIntervalMs: number;
  private readonly verbose: boolean;
  private currentFrame: CurrentFrame | null = null;
  private frameCount = 0;
  private nextLogAt = 0;
  private nextHudAt = 0;
  private overlayEnabled: boolean;
  private overlayEl: HTMLDivElement | null = null;
  private api: MobilePerformanceProfilerApi | null = null;

  constructor(private readonly options: MobilePerformanceProfilerOptions = {}) {
    const params = new URLSearchParams(window.location.search);
    this.logIntervalMs = clampNumber(
      Number(params.get('mobilePerfLogMs')),
      1000,
      30000,
      DEFAULT_LOG_INTERVAL_MS,
    );
    this.hudIntervalMs = clampNumber(
      Number(params.get('mobilePerfHudMs')),
      250,
      5000,
      DEFAULT_HUD_INTERVAL_MS,
    );
    this.overlayEnabled = params.get('mobilePerfHud') !== '0';
    this.verbose = isTruthySearchValue(params.get('mobilePerfVerbose'));
    const now = performance.now();
    this.nextLogAt = now + this.logIntervalMs;
    this.nextHudAt = now;
    this.installApi();
    this.log('ready');
  }

  beginFrame(deltaMs: number, context: MobilePerformanceContext = {}): void {
    if (this.currentFrame) {
      this.endFrame({ profilerWarning: 'auto-ended previous frame' });
    }

    this.currentFrame = {
      startedAt: performance.now(),
      deltaMs: sanitizeDuration(deltaMs),
      segments: new Map(),
      context: { ...context },
    };
  }

  endFrame(context: MobilePerformanceContext = {}): void {
    const frame = this.currentFrame;
    if (!frame) {
      return;
    }

    this.currentFrame = null;
    const now = performance.now();
    const updateMs = sanitizeDuration(now - frame.startedAt);
    const frameContext = {
      ...frame.context,
      ...context,
    };
    const sample: FrameSample = {
      at: now,
      deltaMs: frame.deltaMs,
      updateMs,
      segments: sortSegments(frame.segments),
      context: frameContext,
    };

    this.frameCount += 1;
    this.recentFrames.push(sample);
    while (this.recentFrames.length > MAX_RECENT_FRAMES) {
      this.recentFrames.shift();
    }

    if (frame.deltaMs >= SLOW_FRAME_DELTA_MS || updateMs >= SLOW_UPDATE_MS) {
      this.recordSlowEvent({
        atMs: Math.round(now - this.startedAt),
        reason: frame.deltaMs >= VERY_SLOW_FRAME_DELTA_MS
          ? 'very-slow-frame-gap'
          : frame.deltaMs >= SLOW_FRAME_DELTA_MS
            ? 'slow-frame-gap'
            : 'slow-update',
        deltaMs: roundMs(frame.deltaMs),
        updateMs: roundMs(updateMs),
        topSegments: sample.segments.slice(0, 6).map(([label, duration]) => [label, roundMs(duration)]),
        context: frameContext,
      });
    }

    this.maybeUpdateOutputs(now);
  }

  measure<T>(label: string, callback: () => T): T {
    const startedAt = performance.now();
    try {
      return callback();
    } finally {
      this.recordSegment(label, performance.now() - startedAt);
    }
  }

  beginSegment(): number {
    return performance.now();
  }

  endSegment(label: string, startedAt: number): void {
    this.recordSegment(label, performance.now() - startedAt);
  }

  getSnapshot(reason: string = 'manual'): MobilePerformanceSnapshot {
    const now = performance.now();
    const frameDeltas = this.recentFrames.map((frame) => frame.deltaMs);
    const updateDurations = this.recentFrames.map((frame) => frame.updateMs);
    const recentFrameDurationMs = frameDeltas.reduce((total, value) => total + value, 0);
    const context = this.safeGetContext();
    const topSegments = this.getTopSegments();

    return {
      enabled: true,
      reason,
      runningMs: Math.round(now - this.startedAt),
      totalFrames: this.frameCount,
      recentFrames: this.recentFrames.length,
      approximateFps: recentFrameDurationMs > 0
        ? roundNumber((this.recentFrames.length / recentFrameDurationMs) * 1000, 1)
        : 0,
      frameDeltaMs: summarizeMetric(frameDeltas),
      updateMs: summarizeMetric(updateDurations),
      stutterFrames: {
        over33ms: frameDeltas.filter((value) => value > 33.4).length,
        over50ms: frameDeltas.filter((value) => value > 50).length,
        over100ms: frameDeltas.filter((value) => value > 100).length,
      },
      slowUpdates: {
        over16ms: updateDurations.filter((value) => value > 16.7).length,
        over33ms: updateDurations.filter((value) => value > 33.4).length,
      },
      topSegments,
      slowEvents: [...this.slowEvents],
      context,
    };
  }

  report(reason: string = 'manual'): string {
    return JSON.stringify(this.getSnapshot(reason), null, 2);
  }

  log(reason: string = 'manual'): MobilePerformanceSnapshot {
    const snapshot = this.getSnapshot(reason);
    console.log('WAMP_MOBILE_PERF', snapshot);
    return snapshot;
  }

  reset(): MobilePerformanceSnapshot {
    this.segmentStats.clear();
    this.recentFrames.length = 0;
    this.slowEvents.length = 0;
    this.frameCount = 0;
    this.currentFrame = null;
    const now = performance.now();
    this.nextLogAt = now + this.logIntervalMs;
    this.nextHudAt = now;
    return this.log('reset');
  }

  setHud(enabled: boolean): MobilePerformanceSnapshot {
    this.overlayEnabled = enabled;
    if (!enabled) {
      this.removeOverlay();
    }
    const snapshot = this.getSnapshot('set-hud');
    this.updateOverlay(snapshot);
    return snapshot;
  }

  destroy(): void {
    this.removeOverlay();
    if (window.wampMobilePerf === this.api) {
      delete window.wampMobilePerf;
    }
    this.api = null;
    this.currentFrame = null;
  }

  private recordSegment(label: string, durationMs: number): void {
    const sanitizedDuration = sanitizeDuration(durationMs);
    let stats = this.segmentStats.get(label);
    if (!stats) {
      stats = {
        count: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0,
        recentSamples: [],
      };
      this.segmentStats.set(label, stats);
    }

    stats.count += 1;
    stats.totalMs += sanitizedDuration;
    stats.maxMs = Math.max(stats.maxMs, sanitizedDuration);
    stats.lastMs = sanitizedDuration;
    stats.recentSamples.push(sanitizedDuration);
    while (stats.recentSamples.length > MAX_RECENT_SEGMENT_SAMPLES) {
      stats.recentSamples.shift();
    }

    if (this.currentFrame) {
      const existing = this.currentFrame.segments.get(label) ?? 0;
      this.currentFrame.segments.set(label, existing + sanitizedDuration);
    } else if (sanitizedDuration >= SLOW_UPDATE_MS) {
      this.recordSlowEvent({
        atMs: Math.round(performance.now() - this.startedAt),
        reason: 'slow-off-frame-segment',
        deltaMs: 0,
        updateMs: roundMs(sanitizedDuration),
        topSegments: [[label, roundMs(sanitizedDuration)]],
        context: this.safeGetContext(),
      });
      this.maybeUpdateOutputs(performance.now());
    }
  }

  private recordSlowEvent(event: MobilePerformanceSlowEvent): void {
    this.slowEvents.push(event);
    while (this.slowEvents.length > MAX_SLOW_EVENTS) {
      this.slowEvents.shift();
    }

    if (this.verbose) {
      console.log('WAMP_MOBILE_STUTTER', event);
    }
  }

  private getTopSegments(): MobilePerformanceSegmentSummary[] {
    return Array.from(this.segmentStats.entries())
      .map(([label, stats]) => {
        const recentTotal = stats.recentSamples.reduce((total, value) => total + value, 0);
        return {
          label,
          count: stats.count,
          totalMs: roundMs(recentTotal),
          avgMs: roundMs(average(stats.recentSamples)),
          maxMs: roundMs(Math.max(0, ...stats.recentSamples)),
          p95Ms: roundMs(percentile(stats.recentSamples, 95)),
          lastMs: roundMs(stats.lastMs),
        };
      })
      .sort((left, right) => {
        if (right.totalMs !== left.totalMs) {
          return right.totalMs - left.totalMs;
        }
        return right.maxMs - left.maxMs;
      })
      .slice(0, 12);
  }

  private maybeUpdateOutputs(now: number): void {
    if (this.overlayEnabled && now >= this.nextHudAt) {
      this.nextHudAt = now + this.hudIntervalMs;
      this.updateOverlay(this.getSnapshot('hud'));
    }

    if (now >= this.nextLogAt) {
      this.nextLogAt = now + this.logIntervalMs;
      this.log('interval');
    }
  }

  private updateOverlay(snapshot: MobilePerformanceSnapshot): void {
    if (!this.overlayEnabled) {
      return;
    }

    const overlay = this.ensureOverlay();
    const topSegments = snapshot.topSegments
      .slice(0, 4)
      .map((segment) => `${segment.label} ${segment.avgMs}/${segment.maxMs}`)
      .join('\n');
    overlay.textContent = [
      'WAMP PERF',
      `fps ${snapshot.approximateFps}  d95 ${snapshot.frameDeltaMs.p95} max ${snapshot.frameDeltaMs.max}`,
      `upd avg ${snapshot.updateMs.avg} p95 ${snapshot.updateMs.p95} max ${snapshot.updateMs.max}`,
      `stutter >50 ${snapshot.stutterFrames.over50ms} >100 ${snapshot.stutterFrames.over100ms}`,
      topSegments,
    ].filter(Boolean).join('\n');
  }

  private ensureOverlay(): HTMLDivElement {
    if (this.overlayEl?.isConnected) {
      return this.overlayEl;
    }

    const overlay = document.createElement('div');
    overlay.id = 'mobile-performance-profiler';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      top: 'max(8px, env(safe-area-inset-top))',
      left: '8px',
      zIndex: '10000',
      maxWidth: '260px',
      padding: '6px',
      border: '2px solid #1f1f2e',
      background: '#ffffff',
      color: '#1f1f2e',
      fontFamily: 'Courier New, monospace',
      fontSize: '10px',
      lineHeight: '1.2',
      whiteSpace: 'pre-wrap',
      pointerEvents: 'none',
      userSelect: 'none',
      opacity: '0.88',
    });
    document.body.appendChild(overlay);
    this.overlayEl = overlay;
    return overlay;
  }

  private removeOverlay(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  private installApi(): void {
    this.api = {
      get: (reason) => this.getSnapshot(reason ?? 'console-get'),
      report: (reason) => this.report(reason ?? 'console-report'),
      log: (reason) => this.log(reason ?? 'console-log'),
      reset: () => this.reset(),
      setHud: (enabled) => this.setHud(enabled),
    };
    window.wampMobilePerf = this.api;
  }

  private safeGetContext(): MobilePerformanceContext {
    try {
      return this.options.getContext?.() ?? {};
    } catch (error) {
      return {
        contextError: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

function summarizeMetric(values: number[]): MetricSummary {
  return {
    avg: roundMs(average(values)),
    p50: roundMs(percentile(values, 50)),
    p95: roundMs(percentile(values, 95)),
    p99: roundMs(percentile(values, 99)),
    max: roundMs(Math.max(0, ...values)),
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function sortSegments(segments: Map<string, number>): [string, number][] {
  return Array.from(segments.entries()).sort((left, right) => right[1] - left[1]);
}

function sanitizeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function roundMs(value: number): number {
  return roundNumber(value, 2);
}

function roundNumber(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function isTruthySearchValue(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '' || ['1', 'true', 'yes', 'on'].includes(normalized);
}
