import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDialogKeyboardSync } from '../keyboardFocus';
import { hasBlockingModalOpen, installDialogEscapeGuard, installModalFocusManagement, installModalStackBackdrops } from '../modalState';
import { installFakeDom, type FakeElement } from '../testing/fakeDom';
import { WorldsController } from './controller';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('../setup/sceneBridge', () => ({ getActiveOverworldScene: () => null }));
vi.mock('./repository', () => ({
  WorldsRepository: class { list = async () => ({ worlds: [] }); },
  WorldsApiError: class extends Error {},
}));
afterEach(() => vi.unstubAllGlobals());

describe('the Worlds window is a shared dialog (F406)', () => {
  it('takes focus and the game keys, keeps Tab, and closes on Escape only when it is the top dialog', async () => {
    const dom = installFakeDom();
    const doc = dom.doc as unknown as Document;
    const button = dom.element('button', { id: 'btn-world-worlds', class: 'bar-btn hidden', type: 'button' });
    const root = dom.element('div', { id: 'worlds-modal-root' });
    dom.doc.body.append(button, root);
    const keyboard = { enabled: true, resetKeys: vi.fn() };
    const game = { input: { keyboard: { captures: [32, 37, 38, 39, 40], preventDefault: true } }, scene: { getScenes: () => [{ input: { keyboard } }] } };
    // Boot order: the shared managers start before setupUI builds the Worlds markup.
    installDialogEscapeGuard(doc);
    installModalStackBackdrops(doc);
    installModalFocusManagement(doc);
    installDialogKeyboardSync(game as unknown as Phaser.Game, doc);
    new WorldsController(game as unknown as Phaser.Game).init();
    await dom.settle();
    const worlds = root.querySelector('.worlds-modal')!;
    worlds.zIndex = 40;
    const panel = root.querySelector('.worlds-panel')!;
    const close = root.querySelector('[data-world-action="close"]')!;
    const mineTab = root.querySelector('[data-world-tab="mine"]')!;

    button.focus();
    button.click();
    await dom.settle();
    expect(hasBlockingModalOpen(doc)).toBe(true);
    expect(dom.doc.activeElement).toBe(panel);
    expect(keyboard.enabled).toBe(false);
    expect(game.input.keyboard.preventDefault).toBe(false);

    dom.press('Tab');
    expect(dom.doc.activeElement).toBe(close);
    dom.press('Tab', { shiftKey: true });
    expect(dom.doc.activeElement).toBe(mineTab);

    // A sign-in dialog opened over Worlds: Escape closes only that one, then Worlds.
    const signIn: FakeElement = dom.element('div', { class: 'history-modal' },
      dom.element('div', { role: 'dialog' }, dom.element('button', { id: 'btn-sign-in-close', type: 'button' })));
    signIn.zIndex = 40;
    signIn.querySelector('button')!.addEventListener('click', () => signIn.classList.add('hidden'));
    dom.doc.body.append(signIn);
    await dom.settle();
    expect(worlds.dataset.modalCovered).toBe('true');
    expect(dom.press('Escape').defaultPrevented).toBe(true);
    await dom.settle();
    expect(signIn.classList.contains('hidden')).toBe(true);
    expect(worlds.classList.contains('hidden')).toBe(false);

    expect(dom.press('Escape').defaultPrevented).toBe(true);
    await dom.settle();
    expect(worlds.classList.contains('hidden')).toBe(true);
    expect(dom.doc.activeElement).toBe(button);
    expect(keyboard.enabled).toBe(true);
  });
});
