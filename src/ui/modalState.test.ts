import type Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDialogKeyboardSync } from './keyboardFocus';
import { hasBlockingModalOpen, installDialogEscapeGuard, installModalFocusManagement, installModalStackBackdrops, watchModals } from './modalState';
import { LazyModal } from './setup/lazyModal';
import { installFakeDom, type FakeDom, type FakeTemplate } from './testing/fakeDom';

vi.mock('phaser', () => ({ default: {} }));
afterEach(() => vi.unstubAllGlobals());

/** A shared dialog as createModalLifecycle builds it: show/hide toggle classes, Escape closes it. */
function sharedDialog(dom: FakeDom, id: string) {
  const action = dom.element('button', { type: 'button', class: 'bar-btn' });
  const close = dom.element('button', { id: `btn-${id}-close`, type: 'button', class: 'bar-btn' });
  const panel = dom.element('div', { class: 'history-modal-panel', role: 'dialog', 'aria-modal': 'true' }, action, close);
  const modal = dom.element('div', { id, class: 'history-modal hidden', 'aria-hidden': 'true' }, panel);
  modal.zIndex = 40;
  const show = (): void => { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); };
  const hide = (): void => { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); };
  close.addEventListener('click', hide);
  dom.doc.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.classList.contains('hidden')) hide(); });
  return { modal, panel, action, close, show, hide };
}

function fakeGame() {
  const keyboard = { enabled: true, resetKeys: vi.fn() };
  const game = { input: { keyboard: { captures: [32, 37, 39], preventDefault: true } }, scene: { getScenes: () => [{ input: { keyboard } }] } };
  return { game: game as unknown as Phaser.Game, keyboard };
}

/** Everything main.ts installs at boot, before any on-demand dialog is on the page. */
function installDialogSystem(dom: FakeDom) {
  const doc = dom.doc as unknown as Document;
  const { game, keyboard } = fakeGame();
  const stops = [installDialogEscapeGuard(doc), installModalStackBackdrops(doc), installModalFocusManagement(doc), installDialogKeyboardSync(game, doc)];
  return { keyboard, stop: () => stops.forEach((stop) => stop()) };
}

describe('dialogs added to the page after boot (F380)', () => {
  it('gives a dialog swapped in from an on-demand template focus, one dimmed backdrop and the game keys', async () => {
    const dom = installFakeDom();
    const launcher = dom.element('button', { id: 'btn-auth-leaderboard', type: 'button' });
    const leaderboard = sharedDialog(dom, 'leaderboard-modal');
    const profile = sharedDialog(dom, 'profile-modal');
    const template = dom.doc.createElement('template') as FakeTemplate;
    template.id = 'deferred-profile-modal';
    template.content.append(profile.modal);
    dom.doc.body.append(launcher, leaderboard.modal, template);
    const system = installDialogSystem(dom);

    launcher.focus();
    leaderboard.show();
    await dom.settle();
    expect(dom.doc.activeElement).toBe(leaderboard.panel);
    expect(system.keyboard.enabled).toBe(false);

    leaderboard.action.focus();
    const profileModal = new LazyModal(async () => ({ init: () => undefined, open: profile.show, close: profile.hide }), ['profile-modal']);
    await profileModal.open();
    await dom.settle();
    expect(profile.modal.isConnected).toBe(true);
    expect(dom.doc.activeElement).toBe(profile.panel);
    expect(leaderboard.modal.dataset.modalCovered).toBe('true');
    expect(profile.modal.dataset.modalCovered).toBeUndefined();

    // Tab stays inside the new top dialog.
    dom.press('Tab');
    expect(dom.doc.activeElement).toBe(profile.action);
    dom.press('Tab', { shiftKey: true });
    expect(dom.doc.activeElement).toBe(profile.close);

    // Escape closes only the top dialog, is kept from the game, and focus goes back.
    expect(dom.press('Escape').defaultPrevented).toBe(true);
    await dom.settle();
    expect(profile.modal.classList.contains('hidden')).toBe(true);
    expect(leaderboard.modal.classList.contains('hidden')).toBe(false);
    expect(leaderboard.modal.dataset.modalCovered).toBeUndefined();
    expect(dom.doc.activeElement).toBe(leaderboard.action);
    expect(system.keyboard.enabled).toBe(false);

    dom.press('Escape');
    await dom.settle();
    expect(hasBlockingModalOpen(dom.doc as unknown as Document)).toBe(false);
    expect(dom.doc.activeElement).toBe(launcher);
    expect(system.keyboard.enabled).toBe(true);
    system.stop();
  });

  it('keeps telling the other managers when one of them throws', async () => {
    const dom = installFakeDom();
    const doc = dom.doc as unknown as Document;
    const dialog = sharedDialog(dom, 'settings-modal');
    dom.doc.body.append(dialog.modal);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stopBroken = watchModals(doc, () => { throw new Error('broken listener'); });
    const system = installDialogSystem(dom);
    dialog.show();
    await dom.settle();
    expect(system.keyboard.enabled).toBe(false);
    expect(error).toHaveBeenCalled();
    stopBroken();
    system.stop();
    error.mockRestore();
  });

  it('notices a dialog built in code and removed again', async () => {
    const dom = installFakeDom();
    const launcher = dom.element('button', { type: 'button' });
    dom.doc.body.append(launcher);
    const system = installDialogSystem(dom);
    launcher.focus();

    const built = sharedDialog(dom, 'built-modal');
    built.show();
    dom.doc.body.append(built.modal);
    // The dialog moves focus itself as it opens; closing still returns it to the launcher.
    built.action.focus();
    await dom.settle();
    expect(system.keyboard.enabled).toBe(false);
    expect(dom.doc.activeElement).toBe(built.action);

    built.modal.remove();
    await dom.settle();
    expect(system.keyboard.enabled).toBe(true);
    expect(dom.doc.activeElement).toBe(launcher);

    // After a click on the game (focus back on the page), closing doesn't jump to an old button.
    launcher.blur();
    dom.doc.body.append(built.modal);
    built.action.focus();
    await dom.settle();
    built.modal.remove();
    await dom.settle();
    expect(dom.doc.activeElement).toBe(dom.doc.body);
    system.stop();
  });
});
