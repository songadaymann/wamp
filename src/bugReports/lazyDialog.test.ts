import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../ui/appFeedback', async (original) => ({ ...await original<object>(), showBusyError: vi.fn(), canReplaceBusyCard: () => true }));
vi.mock('../main/clientErrorReporter', () => ({ reportClientError: vi.fn() }));
import { showBusyError } from '../ui/appFeedback';
import { reportClientError } from '../main/clientErrorReporter';
import { hasPendingDialog } from '../ui/pendingDialog';
import { explainMenuLoadFailure } from '../ui/setup/lazyModal';
import { installLazyBugReportDialog } from './lazyDialog';
import type { BugReportDialog } from './reporter';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const click = (button: EventTarget) => button.dispatchEvent(new Event('click'));

function fakeDialog(): BugReportDialog & { opened: boolean } {
  const dialog = {
    opened: false,
    init: vi.fn(),
    open: vi.fn(() => { dialog.opened = true; }),
    close: vi.fn(() => { dialog.opened = false; }),
    isOpen: () => dialog.opened,
    destroy: vi.fn(),
  };
  return dialog;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

describe('lazy bug report dialog', () => {
  it('downloads the form on the first Report click, and only once', async () => {
    const dialog = fakeDialog();
    const load = vi.fn(async () => dialog);
    const menuButton = new EventTarget(), settingsButton = new EventTarget();
    const lazy = installLazyBugReportDialog({ buttons: [menuButton, settingsButton], load, onLoadError: vi.fn() });
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(lazy.isOpen()).toBe(false);

    click(menuButton);
    await flush();
    expect(load).toHaveBeenCalledOnce();
    expect(dialog.init).toHaveBeenCalledOnce();
    expect(dialog.open).toHaveBeenCalledOnce();
    expect(lazy.isOpen()).toBe(true);

    dialog.close();
    click(settingsButton);
    await flush();
    expect(load).toHaveBeenCalledOnce();
    expect(dialog.init).toHaveBeenCalledOnce();
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });

  it('shares one download between quick clicks and keeps gameplay paused until the form shows', async () => {
    const dialog = fakeDialog();
    const download = deferred<BugReportDialog>();
    const load = vi.fn(() => download.promise);
    const button = new EventTarget();
    installLazyBugReportDialog({ buttons: [button], load, onLoadError: vi.fn() });
    click(button);
    click(button);
    expect(hasPendingDialog()).toBe(true);
    download.resolve(dialog);
    await flush();
    expect(load).toHaveBeenCalledOnce();
    expect(dialog.open).toHaveBeenCalledOnce();
    expect(hasPendingDialog()).toBe(false);
  });

  it('explains a failed download once, without leaving gameplay paused, and a later Report click loads it again', async () => {
    const dialog = fakeDialog();
    const failure = new TypeError('Failed to fetch dynamically imported module');
    const load = vi.fn<() => Promise<BugReportDialog>>().mockRejectedValueOnce(failure).mockResolvedValue(dialog);
    const onLoadError = vi.fn();
    const button = new EventTarget();
    installLazyBugReportDialog({ buttons: [button], load, onLoadError });
    click(button);
    await flush();
    expect(onLoadError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(hasPendingDialog()).toBe(false);

    click(button);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(dialog.open).toHaveBeenCalledOnce();
    expect(onLoadError).toHaveBeenCalledOnce();
  });

  it('offers a reload, not a retry that would fail the same way, and reports the failure once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const button = new EventTarget();
    installLazyBugReportDialog({ buttons: [button], load: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
      onLoadError: explainMenuLoadFailure('bug report form') });
    click(button);
    await flush();
    expect(showBusyError).toHaveBeenCalledExactlyOnceWith(
      "The bug report form couldn't load. Check your connection, then reload WAMP. Save anything you are working on first.",
      expect.objectContaining({ title: 'Bug report form', retryLabel: 'Reload', closeLabel: 'Not now' }));
    expect(reportClientError).toHaveBeenCalledOnce();
  });

  it('says nothing about a download that fails after the game was destroyed', async () => {
    let fail!: (error: Error) => void;
    const onLoadError = vi.fn();
    const button = new EventTarget();
    const lazy = installLazyBugReportDialog({ buttons: [button], load: () => new Promise((_done, reject) => { fail = reject; }), onLoadError });
    click(button);
    lazy.destroy();
    fail(new Error('offline'));
    await flush();
    expect(onLoadError).not.toHaveBeenCalled();
  });

  it('cleans up a form that arrives after the game was destroyed and ignores later clicks', async () => {
    const dialog = fakeDialog();
    const download = deferred<BugReportDialog>();
    const load = vi.fn(() => download.promise);
    const onLoadError = vi.fn();
    const button = new EventTarget();
    const lazy = installLazyBugReportDialog({ buttons: [button], load, onLoadError });
    click(button);
    lazy.destroy();
    download.resolve(dialog);
    await flush();
    click(button);
    await flush();
    expect(dialog.destroy).toHaveBeenCalledOnce();
    expect(dialog.init).not.toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledOnce();
    expect(onLoadError).not.toHaveBeenCalled();
    expect(lazy.isOpen()).toBe(false);
  });
});
