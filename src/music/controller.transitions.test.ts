import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomMusicController } from './controller';
import { loadMusicPhrasesById } from './libraryClient';
import { getPatternDrumSamples } from './patternKit';
import type { RoomPatternDrumRowId } from './pattern';
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
  const windowEvents = new Map<string, () => void>();
  const documentEvents = new Map<string, () => void>();
  const doc = { hidden: false, addEventListener: (name: string, listener: () => void) => documentEvents.set(name, listener) };
  const sources: Array<ReturnType<typeof source>> = [];
  const gains: Array<ReturnType<typeof gain>> = [];
  function source() {
    return { buffer: null, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), addEventListener: vi.fn() };
  }
  function gain() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
      ...(hold ? { cancelAndHoldAtTime: vi.fn() } : {}) }, connect: vi.fn(), disconnect: vi.fn() };
  }
  const context = { currentTime: 1, sampleRate: 1000, state: 'running', destination: {}, addEventListener: vi.fn(),
    suspend: vi.fn(async (): Promise<void> => {}), resume: vi.fn(async (): Promise<void> => {}),
    createBuffer: vi.fn(buffer), decodeAudioData: vi.fn(async () => buffer()),
    createBufferSource: () => { const s = source(); sources.push(s); return s; },
    createGain: () => { const g = gain(); gains.push(g); return g; } };
  context.suspend.mockImplementation(async () => { context.state = 'suspended'; });
  context.resume.mockImplementation(async () => { context.state = 'running'; });
  const contextConstructor = vi.fn(function () { return context; });
  vi.stubGlobal('window', { AudioContext: contextConstructor, addEventListener: (name: string, listener: () => void) => windowEvents.set(name, listener), location: { href: 'http://localhost/', origin: 'http://localhost' }, document: doc });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
  render.mockResolvedValue(buffer());
  return { context, contextConstructor, sources, gains, doc, windowEvents,
    visibility(hidden: boolean) { doc.hidden = hidden; documentEvents.get('visibilitychange')?.(); },
    controller: new RoomMusicController() };
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

describe('muted room music ownership', () => {
  it.each(['pattern', 'phraseArrangement', 'stemArrangement'] as const)('skips all %s loading, rendering and context creation at volume zero', async kind => {
    const h = harness(); h.controller.setVolume(0);
    await h.controller.playArrangement(music(kind), { mode: 'world-play', transition: 'room' });
    expect(render).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(loadMusicPhrasesById).not.toHaveBeenCalled(); expect(h.contextConstructor).not.toHaveBeenCalled();
    expect((h.controller.getDebugState().lastPlaybackRequest as { status: string }).status).toBe('muted');
  });

  it('resumes only the latest cloned room target when music returns', async () => {
    const h = harness(); h.controller.setVolume(0);
    const first = music('pattern'); const latest = music('pattern');
    if (latest.kind !== 'pattern') throw new Error('pattern'); latest.bpm = 60;
    await h.controller.playArrangement(first, { mode: 'world-play', transition: 'room' });
    await h.controller.playArrangement(latest, { mode: 'world-play', transition: 'room' });
    latest.bpm = 90;
    h.controller.setVolume(0.5);
    await vi.waitFor(() => expect(h.sources).toHaveLength(1));
    expect(render).toHaveBeenCalledOnce(); expect(render.mock.calls[0][1].bpm).toBe(60);
    expect(h.sources[0].start).toHaveBeenCalledWith(1.02, 0);
  });

  it.each(['stop', 'silent'] as const)('%s while muted cancels automatic resumption', async action => {
    const h = harness(); h.controller.setVolume(0);
    await h.controller.playArrangement(music('pattern'), { mode: 'editor-preview', transition: 'immediate' });
    if (action === 'stop') h.controller.stopArrangement({ mode: 'idle', transition: 'immediate', resetTransport: true });
    else await h.controller.playArrangement(null, { mode: 'world-play', transition: 'room' });
    h.controller.setVolume(1); await Promise.resolve();
    expect(render).not.toHaveBeenCalled(); expect(h.sources).toHaveLength(0);
  });

  it('stops owned audio on mute and restarts the current target from its downbeat', async () => {
    const h = harness(); await h.controller.playArrangement(music('pattern'), { mode: 'world-play', transition: 'room' });
    h.context.currentTime = 1.5; h.controller.setVolume(0);
    expect(h.sources[0].stop.mock.calls.at(-1)?.[0]).toBeCloseTo(1.63);
    expect(h.controller.getDebugState().activePattern).toBeNull();
    h.context.currentTime = 2; h.controller.setVolume(1);
    await vi.waitFor(() => expect(h.sources).toHaveLength(2));
    expect(h.sources[1].start).toHaveBeenCalledWith(2.02, 0);
  });

  it('invalidates in-flight rendering on mute without allowing an old target to start', async () => {
    const h = harness(); let resolve!: (b: AudioBuffer) => void;
    render.mockImplementationOnce(() => new Promise<AudioBuffer>(r => { resolve = r; }));
    const pending = h.controller.playArrangement(music('pattern'), { mode: 'world-play', transition: 'room' });
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function')); h.controller.setVolume(0);
    const latest = music('pattern'); if (latest.kind !== 'pattern') throw new Error('pattern'); latest.bpm = 60;
    await h.controller.playArrangement(latest, { mode: 'world-play', transition: 'room' });
    resolve(buffer()); await pending; expect(h.sources).toHaveLength(0);
    h.controller.setVolume(1); await vi.waitFor(() => expect(h.sources).toHaveLength(1));
    expect(render.mock.calls.at(-1)?.[1].bpm).toBe(60);
  });

  it('does no muted clip or note preview loading', async () => {
    const h = harness(); h.controller.setVolume(0);
    const p = createDefaultRoomPatternMusic();
    await h.controller.previewClip('wamp-v1', 'drums-1');
    h.controller.previewPatternCell(p, 'triangle', 4); h.controller.previewPatternCell(p, 'drums', 0);
    expect(fetch).not.toHaveBeenCalled(); expect(getPatternDrumSamples).not.toHaveBeenCalled();
    expect(h.contextConstructor).not.toHaveBeenCalled(); expect(h.sources).toHaveLength(0);
  });

  it('a pending clip cannot revive after mute then unmute', async () => {
    const h = harness(); let finish!: (value: ArrayBuffer) => void;
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, arrayBuffer: () => new Promise<ArrayBuffer>(r => { finish = r; }) } as Response);
    const pending = h.controller.previewClip('wamp-v1', 'drums-1');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    h.controller.setVolume(0); h.controller.setVolume(1); finish(new ArrayBuffer(1)); await pending;
    expect(h.sources).toHaveLength(0);
  });

  it('a pending drum preview cannot revive after mute then unmute', async () => {
    const h = harness(); let finish!: (value: Map<RoomPatternDrumRowId, Float32Array>) => void;
    vi.mocked(getPatternDrumSamples).mockImplementationOnce(() => new Promise(r => { finish = r; }));
    h.controller.previewPatternCell(createDefaultRoomPatternMusic(), 'drums', 6);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    h.controller.setVolume(0); h.controller.setVolume(1); finish(new Map([['crash', new Float32Array(80)], ['fx-click', new Float32Array(80)]]));
    await Promise.resolve(); await Promise.resolve();
    expect(h.sources).toHaveLength(0); expect(h.context.createBuffer).not.toHaveBeenCalled();
  });
});

