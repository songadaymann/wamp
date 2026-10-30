import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom, type FakeElement } from './testing/fakeDom';

vi.mock('phaser', () => ({ default: {} }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// The pop-up's real markup, so the test sees its data-autofocus card and button roles.
const BUSY_MARKUP = /<div id="busy-overlay"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/
  .exec(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'))![0];

async function setup() {
  vi.resetModules();
  const dom = installFakeDom();
  const host = dom.element('div');
  host.innerHTML = BUSY_MARKUP;
  const launcher = dom.element('button', { id: 'btn-save', type: 'button' });
  dom.doc.body.append(launcher, ...host.children);
  const doc = dom.doc as unknown as Document;
  const feedback = await import('./appFeedback');
  const modalState = await import('./modalState');
  feedback.initializeAppFeedback(doc);
  modalState.installDialogEscapeGuard(doc);
  modalState.installModalStackBackdrops(doc);
  modalState.installModalFocusManagement(doc);
  const byId = (id: string): FakeElement => dom.doc.getElementById(id)!;
  const root = byId('busy-overlay');
  root.zIndex = 135;
  launcher.focus();
  return {
    dom, feedback, root, launcher,
    card: root.querySelector('.app-busy-card')!,
    retry: byId('btn-busy-retry'),
    close: byId('btn-busy-close'),
    blocking: () => modalState.hasBlockingModalOpen(doc),
  };
}

describe('the shared pop-up (F467)', () => {
  it('lets a new message replace only an idle card or a plain error, never a choice or a spinner', async () => {
    const { feedback } = await setup();
    expect(feedback.canReplaceBusyCard()).toBe(true);
    feedback.showBusyError('Could not save.');
    expect(feedback.canReplaceBusyCard()).toBe(true);
    feedback.showBusyError('Keep yours or load theirs?', { tone: 'choice', closeHandler: () => {} });
    expect(feedback.canReplaceBusyCard()).toBe(false);
    feedback.showBusyOverlay('Saving room');
    expect(feedback.canReplaceBusyCard()).toBe(false);
    feedback.hideBusyOverlay();
    expect(feedback.canReplaceBusyCard()).toBe(true);
  });

  it('tells errors, good news and choices apart, and paints only a button that throws work away red', async () => {
    const f = await setup();
    f.feedback.showBusyError('Failed to load room.', { retryHandler: vi.fn() });
    expect(f.root.dataset.busyTone).toBe('error');
    expect(f.retry.getAttribute('data-button-variant')).toBeNull();
    expect(f.close.getAttribute('data-button-variant')).toBe('neutral');

    f.feedback.showBusyError('Your room approval is confirmed.', { title: 'Room approval', tone: 'success', closeLabel: 'Back to room' });
    expect(f.root.dataset.busyTone).toBe('success');
    expect(f.close.getAttribute('data-button-variant')).toBe('neutral');

    f.feedback.showBusyError('Choose which draft to continue editing.', {
      tone: 'choice', retryLabel: 'Restore Local', retryHandler: vi.fn(), closeLabel: 'Use Account Draft', closeHandler: vi.fn(), destructive: 'close',
    });
    expect(f.root.dataset.busyTone).toBe('choice');
    expect(f.close.getAttribute('data-button-variant')).toBe('danger');
    expect(f.retry.getAttribute('data-button-variant')).toBeNull();

    f.feedback.showBusyError('Load Latest discards the changes made here.', { tone: 'choice', retryHandler: vi.fn(), destructive: 'retry' });
    expect(f.retry.getAttribute('data-button-variant')).toBe('danger');
    expect(f.close.getAttribute('data-button-variant')).toBe('neutral');

    // Plain loading is a status, not a dialog.
    f.feedback.showBusyOverlay('Saving room...');
    expect(f.root.dataset.busyTone).toBeUndefined();
    expect(f.root.getAttribute('role')).toBeNull();
    expect(f.blocking()).toBe(false);
    f.feedback.hideBusyOverlay();
  });

  it('takes focus like the other dialogs, keeps Tab and Escape, and gives focus back', async () => {
    const f = await setup();
    const retry = vi.fn();
    f.feedback.showBusyError('Failed to load room.', { retryHandler: retry });
    await f.dom.settle();
    expect(f.root.getAttribute('role')).toBe('dialog');
    expect(f.blocking()).toBe(true);
    expect(f.dom.doc.activeElement).toBe(f.card);

    // From the focused card, Shift+Tab wraps to the last button instead of leaving the page.
    f.dom.press('Tab', { shiftKey: true });
    expect(f.dom.doc.activeElement).toBe(f.close);
    f.dom.press('Tab');
    expect(f.dom.doc.activeElement).toBe(f.retry);
    f.dom.press('Tab');
    expect(f.dom.doc.activeElement).toBe(f.close);
    f.dom.press('Tab');
    expect(f.dom.doc.activeElement).toBe(f.retry);
    f.dom.press('Tab', { shiftKey: true });
    expect(f.dom.doc.activeElement).toBe(f.close);

    expect(f.dom.press('Escape').defaultPrevented).toBe(true);
    await f.dom.settle();
    expect(retry).not.toHaveBeenCalled();
    expect(f.root.classList.contains('hidden')).toBe(true);
    expect(f.root.getAttribute('aria-modal')).toBeNull();
    expect(f.blocking()).toBe(false);
    expect(f.dom.doc.activeElement).toBe(f.launcher);
  });

  it('lets Escape dismiss a notice but not answer a choice, and keeps it from the game either way', async () => {
    const f = await setup();
    const restore = vi.fn();
    const useAccount = vi.fn();
    f.feedback.showBusyError('Restore the local changes for review, or use the account draft?', {
      tone: 'choice', retryLabel: 'Restore Local', retryHandler: restore, closeLabel: 'Use Account Draft', closeHandler: useAccount, destructive: 'close',
    });
    await f.dom.settle();
    expect(f.dom.press('Escape').defaultPrevented).toBe(true);
    await f.dom.settle();
    expect(restore).not.toHaveBeenCalled();
    expect(useAccount).not.toHaveBeenCalled();
    expect(f.blocking()).toBe(true);

    // The stale-build reload offer reads this, and never replaces an open choice.
    expect(f.feedback.getAppFeedbackDebugState()).toMatchObject({ busyState: 'error', busyTone: 'choice' });

    f.feedback.showBusyError('A new version of WAMP came out.', { title: 'WAMP was updated', tone: 'choice', retryLabel: 'Reload', closeLabel: 'Not now', retryHandler: vi.fn() });
    expect(f.dom.press('Escape').defaultPrevented).toBe(true);
    await f.dom.settle();
    expect(f.blocking()).toBe(false);
  });

  it('is not a dialog while it waits on the wallet, so the wallet window keeps the keyboard', async () => {
    const f = await setup();
    const close = vi.fn();
    f.feedback.showBusyOverlay('Approve in your wallet', 'Waiting for your wallet...', { close, check: vi.fn() });
    await f.dom.settle();
    expect(f.root.getAttribute('role')).toBeNull();
    expect(f.blocking()).toBe(false);
    expect(f.dom.doc.activeElement).toBe(f.launcher);
    expect(f.dom.press('Escape').defaultPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();

    // Typing in the wallet window's search box (in its shadow root, so the page sees the window
    // itself as focused): the game lets go of its keys.
    const { isGameKeyboardYielded } = await import('./keyboardFocus');
    const wallet = f.dom.element('w3m-modal', { tabindex: '-1' });
    f.dom.doc.body.append(wallet);
    expect(isGameKeyboardYielded(f.dom.doc as unknown as Document)).toBe(false);
    wallet.focus();
    expect(isGameKeyboardYielded(f.dom.doc as unknown as Document)).toBe(true);
  });

  it('leaves focus, Tab and Escape inside the wallet window to the wallet, even over a dialog', async () => {
    const f = await setup();
    const close = vi.fn();
    f.feedback.showBusyError('Could not check the room approval.', { closeHandler: close });
    await f.dom.settle();
    const search = f.dom.element('input', { type: 'text' });
    const wallet = f.dom.element('w3m-modal', {}, search, f.dom.element('button', { type: 'button' }));
    f.dom.doc.body.append(wallet);

    search.focus();
    await f.dom.settle();
    expect(f.dom.doc.activeElement).toBe(search);
    expect(f.dom.press('Tab').defaultPrevented).toBe(false);
    search.focus();
    expect(f.dom.press('Escape').defaultPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(f.blocking()).toBe(true);
  });

  it('closes only itself over another dialog, which drops its own backdrop meanwhile', async () => {
    const f = await setup();
    const action = f.dom.element('button', { type: 'button' });
    const explore = f.dom.element('div', { id: 'explore-modal', class: 'history-modal' },
      f.dom.element('div', { role: 'dialog', 'aria-modal': 'true' }, action, f.dom.element('button', { id: 'btn-explore-close', type: 'button' })));
    explore.zIndex = 40;
    const closeExplore = vi.fn();
    f.dom.doc.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeExplore(); });
    f.dom.doc.body.append(explore);
    action.focus();
    await f.dom.settle();

    f.feedback.showBusyError('Could not load this list.');
    await f.dom.settle();
    expect(explore.dataset.modalCovered).toBe('true');
    expect(f.root.dataset.modalCovered).toBeUndefined();
    expect(f.dom.doc.activeElement).toBe(f.card);

    f.dom.press('Escape');
    await f.dom.settle();
    expect(closeExplore).not.toHaveBeenCalled();
    expect(f.root.classList.contains('hidden')).toBe(true);
    expect(explore.dataset.modalCovered).toBeUndefined();
    expect(f.dom.doc.activeElement).toBe(action);
  });

  it('keeps the consent sheet on Cancel, with Tab between its two buttons and Escape to cancel', async () => {
    const f = await setup();
    const controller = new AbortController();
    const answer = f.feedback.requestBusyConfirmation('Collect this room', 'Base network fee applies.', { confirmLabel: 'Collect', signal: controller.signal });
    await f.dom.settle();
    expect(f.root.getAttribute('role')).toBe('dialog');
    expect(f.root.dataset.busyState).toBe('confirmation');
    expect(f.close.textContent).toBe('Cancel');
    expect(f.close.getAttribute('data-button-variant')).toBe('neutral');
    expect(f.dom.doc.activeElement).toBe(f.close);
    f.dom.press('Tab');
    expect(f.dom.doc.activeElement).toBe(f.retry);
    f.dom.press('Tab', { shiftKey: true });
    expect(f.dom.doc.activeElement).toBe(f.close);

    f.dom.press('Escape');
    await expect(answer).resolves.toBe(false);
    await f.dom.settle();
    expect(f.root.getAttribute('role')).toBeNull();
    expect(f.dom.doc.activeElement).toBe(f.launcher);
  });
});


it('finishes boot diagnostics before app-ready listeners run, only once', async () => {
  const { feedback } = await setup();
  vi.useFakeTimers();
  const events = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  vi.stubGlobal('window', events);
  const diagnostics = await import('../main/bootDiagnostics');
  const listener = vi.fn(() => {
    expect(diagnostics.getBootDiagnostics().active).toBe(false);
  });
  events.addEventListener('wamp:app-ready', listener);
  expect(diagnostics.getBootDiagnostics().active).toBe(true);
  diagnostics.startBootStallWatch('already pending before readiness', 100);
  feedback.markAppReady();
  feedback.markAppReady();
  expect(listener).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(100);
  const state = diagnostics.getBootDiagnostics();
  expect((state.entries as { phase: string }[]).map(entry => entry.phase)).toEqual(['app-ready']);
});
