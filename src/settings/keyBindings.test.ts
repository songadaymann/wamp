import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('device-local physical keyboard preferences', () => {
  it('persists complete maps, rejects conflicts/reserved keys and restores defaults', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) } });
    let m = await import('./keyBindings');
    const defaults = m.getKeyBindings(), listener = vi.fn(), off = m.subscribeKeyBindings(listener);
    expect(defaults.jump).toEqual(['Space', 'KeyZ']); expect(defaults.slash).toEqual(['KeyQ', 'KeyX']);
    expect(m.changeKeyBinding('jump', 'KeyA')).toBe(false);
    for (const code of ['KeyT', 'KeyC', 'Digit0', 'Escape', 'Tab', 'Enter', 'MetaLeft', 'F5', 'Unknown']) expect(m.changeKeyBinding('jump', code)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(m.changeKeyBinding('jump', 'KeyJ')).toBe(true); expect(listener).toHaveBeenCalledOnce(); off();
    const copy = m.getKeyBindings(); copy.left.push('KeyV'); expect(m.getKeyBindings()).not.toEqual(copy);
    vi.resetModules(); m = await import('./keyBindings');
    expect(m.getKeyBindings().jump).toEqual(['KeyJ']);
    expect(m.matchesKeyboardAction('jump', { code: 'KeyJ' })).toBe(true);
    expect(m.matchesKeyboardAction('jump', { code: 'Space' })).toBe(false);
    m.resetKeyBindings(); expect(m.getKeyBindings()).toEqual(defaults);
    expect([...storage.keys()]).toEqual(['wamp.settings.keyboard']);
  });
  it('falls back atomically for corrupt/partial/conflicting persisted maps', async () => {
    const m = await import('./keyBindings'), defaults = m.defaultKeyBindings();
    for (const value of [null, 'bad', {}, { ...defaults, left: ['KeyJ'], right: [] },
      { ...defaults, left: ['KeyJ'], stop: ['KeyJ'] }, { ...defaults, shoot: ['KeyT'] }]) expect(m.normalizeKeyBindings(value)).toEqual(defaults);
  });
  it('retains session controls when storage is blocked and tolerates missing layout API', async () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } } });
    const m = await import('./keyBindings');
    expect(m.changeKeyBinding('left', 'KeyH')).toBe(true); expect(m.getKeyBindings().left).toEqual(['KeyH']);
    await m.refreshKeyboardLayout(); expect(m.keyboardCodeLabel('KeyW')).toBe('W');
  });
  it('labels physical positions using the current keyboard layout when supported', async () => {
    vi.stubGlobal('navigator', { keyboard: { getLayoutMap: async () => new Map([['KeyW', 'z'], ['KeyA', 'q']]) } });
    const m = await import('./keyBindings'); await m.refreshKeyboardLayout();
    expect(m.keyboardActionLabel('up')).toBe('↑ / Z'); expect(m.keyboardActionLabel('left')).toBe('← / Q');
  });
});
