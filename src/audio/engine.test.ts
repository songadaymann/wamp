import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_SESSION_TYPE, AudioEngine } from './engine';
import { SfxController } from './sfx';
import { RoomMusicController } from '../music/controller';

function harness(options: { audioSession?: { type: string } } = {}) {
  const windowEvents = new Map<string, Array<() => void>>(); const docEvents = new Map<string, Array<() => void>>();
  const on = (map: Map<string, Array<() => void>>) => (name: string, fn: () => void) => map.set(name, [...(map.get(name) ?? []), fn]);
  const emit = (map: Map<string, Array<() => void>>, name: string) => { for (const fn of map.get(name) ?? []) fn(); };
  const doc = { hidden: false, addEventListener: on(docEvents), createElement: () => ({ canPlayType: () => 'probably' }) };
  class FakeAudio {
    src: string; volume = 1; playbackRate = 1; currentTime = 0; loop = false; preload = ''; paused = true;
    addEventListener = vi.fn(); removeEventListener = vi.fn(); load = vi.fn(); pause = vi.fn(() => { this.paused = true; });
    play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
    constructor(src: string) { this.src = src; }
  }
  const node = (kind: string) => ({ kind, connect: vi.fn(), disconnect: vi.fn(), frequency: { value: 0 }, Q: { value: 0 }, type: '', gain: { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() } });
  let stateChange: (() => void) | null = null;
  const context = {
    state: 'running', currentTime: 0, destination: { kind: 'destination' },
    addEventListener: vi.fn((name: string, fn: () => void) => { if (name === 'statechange') stateChange = fn; }),
    createGain: vi.fn(() => node('gain')), createMediaElementSource: vi.fn(() => node('media')), createBiquadFilter: vi.fn(() => node('filter')),
    resume: vi.fn(async (): Promise<void> => { context.state = 'running'; }), suspend: vi.fn(async (): Promise<void> => { context.state = 'suspended'; }),
  };
  const AudioContext = vi.fn(function () { return context; });
  const navigator = options.audioSession ? { audioSession: options.audioSession } : {};
  vi.stubGlobal('window', { document: doc, navigator, location: { href: 'http://localhost/', origin: 'http://localhost' }, AudioContext, addEventListener: on(windowEvents), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() });
  vi.stubGlobal('document', doc); vi.stubGlobal('Audio', FakeAudio);
  const engine = new AudioEngine();
  return {
    engine, context, AudioContext, windowEvents, docEvents,
    gesture() { emit(windowEvents, 'keydown'); },
    visibility(hidden: boolean) { doc.hidden = hidden; emit(docEvents, 'visibilitychange'); },
    /** The context changes state on its own, as Safari does for a call or Siri. */
    osState(state: string) { context.state = state; stateChange?.(); },
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('shared audio engine', () => {
  it('gives music and effects one context, one set of lifecycle listeners and separate buses into one master', () => {
    const h = harness();
    const music = new RoomMusicController(h.engine), sfx = new SfxController(h.engine);
    music.init(); sfx.init();
    expect(h.windowEvents.get('keydown')).toHaveLength(1); expect(h.docEvents.get('visibilitychange')).toHaveLength(1);
    h.gesture();
    sfx.play('goal-success', { ignoreCooldown: true, lowPassFrequencyHz: 1000 });
    expect(h.AudioContext).toHaveBeenCalledOnce();
    expect(music.getDebugState().audioContextState).toBe('running');
    const [master, musicBus, sfxBus] = h.context.createGain.mock.results.map((r) => r.value);
    expect(master.connect).toHaveBeenCalledWith(h.context.destination);
    expect(musicBus.connect).toHaveBeenCalledWith(master); expect(sfxBus.connect).toHaveBeenCalledWith(master);
    expect(h.engine.getMusicBus()).toBe(musicBus); expect(h.engine.getSfxBus()).toBe(sfxBus);
    const filter = h.context.createBiquadFilter.mock.results[0].value;
    expect(filter.connect).toHaveBeenCalledWith(sfxBus); expect(filter.connect).not.toHaveBeenCalledWith(h.context.destination);
  });

  it('runs hidden listeners before suspending, and resumes on return only after a gesture unlocked audio', async () => {
    const h = harness(); h.engine.init(); h.engine.getContext();
    const order: string[] = [];
    h.engine.onHidden(() => order.push(`hidden:${h.context.state}`));
    h.context.suspend.mockImplementation(async () => { order.push('suspend'); h.context.state = 'suspended'; });
    h.visibility(true); h.visibility(false); await Promise.resolve();
    expect(order).toEqual(['hidden:running', 'suspend']);
    expect(h.context.resume).not.toHaveBeenCalled();
    h.gesture(); await Promise.resolve();
    expect(h.context.resume).toHaveBeenCalledOnce(); expect(h.context.state).toBe('running');
  });

  it('resumes after an interruption ends while visible, but not while hidden or before any gesture', async () => {
    const h = harness(); h.engine.init(); h.engine.getContext();
    h.osState('interrupted');
    expect(h.context.resume).not.toHaveBeenCalled(); // never unlocked by the player
    h.gesture(); await Promise.resolve(); h.context.resume.mockClear();
    h.osState('interrupted'); await Promise.resolve();
    expect(h.context.resume).toHaveBeenCalledOnce(); expect(h.context.state).toBe('running');
    expect(h.engine.getDebugState().lastResumeAttempt).toMatchObject({ trigger: 'statechange-interrupted', status: 'resumed' });
    h.visibility(true); h.context.resume.mockClear();
    h.osState('suspended');
    expect(h.context.resume).not.toHaveBeenCalled();
  });

  it('stops retrying an interruption after three resumes in ten seconds until the window passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(0);
    const h = harness(); h.engine.init(); h.engine.getContext(); h.gesture(); await Promise.resolve();
    h.context.resume.mockClear();
    // Resume "succeeds" but the OS keeps the context suspended.
    h.context.resume.mockImplementation(async () => {});
    for (let i = 0; i < 5; i += 1) { h.osState('suspended'); await Promise.resolve(); }
    expect(h.context.resume).toHaveBeenCalledTimes(3);
    vi.setSystemTime(10_001); h.osState('suspended'); await Promise.resolve();
    expect(h.context.resume).toHaveBeenCalledTimes(4);
  });

  it('sets the iPhone audio session once, and leaves a page-chosen session alone', () => {
    const auto = { type: 'auto' }; harness({ audioSession: auto }).engine.init();
    expect(auto.type).toBe(AUDIO_SESSION_TYPE); expect(AUDIO_SESSION_TYPE).toBe('ambient');
    const chosen = { type: 'playback' }; harness({ audioSession: chosen }).engine.init();
    expect(chosen.type).toBe('playback');
    expect(() => harness().engine.init()).not.toThrow();
  });
});
