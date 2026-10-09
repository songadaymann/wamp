import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoomPatternLoopBuffer } from './patternRenderer';
import { createDefaultRoomPatternMusic, type RoomPatternDrumRowId, type RoomPatternPlaybackSequence, type RoomPatternTonalInstrumentId } from './pattern';

const samples = vi.hoisted(() => new Map<RoomPatternDrumRowId, Float32Array>());
vi.mock('./patternKit', () => ({ getPatternDrumSamples: vi.fn(async () => samples) }));
const sampleRate = 8000;
const context = { sampleRate, createBuffer: (channels: number, length: number, rate: number) => {
  const arrays = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: (c: number) => arrays[c] } as AudioBuffer;
} } as AudioContext;

function longer(p: RoomPatternPlaybackSequence): RoomPatternPlaybackSequence {
  const next = structuredClone(p); next.stepCount *= 2; next.barCount *= 2;
  for (const id of ['triangle', 'saw', 'square'] as const) {
    next.tabs[id].steps.push(...Array.from({ length: p.stepCount }, () => null));
    next.tabs[id].midis.push(...Array.from({ length: p.stepCount }, () => null));
    next.tabs[id].ties.push(...Array.from({ length: p.stepCount }, () => false));
  }
  return next;
}

function maximumDifference(a: Float32Array, b: Float32Array, offset: number, length: number): number {
  let difference = 0;
  for (let i = 0; i < length; i++) difference = Math.max(difference, Math.abs(a[i] - b[offset + i]));
  return difference;
}

beforeEach(() => samples.clear());

