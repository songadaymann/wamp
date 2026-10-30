import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine';
import { SfxController } from './sfx';

type Listener = () => void;
type FakeSource = ReturnType<typeof makeSource>;
type FakeGain = ReturnType<typeof makeGain>;

function makeGain() {
  return {
    kind: 'gain', connect: vi.fn(), disconnect: vi.fn(),
    gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
    context: null as unknown,
  };
}
function makeSource() {
  return {
    kind: 'source', buffer: null as unknown, loop: false, playbackRate: { value: 1 }, onended: null as null | (() => void),
    connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
  };
}

function harness(options: { interacted?: boolean } = {}) {
  const windowEvents = new Map<string, Listener[]>(); const docEvents = new Map<string, Listener[]>();
  const on = (map: Map<string, Listener[]>) => (name: string, fn: Listener) => map.set(name, [...(map.get(name) ?? []), fn]);
  const emit = (map: Map<string, Listener[]>, name: string) => { for (const fn of map.get(name) ?? []) fn(); };
  const doc = { hidden: false, addEventListener: on(docEvents), createElement: () => ({ canPlayType: () => 'probably' }) };
  const timers: { fn: Listener; delay: number }[] = [];
  let now = 0;
  let stateChange: Listener | null = null;
  const sources: FakeSource[] = []; const gains: FakeGain[] = [];
  const context = {
    state: 'running', currentTime: 2, destination: { kind: 'destination' },
    addEventListener: vi.fn((name: string, fn: Listener) => { if (name === 'statechange') stateChange = fn; }),
    createGain: vi.fn(() => { const gain = makeGain(); gain.context = context; gains.push(gain); return gain; }),
    createBiquadFilter: vi.fn(() => ({ kind: 'filter', type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() })),
    createBufferSource: vi.fn(() => { const source = makeSource(); sources.push(source); return source; }),
    decodeAudioData: vi.fn(async (data: ArrayBuffer & { url?: string }) => ({ duration: 0.2, url: data.url })),
    resume: vi.fn(async (): Promise<void> => { context.state = 'running'; }),
    suspend: vi.fn(async (): Promise<void> => { context.state = 'suspended'; }),
  };
  const AudioContext = vi.fn(function () { return context; });
  // Each fetch resolves when the test says so (or at once, by default).
  const loads: { url: string; finish: (ok?: boolean) => void }[] = [];
  let autoLoad = true;
  const fetchMock = vi.fn((url: string) => new Promise((resolve) => {
    const finish = (ok = true) => resolve({ ok, status: ok ? 200 : 404, arrayBuffer: async () => Object.assign(new ArrayBuffer(8), { url }) });
    loads.push({ url, finish });
    if (autoLoad) finish();
  }));
  class NoMediaElements { constructor() { throw new Error('effects must not use <audio> elements'); } }
  vi.stubGlobal('window', {
    document: doc, navigator: {}, location: { href: 'http://localhost/' }, AudioContext,
    addEventListener: on(windowEvents),
    setTimeout: vi.fn((fn: Listener, delay = 0) => { timers.push({ fn, delay }); return timers.length; }), clearTimeout: vi.fn(),
  });
  vi.stubGlobal('document', doc); vi.stubGlobal('Audio', NoMediaElements); vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('performance', { now: () => now });
  const engine = new AudioEngine();
  const controller = new SfxController(engine); controller.init();
  const h = {
    controller, engine, context, AudioContext, sources, gains, loads, fetchMock, timers, windowEvents,
    gesture() { emit(windowEvents, 'pointerdown'); },
    pageEvent(name: string) { emit(windowEvents, name); },
    visibility(hidden: boolean) { doc.hidden = hidden; emit(docEvents, 'visibilitychange'); },
    osState(state: string) { context.state = state; stateChange?.(); },
    manualLoads() { autoLoad = false; },
    advance(ms: number) { now += ms; },
    runTimers(maxDelay: number) { for (const timer of timers.splice(0)) { if (timer.delay <= maxDelay) timer.fn(); else timers.push(timer); } },
    history() { return controller.getDebugState().history as { cue: string; status: string }[]; },
    async settle() { for (let i = 0; i < 40; i += 1) await Promise.resolve(); },
  };
  if (options.interacted !== false) h.gesture();
  return h;
}
afterEach(() => vi.unstubAllGlobals());

