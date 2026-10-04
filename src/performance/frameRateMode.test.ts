import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('device-local frame-rate preference', () => {
  it('restores the explicit override across reloads and notifies runtime changes', async () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value) } });
    const first = await import('./frameRateMode');
    const changed = vi.fn(); const unsubscribe = first.subscribeFrameRateMode(changed);
    expect(first.getFrameRateMode()).toBe('auto');
    first.setFrameRateMode('60'); first.setFrameRateMode('60');
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe(); first.setFrameRateMode('uncapped');
    expect(changed).toHaveBeenCalledTimes(1);
    vi.resetModules();
    expect((await import('./frameRateMode')).getFrameRateMode()).toBe('uncapped');
  });
  it('keeps a session override when storage is blocked', async () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('Storage blocked'); } });
    const store = await import('./frameRateMode');
    expect(store.getFrameRateMode()).toBe('auto');
    expect(store.setFrameRateMode('60')).toBe('60');
  });
  it('rejects corrupted stored preferences and unknown incoming values', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'invalid', setItem: vi.fn() } });
    const store = await import('./frameRateMode');
    expect(store.getFrameRateMode()).toBe('auto');
    expect(store.setFrameRateMode({ mode: '60' })).toBe('auto');
  });
});
