import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameCadenceGate, installFrameCadencePacing, type FrameCadenceScheduler } from './frameCadence';
import { setFrameRateMode } from '../performance/frameRateMode';

function measure(hz: number, mode: 'auto' | '60' | 'uncapped' = 'auto', jitter = 0) {
  const gate = new FrameCadenceGate(mode);
  const renders: number[] = [];
  for (let frame = 0; frame <= hz * 4; frame += 1) {
    const time = frame * 1000 / hz + (frame % 2 === 0 ? jitter : -jitter);
    if (gate.shouldRender(time) && time >= 1000 && time < 4000) renders.push(time);
  }
  return { gate, renders, fps: renders.length / 3 };
}
afterEach(() => { setFrameRateMode('auto'); vi.unstubAllGlobals(); });

describe('cadence-aware game-frame pacing', () => {
  it.each([120, 240])('renders regular 60fps at %sHz with jitter without losing wall time', hz => {
    const result = measure(hz, 'auto', 0.2);
    expect(result.fps).toBeCloseTo(60, 0);
    expect(result.gate.describe().autoCap).toBe(true);
    const intervals = result.renders.slice(1).map((time, index) => time - result.renders[index]);
    for (const interval of intervals) expect(interval).toBeCloseTo(1000 / 60, 6);
  });
  it.each([30, 60, 90, 144, 165])('leaves %sHz uncapped in Auto', hz => {
    const result = measure(hz, 'auto', 0.15);
    expect(result.fps).toBeCloseTo(hz, 0);
    expect(result.gate.describe().autoCap).toBe(false);
  });
  it.each([60, 90, 120, 144, 165, 240])('retains deadline remainder for the explicit 60fps target at %sHz', hz => {
    expect(measure(hz, '60').fps).toBeCloseTo(60, 0);
  });
  it('preserves Uncapped even on a 120Hz display', () => {
    expect(measure(120, 'uncapped').fps).toBe(120);
  });
  it('reclassifies when the display changes from 120 to 60Hz', () => {
    const { gate } = measure(120);
    const outputs: boolean[] = [];
    for (let frame = 1; frame <= 60; frame += 1) outputs.push(gate.shouldRender(4000 + frame * 1000 / 60));
    expect(outputs.every(Boolean)).toBe(true);
    expect(gate.describe().autoCap).toBe(false);
  });
  it('does not hold a resumed frame behind the previous pacing deadline', () => {
    const { gate } = measure(120);
    expect(gate.shouldRender(8000)).toBe(true);
    expect(gate.describe().nativeHz).toBeNull();
  });
  it('retains pacing across scheduler restarts and settings changes', () => {
    const doc = new EventTarget() as Document;
    const callbacks: number[] = [];
    const scheduler: FrameCadenceScheduler = { isRunning: false, callback: () => {},
      start(callback) { this.callback = callback; this.isRunning = true; } };
    const destroy = installFrameCadencePacing(scheduler, doc);
    scheduler.start(time => callbacks.push(time), false, 16);
    for (let i = 0; i < 120; i += 1) scheduler.callback(i * 1000 / 120);
    expect(callbacks.length).toBeLessThan(80);
    scheduler.isRunning = false; callbacks.length = 0;
    scheduler.start(time => callbacks.push(time), false, 16);
    for (let i = 0; i < 120; i += 1) scheduler.callback(2000 + i * 1000 / 120);
    expect(callbacks.length).toBeLessThan(80);
    setFrameRateMode('uncapped'); callbacks.length = 0;
    for (let i = 0; i < 120; i += 1) scheduler.callback(4000 + i * 1000 / 120);
    expect(callbacks).toHaveLength(120);
    destroy();
  });
  it('feeds the installed Phaser TimeStep the full elapsed delta, not the skipped native ticks', () => {
    interface Step { lastTime: number; callback(time: number, delta: number): void; step(time: number): void }
    const TimeStep = createRequire(import.meta.url)('phaser/src/core/TimeStep.js') as new (game: object, config: object) => Step;
    const step = new TimeStep({}, { target: 60, smoothStep: false });
    const gate = new FrameCadenceGate('60');
    let elapsed = 0;
    step.callback = (_time, delta) => { elapsed += delta; };
    for (let i = 0; i <= 480; i += 1) {
      const time = i * 1000 / 120;
      if (gate.shouldRender(time)) step.step(time);
    }
    expect(elapsed).toBeCloseTo(4000, 5);
  });
});