describe('lightweight music playhead info', () => {
  it('returns idle fields without creating an audio context', () => {
    const h = harness();
    expect(h.controller.getPlayheadInfo()).toEqual({ audioCurrentTime: null, transportStartTime: 0, patternStartTime: null, loopDurationSec: null, kind: null });
    expect(h.contextConstructor).not.toHaveBeenCalled();
  });

  it('reads exact timing without traversing the song or calling the diagnostic snapshot', async () => {
    const h = harness(); await h.controller.playArrangement(music('pattern'), { mode: 'editor-preview', transition: 'immediate' });
    h.context.currentTime = 1.234567;
    const owner = h.controller as unknown as { currentArrangement: RoomMusic };
    Object.defineProperty(owner.currentArrangement, 'tabs', { get() { throw new Error('deep song access'); } });
    vi.spyOn(h.controller, 'getDebugState').mockImplementation(() => { throw new Error('diagnostic snapshot'); });
    expect(h.controller.getPlayheadInfo()).toEqual({ audioCurrentTime: 1.234567, transportStartTime: 1.02, patternStartTime: 1.02, loopDurationSec: 4, kind: 'pattern' });
  });

  it('clears owned playback timing after Stop', async () => {
    const h = harness(); await h.controller.playArrangement(music('pattern'), { mode: 'editor-preview' });
    h.controller.stopArrangement({ mode: 'idle', transition: 'immediate', resetTransport: true });
    expect(h.controller.getPlayheadInfo()).toEqual({ audioCurrentTime: 1, transportStartTime: 0, patternStartTime: null, loopDurationSec: null, kind: null });
  });
});

describe('music visibility lifecycle', () => {
  it('suspends and resumes the same owned loop without scheduling another source', async () => {
    const h = harness(); h.controller.init(); h.windowEvents.get('keydown')?.();
    await h.controller.playArrangement(music('pattern'), { mode: 'world-play', transition: 'room' });
    const before = h.controller.getPlayheadInfo(); h.visibility(true);
    expect(h.context.suspend).toHaveBeenCalledOnce(); expect(h.context.state).toBe('suspended');
    expect(h.controller.getPlayheadInfo()).toEqual(before);
    h.visibility(false); await Promise.resolve();
    expect(h.context.resume).toHaveBeenCalledOnce(); expect(h.context.state).toBe('running');
    expect(h.sources).toHaveLength(1); expect(h.sources[0].stop).not.toHaveBeenCalled();
  });

  it('cannot resume from focus or gesture events while hidden', async () => {
    const h = harness(); await h.controller.playArrangement(music('pattern'), { mode: 'world-play' });
    h.visibility(true); h.windowEvents.get('focus')?.(); h.windowEvents.get('keydown')?.();
    expect(h.context.resume).not.toHaveBeenCalled(); expect(h.context.state).toBe('suspended');
  });

  it('does not create a context for hidden/visible lifecycle events alone', () => {
    const h = harness(); h.controller.init(); h.windowEvents.get('keydown')?.(); h.visibility(true); h.visibility(false);
    expect(h.contextConstructor).not.toHaveBeenCalled();
  });

  it('re-suspends when a pending resume finishes after the page becomes hidden', async () => {
    const h = harness(); h.context.state = 'suspended'; let finish!: () => void;
    h.context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { h.context.state = 'running'; resolve(); }; }));
    await h.controller.playArrangement(music('pattern'), { mode: 'world-play' });
    expect(finish).toBeTypeOf('function'); h.visibility(true); finish();
    await vi.waitFor(() => expect(h.context.state).toBe('suspended'));
    expect(h.context.suspend).toHaveBeenCalledOnce();
  });
});