describe('SFX on Web Audio buffers (F023, F229)', () => {
  it('aborts unfinished sound loads on navigation without trying other formats, and resumes after a cached-page return', async () => {
    const h = harness();
    let signal: AbortSignal | undefined;
    h.fetchMock.mockImplementationOnce((_url: string, options?: RequestInit) => new Promise((_resolve, reject) => {
      signal = options?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(new DOMException('Navigation', 'AbortError')), { once: true });
    }));
    h.controller.play('jump', { ignoreCooldown: true });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    h.pageEvent('pagehide');
    expect(signal?.aborted).toBe(true);
    h.runTimers(10_000); await h.settle();
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.context.decodeAudioData).not.toHaveBeenCalled();
    h.pageEvent('pageshow'); await h.settle();
    expect(h.fetchMock.mock.calls.length).toBeGreaterThan(1);
    h.controller.play('jump', { ignoreCooldown: true }); await h.settle();
    expect(h.sources.some(source => source.start.mock.calls.length > 0)).toBe(true);
  });
  it('resumes sound loading on the next gesture when a draft prompt cancels navigation', async () => {
    const h = harness();
    h.pageEvent('beforeunload');
    h.runTimers(10_000); await h.settle();
    expect(h.fetchMock).not.toHaveBeenCalled();
    h.gesture(); await h.settle();
    h.controller.play('jump', { ignoreCooldown: true }); await h.settle();
    expect(h.sources.some(source => source.start.mock.calls.length > 0)).toBe(true);
  });
  it('plays a cue from a decoded buffer through its gain, the effects volume and the engine bus, never an <audio> element', async () => {
    const h = harness();
    h.controller.play('jump', { ignoreCooldown: true }); await h.settle();
    expect(h.fetchMock).toHaveBeenCalledWith('http://localhost/assets/sfx/movement/jump.ogg', { signal: expect.any(AbortSignal) });
    expect(h.sources).toHaveLength(1);
    const [source] = h.sources;
    expect(source.start).toHaveBeenCalledOnce(); expect(source.loop).toBe(false);
    const sfxBus = h.engine.getSfxBus();
    const voiceGain = source.connect.mock.calls[0][0] as FakeGain;
    const output = voiceGain.connect.mock.calls[0][0] as FakeGain;
    expect(output.connect).toHaveBeenCalledWith(sfxBus);
    expect(voiceGain.gain.value).toBeCloseTo(0.48 * 0.55);
    h.controller.setVolume(0.5);
    expect(output.gain.value).toBe(0.5);
    expect(h.history().at(-1)).toEqual(expect.objectContaining({ cue: 'jump', status: 'played' }));
  });

  it('skips cues while the effects volume is at zero, then plays them at the new volume (F078)', async () => {
    const h = harness();
    h.controller.setVolume(0);
    h.controller.play('jump', { ignoreCooldown: true }); h.controller.play('land', { ignoreCooldown: true, volumeMultiplier: 0 }); await h.settle();
    expect(h.sources).toHaveLength(0); expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.history().slice(-2).map((entry) => entry.status)).toEqual(['blocked', 'blocked']);
    h.controller.setVolume(0.4);
    h.controller.play('jump', { ignoreCooldown: true }); await h.settle();
    expect(h.sources).toHaveLength(1);
    const output = (h.sources[0].connect.mock.calls[0][0] as FakeGain).connect.mock.calls[0][0] as FakeGain;
    expect(output.gain.value).toBe(0.4);
  });

  it('a second play of a loaded cue starts at once, with no download or decode', async () => {
    const h = harness();
    h.controller.play('land', { ignoreCooldown: true }); await h.settle();
    h.fetchMock.mockClear(); h.context.decodeAudioData.mockClear();
    h.controller.play('land', { ignoreCooldown: true });
    expect(h.sources).toHaveLength(2); expect(h.sources[1].start).toHaveBeenCalledOnce();
    expect(h.fetchMock).not.toHaveBeenCalled(); expect(h.context.decodeAudioData).not.toHaveBeenCalled();
  });

  it('routes low-pass cues through a filter, and fades and trims cues that ask for it', async () => {
    const h = harness();
    h.controller.play('goal-success', { ignoreCooldown: true, lowPassFrequencyHz: 900, lowPassQ: 2 });
    h.controller.play('bounce', { ignoreCooldown: true }); await h.settle();
    const filter = h.context.createBiquadFilter.mock.results[0].value;
    expect(filter.type).toBe('lowpass'); expect(filter.frequency.value).toBe(900); expect(filter.Q.value).toBe(2);
    const bounce = h.sources[1];
    const bounceGain = bounce.connect.mock.calls[0][0] as FakeGain;
    expect(bounceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 2 + 1 + 0.22);
    expect(bounce.stop).toHaveBeenCalledWith(2 + 1 + 0.22);
  });

  it('plays a feedback cue that finishes loading in time, and drops one that would land late', async () => {
    const h = harness(); h.manualLoads();
    h.controller.play('jump', { ignoreCooldown: true });
    h.advance(80); h.loads[0].finish(); await h.settle();
    expect(h.sources).toHaveLength(1);
    h.controller.play('land', { ignoreCooldown: true });
    h.advance(400); h.loads[1].finish(); await h.settle();
    expect(h.sources).toHaveLength(1);
    expect(h.history().at(-1)).toEqual(expect.objectContaining({ cue: 'land', status: 'late' }));
  });

  it('lets a fanfare arrive a moment late rather than dropping it', async () => {
    const h = harness(); h.manualLoads();
    h.controller.play('goal-success', { ignoreCooldown: true });
    h.advance(700); h.loads[0].finish(); await h.settle();
    expect(h.sources).toHaveLength(1);
  });

  it('falls back through the other formats when one will not decode, and tries the one that worked first next time', async () => {
    const h = harness();
    h.context.decodeAudioData.mockImplementation(async (data: ArrayBuffer & { url?: string }) => {
      if (!data.url?.endsWith('.mp3')) throw new Error('EncodingError');
      return { duration: 0.2, url: data.url };
    });
    h.controller.play('jump', { ignoreCooldown: true }); await h.settle();
    expect(h.fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'http://localhost/assets/sfx/movement/jump.ogg', 'http://localhost/assets/sfx/movement/jump.m4a', 'http://localhost/assets/sfx/movement/jump.mp3',
    ]);
    expect(h.sources).toHaveLength(1);
    h.fetchMock.mockClear();
    h.controller.play('land', { ignoreCooldown: true }); await h.settle();
    expect(h.fetchMock.mock.calls.map((call) => call[0])).toEqual(['http://localhost/assets/sfx/movement/land.mp3']);
    expect(h.sources).toHaveLength(2);
  });

  it('waits for a starting context instead of stacking sounds on a frozen clock', async () => {
    const h = harness();
    h.controller.play('jump', { ignoreCooldown: true }); await h.settle();
    h.context.state = 'suspended'; h.context.resume.mockImplementation(async () => {});
    h.controller.play('jump', { ignoreCooldown: true });
    expect(h.sources).toHaveLength(1); expect(h.context.resume).toHaveBeenCalled();
    h.advance(50); h.osState('running');
    expect(h.sources).toHaveLength(2);
    h.context.state = 'suspended';
    h.controller.play('land', { ignoreCooldown: true }); await h.settle();
    h.advance(500); h.osState('running');
    expect(h.sources.filter((source) => source.start.mock.calls.length > 0)).toHaveLength(2);
  });

  it('a stopped looping cue that is still loading never starts', async () => {
    const h = harness(); h.manualLoads();
    h.controller.play('ladder-climb', { ignoreCooldown: true });
    h.controller.stop('ladder-climb');
    h.loads[0].finish(); await h.settle();
    expect(h.sources).toHaveLength(0);
  });

  it('allows only one voice of a no-overlap cue, counting one that is still loading', async () => {
    const h = harness(); h.manualLoads();
    h.controller.play('ladder-climb', { ignoreCooldown: true });
    h.controller.play('ladder-climb', { ignoreCooldown: true });
    h.loads[0].finish(); await h.settle();
    expect(h.sources).toHaveLength(1); expect(h.sources[0].loop).toBe(true);
    h.controller.stop('ladder-climb');
    expect(h.sources[0].stop).toHaveBeenCalled();
    expect(h.controller.getDebugState().activeCount).toBe(0);
  });
});

