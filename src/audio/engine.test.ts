import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIO_SESSION_TYPE, AudioEngine } from './engine';
import { SfxController } from './sfx';
import { RoomMusicController } from '../music/controller';

function harness(options: { audioSession?: { type: string } } = {}) {
  const windowEvents = new Map<string, Array<() => void>>(); const docEvents = new Map<string, Array<() => void>>();
  const on = (map: Map<string, Array<() => void>>) => (name: string, fn: () => void) => map.set(name, [...(map.get(name) ?? []), fn]);
  const emit = (map: Map<string, Array<() => void>>, name: string) => { for (const fn of map.get(name) ?? []) fn(); };
  const doc = { hidden: false, addEventListener: on(docEvents), createElement: () => ({ canPlayType: () => 'probably' }) };
  const node = (kind: string) => ({
    kind, connect: vi.fn(), disconnect: vi.fn(), frequency: { value: 0 }, Q: { value: 0 }, type: '', context: null as unknown,
    gain: { value: 1, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
    playbackRate: { value: 1 }, start: vi.fn(), stop: vi.fn(),
  });
  let stateChange: (() => void) | null = null;
  const context = {
    state: 'running', currentTime: 0, destination: { kind: 'destination' },
    addEventListener: vi.fn((name: string, fn: () => void) => { if (name === 'statechange') stateChange = fn; }),
    createGain: vi.fn(() => Object.assign(node('gain'), { context })), createBiquadFilter: vi.fn(() => node('filter')),
    createBufferSource: vi.fn(() => node('source')), decodeAudioData: vi.fn(async () => ({ duration: 0.2 })),
    resume: vi.fn(async (): Promise<void> => { context.state = 'running'; }), suspend: vi.fn(async (): Promise<void> => { context.state = 'suspended'; }),
  };
  const AudioContext = vi.fn(function () { return context; });
  const navigator = options.audioSession ? { audioSession: options.audioSession } : {};
  const timers: { id: number; fn: () => void; delay: number }[] = []; let nextTimer = 1;
  vi.stubGlobal('window', {
    document: doc, navigator, location: { href: 'http://localhost/', origin: 'http://localhost' }, AudioContext, addEventListener: on(windowEvents),
    setTimeout: vi.fn((fn: () => void, delay = 0) => { timers.push({ id: nextTimer, fn, delay }); return nextTimer++; }),
    clearTimeout: vi.fn((id: number) => { const index = timers.findIndex((timer) => timer.id === id); if (index >= 0) timers.splice(index, 1); }),
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  const engine = new AudioEngine();
  return {
    engine, context, AudioContext, windowEvents, docEvents, timers,
    /** Runs the timers due within `ms`, as if that much time passed. */
    runTimers(ms: number) { for (const timer of timers.splice(0)) { if (timer.delay <= ms) timer.fn(); else timers.push(timer); } },
    gesture(name = 'keydown') { emit(windowEvents, name); },
    visibility(hidden: boolean) { doc.hidden = hidden; emit(docEvents, 'visibilitychange'); },
    /** The context changes state on its own, as Safari does for a call or Siri. */
    osState(state: string) { context.state = state; stateChange?.(); },
  };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('shared audio engine', () => {
  it('gives music and effects one context, one set of lifecycle listeners and separate buses into one master', async () => {
    const h = harness();
    const music = new RoomMusicController(h.engine), sfx = new SfxController(h.engine);
    music.init(); sfx.init();
    expect(h.windowEvents.get('keydown')).toHaveLength(1); expect(h.docEvents.get('visibilitychange')).toHaveLength(1);
    h.gesture();
    sfx.play('goal-success', { ignoreCooldown: true, lowPassFrequencyHz: 1000 });
    await vi.waitFor(() => expect(h.context.createBufferSource).toHaveBeenCalledOnce());
    expect(h.AudioContext).toHaveBeenCalledOnce();
    expect(music.getDebugState().audioContextState).toBe('running');
    const [master, musicBus, sfxBus] = h.context.createGain.mock.results.map((r) => r.value);
    expect(master.connect).toHaveBeenCalledWith(h.context.destination);
    expect(musicBus.connect).toHaveBeenCalledWith(master); expect(sfxBus.connect).toHaveBeenCalledWith(master);
    expect(h.engine.getMusicBus()).toBe(musicBus); expect(h.engine.getSfxBus()).toBe(sfxBus);
    // source -> low-pass -> voice gain -> effects volume -> effects bus
    const filter = h.context.createBiquadFilter.mock.results[0].value;
    const voiceGain = filter.connect.mock.calls[0][0];
    const effectsVolume = voiceGain.connect.mock.calls[0][0];
    expect(effectsVolume.connect).toHaveBeenCalledWith(sfxBus); expect(filter.connect).not.toHaveBeenCalledWith(h.context.destination);
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
    const auto = { type: 'auto' }; const withAuto = harness({ audioSession: auto }); withAuto.engine.init();
    expect(auto.type).toBe(AUDIO_SESSION_TYPE); expect(AUDIO_SESSION_TYPE).toBe('ambient');
    expect(withAuto.engine.getDebugState().audioSessionType).toBe('ambient');
    const chosen = { type: 'playback' }; harness({ audioSession: chosen }).engine.init();
    expect(chosen.type).toBe('playback');
    const none = harness(); expect(() => none.engine.init()).not.toThrow();
    expect(none.engine.getDebugState().audioSessionType).toBeNull();
  });

  it('unlocks on the lifting half of a tap, which iPhone Safari counts as the gesture (F229)', async () => {
    for (const name of ['touchend', 'pointerup', 'click']) {
      const h = harness(); h.engine.init(); h.engine.getContext(); h.context.state = 'suspended';
      h.gesture(name); await Promise.resolve();
      expect(h.engine.userInteracted).toBe(true); expect(h.context.resume).toHaveBeenCalledOnce();
    }
  });

  it('tries again after returning to the page when the first resume does not take (F229)', async () => {
    const h = harness(); h.engine.init(); h.engine.getContext(); h.gesture(); await Promise.resolve();
    h.visibility(true); await Promise.resolve();
    // Safari is still ending its own interruption: the first resume is refused.
    h.context.resume.mockImplementationOnce(async () => { throw Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }); });
    h.visibility(false); await Promise.resolve(); await Promise.resolve();
    expect(h.context.state).toBe('suspended');
    h.runTimers(300); await Promise.resolve();
    expect(h.context.state).toBe('running');
    expect(h.engine.getDebugState().lastResumeAttempt).toMatchObject({ trigger: 'return-retry-1', status: 'resumed' });
    h.context.resume.mockClear(); h.runTimers(3_000); await Promise.resolve();
    expect(h.context.resume).not.toHaveBeenCalled(); // already running: later retries do nothing
    const events = h.engine.getDebugState().lifecycleLog.map((entry) => entry.event);
    expect(events).toEqual(expect.arrayContaining(['page-hidden', 'page-visible', 'resume visibilitychange-visible: failed (NotAllowedError)', 'resume return-retry-1: resumed']));
  });

  it('cancels return retries when the page hides again', async () => {
    const h = harness(); h.engine.init(); h.engine.getContext(); h.gesture(); await Promise.resolve();
    h.visibility(true); await Promise.resolve();
    h.context.resume.mockImplementation(async () => {});
    h.visibility(false); h.visibility(true); await Promise.resolve();
    expect(h.timers).toHaveLength(0);
    const resumes = h.context.resume.mock.calls.length;
    h.runTimers(3_000); expect(h.context.resume.mock.calls.length).toBe(resumes);
  });
});
