import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomMusicController } from './controller';
import { createDefaultRoomMusic, createDefaultRoomPatternMusic, createDefaultRoomPhraseArrangementMusic, type RoomMusic } from './model';

const render = vi.hoisted(() => vi.fn());
vi.mock('./patternRenderer', () => ({ renderRoomPatternLoopBuffer: render }));
vi.mock('./patternKit', () => ({ getPatternDrumSamples: vi.fn(async () => ({})) }));
vi.mock('./libraryClient', () => ({ loadMusicPhrasesById: vi.fn(async () => new Map()) }));

function buffer(channels = 2, length = 8000, sampleRate = 1000): AudioBuffer {
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
    getChannelData: (index: number) => data[index] } as AudioBuffer;
}

function harness(hold = true) {
  const sources: Array<ReturnType<typeof source>> = [];
  const gains: Array<ReturnType<typeof gain>> = [];
  function source() {
    return { buffer: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), addEventListener: vi.fn() };
  }
  function gain() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
      ...(hold ? { cancelAndHoldAtTime: vi.fn() } : {}) }, connect: vi.fn(), disconnect: vi.fn() };
  }
  const context = { currentTime: 1, sampleRate: 1000, state: 'running', destination: {}, addEventListener: vi.fn(),
    createBuffer: vi.fn(buffer), decodeAudioData: vi.fn(async () => buffer()),
    createBufferSource: () => { const s = source(); sources.push(s); return s; },
    createGain: () => { const g = gain(); gains.push(g); return g; } };
  vi.stubGlobal('window', { AudioContext: function () { return context; }, addEventListener: vi.fn(), location: { href: 'http://localhost/', origin: 'http://localhost' }, document: { addEventListener: vi.fn() } });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
  render.mockResolvedValue(buffer());
  return { context, sources, gains, controller: new RoomMusicController() };
}