describe('periodic mono music rendering', () => {
  it.each(['triangle', 'saw', 'square'] as RoomPatternTonalInstrumentId[])('folds the %s release exactly like an uncut longer phrase', async instrument => {
    const p = createDefaultRoomPatternMusic(); p.tabs[instrument].steps[31] = 4;
    const [loop, reference] = await Promise.all([renderRoomPatternLoopBuffer(context, p), renderRoomPatternLoopBuffer(context, longer(p))]);
    expect(loop.length).toBe(32000); expect(reference.length).toBe(64000);
    for (let c = 0; c < loop.numberOfChannels; c++) {
      const data = loop.getChannelData(c); const ref = reference.getChannelData(c);
      expect(data.slice(0, 80).some(v => v !== 0)).toBe(true);
      expect(maximumDifference(data, ref, loop.length, 400)).toBeLessThan(0.000001);
      expect(data.slice(400, 30000).every(v => v === 0)).toBe(true);
      expect(data.slice(-100)).toEqual(ref.slice(loop.length - 100, loop.length));
    }
  });

  it('preserves a crash tail across the seam before nonlinear drum shaping', async () => {
    samples.set('crash', Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * 0.1) * Math.exp(-i / 4000)));
    const p = createDefaultRoomPatternMusic(); p.tabs.drums.crash = [31];
    const [loop, reference] = await Promise.all([renderRoomPatternLoopBuffer(context, p), renderRoomPatternLoopBuffer(context, longer(p))]);
    expect(maximumDifference(loop.getChannelData(0), reference.getChannelData(0), loop.length, 15000)).toBeLessThan(0.000001);
    expect(loop.getChannelData(0).slice(0, 15000).some(v => v !== 0)).toBe(true);
  });

  it('folds tails longer than a fast loop into the same steady signal as repeated longer content', async () => {
    samples.set('crash', Float32Array.from({ length: 28000 }, (_, i) => Math.sin(i * 0.1) * Math.exp(-i / 8000)));
    const p = createDefaultRoomPatternMusic(); p.bpm = 200; p.tabs.drums.crash = [31];
    const twice = longer(p); twice.tabs.drums.crash = [31, 63];
    const [loop, reference] = await Promise.all([renderRoomPatternLoopBuffer(context, p), renderRoomPatternLoopBuffer(context, twice)]);
    expect(loop.length).toBe(19200);
    expect(maximumDifference(loop.getChannelData(0), reference.getChannelData(0), loop.length, loop.length)).toBeLessThan(0.000001);
  });

  it('closed hats choke an open voice over 10 ms without leaving the old tail', async () => {
    samples.set('open-hat', new Float32Array(28000).fill(1)); samples.set('closed-hat', new Float32Array(80));
    const p = createDefaultRoomPatternMusic(); p.tabs.drums['open-hat'] = [0]; p.tabs.drums['closed-hat'] = [2];
    const data = (await renderRoomPatternLoopBuffer(context, p)).getChannelData(0);
    expect(data[1999]).toBeGreaterThan(0); expect(data[2001]).toBeGreaterThan(data[2079]);
    expect(data.slice(2080).every(v => v === 0)).toBe(true);
  });

  it('a later open hat also chokes the earlier voice rather than stacking its whole tail', async () => {
    samples.set('open-hat', new Float32Array(28000).fill(1));
    const p = createDefaultRoomPatternMusic(); p.tabs.drums['open-hat'] = [0, 2];
    const data = (await renderRoomPatternLoopBuffer(context, p)).getChannelData(0);
    expect(data[1000]).toBeCloseTo(data[3000], 6);
    expect(data[2040]).toBeGreaterThan(data[3000]); // only the short choke overlap
  });

  it('chokes the prior repetition at a closed hat on the first step', async () => {
    samples.set('open-hat', new Float32Array(28000).fill(1)); samples.set('closed-hat', new Float32Array(80));
    const p = createDefaultRoomPatternMusic(); p.tabs.drums['open-hat'] = [31]; p.tabs.drums['closed-hat'] = [0];
    const data = (await renderRoomPatternLoopBuffer(context, p)).getChannelData(0);
    expect(data[0]).toBeGreaterThan(data[79]); expect(data[79]).toBeGreaterThan(0);
    expect(data.slice(80, 30000).every(v => v === 0)).toBe(true);
  });

  it('a simultaneous closed hat takes priority over an open hat', async () => {
    samples.set('open-hat', new Float32Array(28000).fill(1)); samples.set('closed-hat', new Float32Array(80));
    const p = createDefaultRoomPatternMusic(); p.tabs.drums['open-hat'] = [4]; p.tabs.drums['closed-hat'] = [4];
    expect((await renderRoomPatternLoopBuffer(context, p)).getChannelData(0).every(v => v === 0)).toBe(true);
  });

  it('uses swung event timing for the choke and keeps pan/mix behavior', async () => {
    samples.set('open-hat', new Float32Array(28000).fill(1)); samples.set('closed-hat', new Float32Array(80));
    const p = createDefaultRoomPatternMusic(); p.swingPercent = 75; p.tabs.drums['open-hat'] = [0]; p.tabs.drums['closed-hat'] = [1]; p.mix.drums.pan = -1;
    const result = await renderRoomPatternLoopBuffer(context, p); const data = result.getChannelData(0);
    expect(data[1400]).toBeGreaterThan(0); expect(data.slice(1580).every(v => v === 0)).toBe(true);
    expect(result.getChannelData(1).every(v => v === 0)).toBe(true);
  });

  it('returns finite mono silence of the original duration for a centered empty pattern', async () => {
    const result = await renderRoomPatternLoopBuffer(context, createDefaultRoomPatternMusic());
    expect(result.length).toBe(32000); expect(result.numberOfChannels).toBe(1);
    expect(result.getChannelData(0).every(v => v === 0)).toBe(true);
  });

  it('stores centered content in one channel with the exact previous stereo waveform', async () => {
    samples.set('crash', Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i * 0.1) * Math.exp(-i / 4000)));
    const p = createDefaultRoomPatternMusic(); p.tabs.triangle.steps[31] = 4; p.tabs.drums.crash = [31];
    const stereo = structuredClone(p); stereo.mix.square.pan = 0.5; // silent track forces the previous stereo mix path
    const [mono, two] = await Promise.all([renderRoomPatternLoopBuffer(context, p), renderRoomPatternLoopBuffer(context, stereo)]);
    expect(mono.numberOfChannels).toBe(1); expect(two.numberOfChannels).toBe(2);
    expect(mono.length).toBe(two.length);
    expect(mono.getChannelData(0)).toEqual(two.getChannelData(0));
    expect(maximumDifference(mono.getChannelData(0), two.getChannelData(1), 0, mono.length)).toBeLessThan(0.000001);
  });

  it('retains stereo and unequal channel levels when an audible track is panned', async () => {
    const p = createDefaultRoomPatternMusic(); p.tabs.saw.steps[0] = 4; p.mix.saw.pan = 0.5;
    const result = await renderRoomPatternLoopBuffer(context, p);
    expect(result.numberOfChannels).toBe(2);
    const peak = (c: number) => result.getChannelData(c).reduce((n, v) => Math.max(n, Math.abs(v)), 0);
    expect(peak(1)).toBeGreaterThan(peak(0)); expect(peak(0)).toBeGreaterThan(0);
  });
});
