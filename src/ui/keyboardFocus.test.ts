import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';

const modal = vi.hoisted(() => ({ open: false }));
vi.mock('phaser', () => ({ default: {} }));
vi.mock('./modalState', () => ({ hasBlockingModalOpen: () => modal.open, isInWalletWindow: () => false }));

import { syncGameKeyboardFocus } from './keyboardFocus';

function fixture() {
  class Element {}
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('HTMLTextAreaElement', Element);
  vi.stubGlobal('HTMLSelectElement', Element);
  vi.stubGlobal('HTMLInputElement', Element);
  vi.stubGlobal('document', { activeElement: null });
  modal.open = false;
  let active = true;
  const keyboard = { enabled: true, resetKeys: vi.fn() };
  const manager = { captures: [32, 37, 39], preventDefault: true };
  const scene = { input: { keyboard } };
  const game = {
    input: { keyboard: manager },
    scene: { getScenes: (onlyActive: boolean) => onlyActive && !active ? [] : [scene] },
  } as unknown as Phaser.Game;
  return { game, keyboard, manager, pause: () => { active = false; }, resume: () => { active = true; } };
}

afterEach(() => vi.unstubAllGlobals());

describe('game keyboard across a room intro pause', () => {
  it('restores movement when the dialog closes before the scene resumes', () => {
    const f = fixture();
    modal.open = true;
    syncGameKeyboardFocus(f.game);
    expect(f.keyboard.enabled).toBe(false);
    expect(f.keyboard.resetKeys).toHaveBeenCalledOnce();

    f.pause();
    modal.open = false;
    syncGameKeyboardFocus(f.game);
    f.resume();
    expect(f.keyboard.enabled).toBe(true);
    expect(f.manager.preventDefault).toBe(true);
  });

  it('clears held keys if the scene pauses before the dialog opens', () => {
    const f = fixture();
    f.pause();
    modal.open = true;
    syncGameKeyboardFocus(f.game);
    syncGameKeyboardFocus(f.game);
    expect(f.keyboard.enabled).toBe(false);
    expect(f.keyboard.resetKeys).toHaveBeenCalledOnce();
    expect(f.manager.preventDefault).toBe(false);

    modal.open = false;
    syncGameKeyboardFocus(f.game);
    expect(f.keyboard.enabled).toBe(true);
  });
});
