import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from './engine';
import { SfxController } from './sfx';

function harness() {
  const events = new Map<string, () => void>(); const docEvents = new Map<string, () => void>();
  const doc = { hidden: false, addEventListener: (name: string, fn: () => void) => docEvents.set(name, fn), createElement: () => ({ canPlayType: () => 'probably' }) };
  const players: FakeAudio[] = []; let playPromise: Promise<void> | undefined;
  class FakeAudio {
    src: string; volume = 1; playbackRate = 1; currentTime = 0; loop = false; preload = ''; paused = true;
    addEventListener = vi.fn(); removeEventListener = vi.fn(); load = vi.fn();
    pause = vi.fn(() => { this.paused = true; });
    play = vi.fn(() => { this.paused = false; return playPromise; });
    constructor(src: string) { this.src = src; players.push(this); }
  }
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), frequency: { value: 0 }, Q: { value: 0 }, type: '', gain: { value: 1 } });
  const context = { state: 'running', destination: {}, addEventListener: vi.fn(), createMediaElementSource: vi.fn(node), createBiquadFilter: vi.fn(node), createGain: vi.fn(node), resume: vi.fn(async (): Promise<void> => {}), suspend: vi.fn(async (): Promise<void> => {}) };
  context.resume.mockImplementation(async () => { context.state = 'running'; }); context.suspend.mockImplementation(async () => { context.state = 'suspended'; });
  const constructor = vi.fn(function () { return context; });
  vi.stubGlobal('window', { document: doc, location: { href: 'http://localhost/' }, AudioContext: constructor, addEventListener: (name: string, fn: () => void) => events.set(name, fn), setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(), setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
  vi.stubGlobal('document', doc); vi.stubGlobal('Audio', FakeAudio);
  const engine = new AudioEngine();
  const controller = new SfxController(engine); controller.init(); events.get('keydown')?.();
  return { controller, engine, doc, players, context, constructor, events,
    visibility(hidden: boolean) { doc.hidden = hidden; docEvents.get('visibilitychange')?.(); },
    pending(promise: Promise<void>) { playPromise = promise; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('SFX hidden-tab lifecycle', () => {
  it('stops direct and routed media, releases ownership and suspends the route context', async () => {
    const h = harness(); h.controller.play('ladder-climb', { ignoreCooldown: true }); h.controller.play('goal-success', { ignoreCooldown: true, lowPassFrequencyHz: 1000 });
    expect(h.controller.getDebugState().activeCount).toBe(2); h.visibility(true);
    expect(h.players.every(p => p.paused)).toBe(true); expect(h.controller.getDebugState().activeCount).toBe(0);
    expect(h.context.suspend).toHaveBeenCalledOnce(); expect(h.context.state).toBe('suspended');
    h.visibility(false); await Promise.resolve(); expect(h.context.resume).toHaveBeenCalledOnce();
    expect(h.players.every(p => p.play.mock.calls.length === 1)).toBe(true); // no stale effect replay
  });

  it('blocks hidden cues and hidden focus without allocating media or a route context', () => {
    const h = harness(); h.visibility(true); h.controller.play('goal-success', { ignoreCooldown: true, lowPassFrequencyHz: 1000 }); h.events.get('focus')?.();
    expect(h.players).toHaveLength(0); expect(h.constructor).not.toHaveBeenCalled(); expect(h.context.resume).not.toHaveBeenCalled();
    expect((h.controller.getDebugState().history as { status: string }[]).at(-1)?.status).toBe('blocked');
  });

  it('a late rejected media play cannot stop the same pooled element after reuse', async () => {
    const h = harness(); let reject!: (reason: Error) => void;
    h.pending(new Promise<void>((_, r) => { reject = r; })); h.controller.play('ladder-climb', { ignoreCooldown: true });
    h.visibility(true); h.visibility(false); h.pending(Promise.resolve()); h.controller.play('ladder-climb', { ignoreCooldown: true });
    const pauses = h.players[0].pause.mock.calls.length; reject(new Error('aborted old play')); await Promise.resolve(); await Promise.resolve();
    expect(h.players).toHaveLength(1); expect(h.players[0].pause.mock.calls.length).toBe(pauses); expect(h.controller.getDebugState().activeCount).toBe(1);
  });

  it('re-suspends when a pending route resume resolves while hidden', async () => {
    const h = harness(); h.context.state = 'suspended'; let finish!: () => void;
    h.context.resume.mockImplementationOnce(() => new Promise<void>(r => { finish = () => { h.context.state = 'running'; r(); }; }));
    h.controller.play('goal-success', { ignoreCooldown: true, lowPassFrequencyHz: 1000 }); h.visibility(true); finish();
    await vi.waitFor(() => expect(h.context.state).toBe('suspended')); expect(h.controller.getDebugState().activeCount).toBe(0);
  });
});