function music(kind: 'pattern' | 'phraseArrangement' | 'stemArrangement'): RoomMusic {
  if (kind === 'pattern') {
    const p = createDefaultRoomPatternMusic(); p.tabs.triangle.steps[0] = 4; return p;
  }
  if (kind === 'phraseArrangement') {
    const p = createDefaultRoomPhraseArrangementMusic(); p.slots.drums[0] = 'phrase-test'; return p;
  }
  const p = createDefaultRoomMusic(); p.arrangement.laneAssignments.drums[0] = 'drums-1'; return p;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('public room music playback scheduling', () => {
  it.each(['pattern', 'phraseArrangement', 'stemArrangement'] as const)('fades in %s from silence and starts re-entry at offset zero', async kind => {
    const h = harness();
    await h.controller.playArrangement(music(kind), { mode: 'world-play', transition: 'room' });
    expect((h.controller.getDebugState().lastPlaybackRequest as { status: string } | null)?.status, JSON.stringify(h.controller.getDebugState().lastPlaybackRequest)).toBe('started');
    expect(h.sources[0].start).toHaveBeenCalledWith(1.02, 0);
    expect(h.gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0, 1.02);
    expect(h.gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(kind === 'stemArrangement' ? 0.8 : 1, 1.1);
    h.context.currentTime = 1.8;
    h.controller.stopArrangement({ transition: 'immediate', fadeDurationSec: 0.3, mode: 'world-play' });
    h.context.currentTime = 2;
    await h.controller.playArrangement(music(kind), { mode: 'world-play', transition: 'room' });
    expect(h.sources[1].start).toHaveBeenCalledWith(2.02, 0);
    expect(h.controller.getDebugState().transportStartTime).toBe(2.02);
  });

  it('cancels a future source before start without any positive gain reset or ramp', async () => {
    const h = harness(); const a = music('pattern'); const b = music('pattern');
    if (b.kind !== 'pattern') throw new Error('pattern'); b.tabs.triangle.steps[1] = 3;
    await h.controller.playArrangement(a, { mode: 'world-play', transition: 'room' });
    h.context.currentTime = 1.5;
    await h.controller.playArrangement(b, { mode: 'world-play', transition: 'room' });
    expect(h.sources[1].start).toHaveBeenCalledWith(3.02, 2);
    const param = h.gains[2].gain;
    param.setValueAtTime.mockClear(); param.linearRampToValueAtTime.mockClear();
    h.context.currentTime = 1.6;
    h.controller.stopArrangement({ transition: 'immediate', mode: 'world-play', fadeDurationSec: 0.3 });
    expect(h.sources[1].stop).toHaveBeenLastCalledWith(1.6);
    expect(param.setValueAtTime).toHaveBeenCalledOnce(); expect(param.setValueAtTime).toHaveBeenCalledWith(0, 1.6);
    expect(param.linearRampToValueAtTime).not.toHaveBeenCalled();
    const ended = h.sources[1].addEventListener.mock.calls[0][1] as () => void; ended();
    expect(h.sources[1].disconnect).toHaveBeenCalledOnce(); expect(h.gains[2].disconnect).toHaveBeenCalledOnce();
  });

  it('uses a short independent downbeat for a cross-tempo room and holds the outgoing envelope', async () => {
    const h = harness(); const a = music('pattern'); const b = music('pattern');
    if (b.kind !== 'pattern') throw new Error('pattern'); b.bpm = 60;
    await h.controller.playArrangement(a, { mode: 'world-play', transition: 'room' });
    h.context.currentTime = 1.5;
    await h.controller.playArrangement(b, { mode: 'world-play', transition: 'room' });
    expect(h.sources[1].start).toHaveBeenCalledWith(1.52, 0);
    expect(h.gains[1].gain.cancelAndHoldAtTime).toHaveBeenCalledWith(1.5);
    expect(h.sources[0].stop).toHaveBeenCalledWith(1.85);
    expect((h.controller.getDebugState().activePattern as { fadeInDuration: number } | null)?.fadeInDuration).toBe(0.3);
  });

  it('fallback fade starts at the known in-progress envelope rather than the AudioParam default', async () => {
    const h = harness(false);
    await h.controller.playArrangement(music('pattern'), { mode: 'world-play', transition: 'room' });
    h.context.currentTime = 1.06;
    h.controller.stopArrangement({ transition: 'immediate', mode: 'world-play', fadeDurationSec: 0.3 });
    expect(h.gains[1].gain.setValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(0.5);
  });

  it('a newer target shortens outgoing tails and silently cancels the previous queued room', async () => {
    const h = harness(); const a = music('pattern'); const b = music('pattern'); const c = music('pattern');
    if (b.kind !== 'pattern' || c.kind !== 'pattern') throw new Error('pattern');
    b.tabs.triangle.steps[1] = 3; c.bpm = 60;
    await h.controller.playArrangement(a, { mode: 'world-play', transition: 'room' });
    h.context.currentTime = 1.5;
    await h.controller.playArrangement(b, { mode: 'world-play', transition: 'room' });
    expect(h.sources[0].stop.mock.calls.at(-1)?.[0]).toBeCloseTo(5.07);
    h.context.currentTime = 1.6;
    await h.controller.playArrangement(c, { mode: 'world-play', transition: 'room' });
    expect(h.sources[0].stop.mock.calls.at(-1)?.[0]).toBeCloseTo(1.95);
    expect(h.sources[1].stop).toHaveBeenLastCalledWith(1.6);
    expect(h.sources[2].start).toHaveBeenCalledWith(1.62, 0);
    expect(h.sources[0].addEventListener).toHaveBeenCalledOnce();
    h.context.currentTime = 1.7;
    h.controller.stopArrangement({ transition: 'immediate', mode: 'idle', fadeDurationSec: 0.08 });
    expect(h.sources[0].stop.mock.calls.at(-1)?.[0]).toBeCloseTo(1.83);
    for (const s of h.sources) (s.addEventListener.mock.calls[0][1] as () => void)();
    expect(h.controller.getDebugState().retiringLoopCount).toBe(0);
  });

  it('a stale buffer load never installs a source after Stop', async () => {
    const h = harness(); let resolve!: (b: AudioBuffer) => void;
    render.mockImplementationOnce(() => new Promise<AudioBuffer>(r => { resolve = r; }));
    const pending = h.controller.playArrangement(music('pattern'), { mode: 'world-play', transition: 'room' });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    h.controller.stopArrangement({ transition: 'immediate', mode: 'idle' }); resolve(buffer()); await pending;
    expect(h.sources).toHaveLength(0); expect(h.controller.getDebugState().activePattern).toBeNull();
  });
});
