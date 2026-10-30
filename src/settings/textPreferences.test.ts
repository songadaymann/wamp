import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAME_SETTINGS, normalizeGameSettings } from './model';
import { applyTextPreferences, bindCanvasTextPreferences, resolveTextSize } from './textPreferences';
import { updateGameSettings } from './userSettings';

afterEach(() => { updateGameSettings(DEFAULT_GAME_SETTINGS); vi.unstubAllGlobals(); vi.resetModules(); });

describe('text preferences', () => {
  it('keeps old accounts retro and rejects unsupported settings', () => {
    expect(normalizeGameSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(normalizeGameSettings(JSON.parse('{"textStyle":"script","textSize":99}'))).toMatchObject({ textStyle: 'pixel', textSize: 'normal' });
    expect(normalizeGameSettings({ textStyle: 'readable', textSize: 'large' })).toMatchObject({ textStyle: 'readable', textSize: 'large' });
  });

  it('preserves default canvas sizes and bounds the optional tiers', () => {
    const retro = { textStyle: 'pixel', textSize: 'normal' } as const;
    const readable = { textStyle: 'readable', textSize: 'normal' } as const;
    expect([8, 12, 16, 24].map(n => resolveTextSize(n, retro))).toEqual([8, 12, 16, 24]);
    expect([8, 12, 16, 24].map(n => resolveTextSize(n, readable))).toEqual([12, 16, 20, 24]);
    expect([8, 12, 16].map(n => resolveTextSize(n, { ...readable, textSize: 'large' }))).toEqual([16, 16, 20]);
  });

  it('applies preferences before any settings dialog exists', () => {
    const doc = { body: { dataset: {} } };
    applyTextPreferences({ textStyle: 'readable', textSize: 'large' }, doc as unknown as Document);
    expect(doc.body.dataset).toEqual({ textStyle: 'readable', textSize: 'large' });
  });

  it('updates existing canvas labels and removes listeners when destroyed', () => {
    let destroy = () => {};
    const label = { active: true, scene: {}, setStyle: vi.fn(), updateText: vi.fn(), once: vi.fn((_: string, f: () => void) => { destroy = f; }) };
    bindCanvasTextPreferences(label, 'Early GameBoy', 8);
    expect(label.setStyle).toHaveBeenLastCalledWith({ fontFamily: 'Early GameBoy', fontSize: '8px' });
    updateGameSettings({ textStyle: 'readable', textSize: 'large' });
    expect(label.setStyle).toHaveBeenLastCalledWith({ fontFamily: '"IBM Plex Mono", monospace', fontSize: '16px' });
    destroy(); label.setStyle.mockClear(); updateGameSettings({ textStyle: 'pixel' });
    expect(label.setStyle).not.toHaveBeenCalled();
  });

  it('persists both choices and notifies changes once, even if storage is blocked', async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) } });
    const settings = await import('./userSettings');
    const listener = vi.fn(), unsubscribe = settings.subscribeGameSettings(listener);
    settings.updateGameSettings({ textStyle: 'readable', textSize: 'large' });
    settings.updateGameSettings({ textStyle: 'readable', textSize: 'large' });
    expect(listener).toHaveBeenCalledOnce(); unsubscribe();
    vi.resetModules();
    const reloaded = await import('./userSettings');
    expect(reloaded.getGameSettings()).toMatchObject({ textStyle: 'readable', textSize: 'large' });
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } } });
    reloaded.updateGameSettings({ textSize: 'normal' });
    expect(reloaded.getGameSettings().textSize).toBe('normal');
  });
});