describe('SFX page lifecycle', () => {
  it('stops voices and waiting cues when hidden, suspends the context, and does not replay them on return', async () => {
    const h = harness();
    h.controller.play('ladder-climb', { ignoreCooldown: true });
    h.controller.play('goal-success', { ignoreCooldown: true, lowPassFrequencyHz: 1000 }); await h.settle();
    expect(h.controller.getDebugState().activeCount).toBe(2);
    h.visibility(true);
    expect(h.sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(h.controller.getDebugState().activeCount).toBe(0);
    expect(h.context.suspend).toHaveBeenCalledOnce();
    h.visibility(false); await h.settle();
    expect(h.context.resume).toHaveBeenCalled();
    expect(h.sources.every((source) => source.start.mock.calls.length === 1)).toBe(true);
    expect(h.sources).toHaveLength(2);
  });

  it('blocks cues while hidden or before the first gesture without creating a context', () => {
    const hidden = harness({ interacted: false }); hidden.visibility(true);
    hidden.controller.play('goal-success', { ignoreCooldown: true }); hidden.windowEvents.get('focus')?.forEach((fn) => fn());
    expect(hidden.AudioContext).not.toHaveBeenCalled(); expect(hidden.history().at(-1)?.status).toBe('blocked');
    const early = harness({ interacted: false });
    early.controller.play('jump', { ignoreCooldown: true });
    expect(early.AudioContext).not.toHaveBeenCalled(); expect(early.history().at(-1)?.status).toBe('blocked');
  });

  it('loads the hot gameplay cues right after the first gesture, then the other short effects one at a time', async () => {
    const h = harness();
    expect(h.fetchMock).not.toHaveBeenCalled();
    h.runTimers(0); await h.settle();
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
    expect(h.fetchMock.mock.calls.some((call) => String(call[0]).includes('/jump.ogg'))).toBe(true);
    h.controller.play('jump', { ignoreCooldown: true });
    expect(h.sources).toHaveLength(1); // already decoded: starts in the same call
    h.manualLoads(); h.runTimers(2_000); await h.settle();
    expect(h.fetchMock).toHaveBeenCalledTimes(5); // the next file waits for this one
    for (let i = 0; i < 40 && h.loads.length > 4; i += 1) { h.loads.at(-1)?.finish(); await h.settle(); }
    const urls = h.fetchMock.mock.calls.map((call) => String(call[0]));
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.some((url) => url.endsWith('.mp3'))).toBe(false);
    expect(urls.some((url) => url.includes('/footstep.'))).toBe(false);
  });
});
