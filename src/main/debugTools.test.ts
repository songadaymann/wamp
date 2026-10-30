import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobilePerformanceProfiler } from '../debug/mobilePerformanceProfiler';
import {
  installResourceDebugTools,
  isResourceDebugRequested,
  LazyDebugModule,
  preloadMobilePerformanceProfiler,
  requestMobilePerformanceProfiler,
} from './debugTools';

type ResourceDebugModule = typeof import('./resourceDebug');
type ProfilerModule = typeof import('../debug/mobilePerformanceProfiler');

const game = { id: 'game' } as unknown as Phaser.Game;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function resourceDebugFixture() {
  const state = { textures: { total: 3 }, loop: { actualFps: 60 } };
  const module = {
    getRuntimeResourceDebugState: vi.fn(() => ({ ...state })),
    installRuntimeResourceDebugLogger: vi.fn(() => null),
  };
  const load = vi.fn(async () => module as unknown as ResourceDebugModule);
  return { state, module, load, tool: new LazyDebugModule(load) };
}

function profilerFixture() {
  const profiler = { destroy: vi.fn() } as unknown as MobilePerformanceProfiler;
  const module = { createMobilePerformanceProfiler: vi.fn(() => profiler) };
  let finish!: () => void;
  const arrived = new Promise<void>(resolve => { finish = resolve; });
  const load = vi.fn(async () => { await arrived; return module as unknown as ProfilerModule; });
  return { profiler, module, load, finish, tool: new LazyDebugModule(load) };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('resource debug tools', () => {
  it('keeps window.get_wamp_resource_debug as a stub that downloads the logger once and returns its data', async () => {
    const { state, module, load, tool } = resourceDebugFixture();
    const target: Pick<Window, 'get_wamp_resource_debug'> = {};
    installResourceDebugTools(game, new URLSearchParams(''), () => ({ fps: 60 }), { target, tool, readSavedSwitch: () => null });
    expect(load).not.toHaveBeenCalled();

    await expect(target.get_wamp_resource_debug?.()).resolves.toEqual({ ...state, frameCadence: { fps: 60 } });
    await expect(target.get_wamp_resource_debug?.()).resolves.toEqual({ ...state, frameCadence: { fps: 60 } });
    expect(module.getRuntimeResourceDebugState).toHaveBeenCalledWith(game);
    expect(load).toHaveBeenCalledOnce();
    expect(module.installRuntimeResourceDebugLogger).not.toHaveBeenCalled();
  });

  it('downloads and starts the logger only when ?resourceDebug or a saved switch asks for it', async () => {
    const off = resourceDebugFixture();
    installResourceDebugTools(game, new URLSearchParams('?perf=1'), () => null, { target: {}, tool: off.tool, readSavedSwitch: () => null });
    await flush();
    expect(off.load).not.toHaveBeenCalled();

    const on = resourceDebugFixture();
    const query = new URLSearchParams('?resourceDebug=1');
    installResourceDebugTools(game, query, () => null, { target: {}, tool: on.tool, readSavedSwitch: () => null });
    await flush();
    expect(on.load).toHaveBeenCalledOnce();
    expect(on.module.installRuntimeResourceDebugLogger).toHaveBeenCalledWith(game, query);
  });

  it('treats ?resourceDebug=0 and a saved switch as requests, and blocked storage as off', () => {
    expect(isResourceDebugRequested(new URLSearchParams('?resourceDebug=0'), () => null)).toBe(true);
    expect(isResourceDebugRequested(new URLSearchParams(''), () => '1')).toBe(true);
    expect(isResourceDebugRequested(new URLSearchParams(''), () => null)).toBe(false);
    expect(isResourceDebugRequested(new URLSearchParams(''), () => { throw new Error('SecurityError'); })).toBe(false);
  });

  it('warns instead of breaking startup when the logger download fails, and retries on the next call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { module } = resourceDebugFixture();
    const load = vi.fn<() => Promise<ResourceDebugModule>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(module as unknown as ResourceDebugModule);
    const target: Pick<Window, 'get_wamp_resource_debug'> = {};
    installResourceDebugTools(game, new URLSearchParams('?resourceDebug=1'), () => null, { target, tool: new LazyDebugModule(load) });
    await flush();
    expect(warn).toHaveBeenCalledOnce();
    await expect(target.get_wamp_resource_debug?.()).resolves.toMatchObject({ textures: { total: 3 } });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('phone profiler', () => {
  it('downloads only when ?mobilePerf or ?perf is on', async () => {
    const { load, tool } = profilerFixture();
    const onReady = vi.fn();
    preloadMobilePerformanceProfiler({ search: '?resourceDebug=1', tool });
    requestMobilePerformanceProfiler({}, onReady, { search: '?perf=0', tool })();
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();

    preloadMobilePerformanceProfiler({ search: '?mobilePerf=1', tool });
    preloadMobilePerformanceProfiler({ search: '?perf', tool });
    expect(load).toHaveBeenCalledOnce();
  });

  it('gives the scene its profiler synchronously once boot has downloaded it', async () => {
    const { profiler, module, finish, tool } = profilerFixture();
    preloadMobilePerformanceProfiler({ search: '?perf=1', tool });
    finish();
    await flush();
    const onReady = vi.fn();
    const getContext = () => ({ mode: 'play' });
    requestMobilePerformanceProfiler({ getContext }, onReady, { search: '?perf=1', tool });
    expect(onReady).toHaveBeenCalledExactlyOnceWith(profiler);
    expect(module.createMobilePerformanceProfiler).toHaveBeenCalledWith({ getContext });
  });

  it('creates a profiler requested before the download arrives, unless the scene cancelled it', async () => {
    const { profiler, module, finish, tool } = profilerFixture();
    const kept = vi.fn(), cancelled = vi.fn();
    requestMobilePerformanceProfiler({}, kept, { search: '?mobilePerf=1', tool });
    const cancel = requestMobilePerformanceProfiler({}, cancelled, { search: '?mobilePerf=1', tool });
    cancel();
    expect(kept).not.toHaveBeenCalled();
    finish();
    await flush();
    expect(kept).toHaveBeenCalledExactlyOnceWith(profiler);
    expect(cancelled).not.toHaveBeenCalled();
    expect(module.createMobilePerformanceProfiler).toHaveBeenCalledOnce();
  });
});
