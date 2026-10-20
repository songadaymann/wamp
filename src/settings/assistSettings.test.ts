import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it('defaults off, normalizes stored input, persists independently and unsubscribes', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  let m = await import('./assistSettings');
  expect(m.isAssistRequested()).toBe(false);
  const listener = vi.fn(), off = m.subscribeAssistSettings(listener);
  m.updateAssistSettings({ speed: 0.6, safeRespawn: true }); m.updateAssistSettings({ speed: 0.6 });
  expect(listener).toHaveBeenCalledOnce(); off();
  vi.resetModules(); m = await import('./assistSettings');
  expect(m.getAssistSettings()).toEqual({ speed: 0.6, safeRespawn: true });
  m.updateAssistSettings({ speed: 1, safeRespawn: false }); expect(m.isAssistRequested()).toBe(false);
  expect([...storage.keys()]).toEqual(['wamp.settings.assist']);
  expect(m.normalizeAssistSettings({ speed: -1 as never, safeRespawn: 'true' as never })).toEqual({ speed: 1, safeRespawn: false });
});
it('handles corrupt and blocked storage while preserving session settings', async () => {
  vi.stubGlobal('window', { localStorage: { getItem: () => '{broken', setItem: () => { throw new Error('blocked'); } } });
  const m = await import('./assistSettings'); expect(m.getAssistSpeed()).toBe(1);
  m.updateAssistSettings({ safeRespawn: true }); expect(m.isAssistRequested()).toBe(true);
});
