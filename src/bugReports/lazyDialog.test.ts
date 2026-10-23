import { describe, expect, it, vi } from 'vitest';
import { hasPendingDialog } from '../ui/pendingDialog';
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

describe('lazy bug report dialog', () => {
  it('downloads the form on the first Report click, and only once', async () => {
    const dialog = fakeDialog();
    const load = vi.fn(async () => dialog);
    const menuButton = new EventTarget(), settingsButton = new EventTarget();
    const lazy = installLazyBugReportDialog({ buttons: [menuButton, settingsButton], load, showLoadError: vi.fn() });
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
    installLazyBugReportDialog({ buttons: [button], load, showLoadError: vi.fn() });
    click(button);
    click(button);
    expect(hasPendingDialog()).toBe(true);
    download.resolve(dialog);
    await flush();
    expect(load).toHaveBeenCalledOnce();
    expect(dialog.open).toHaveBeenCalledOnce();
    expect(hasPendingDialog()).toBe(false);
  });

  it('shows an error with a retry when the download fails', async () => {
    const dialog = fakeDialog();
    const load = vi.fn<() => Promise<BugReportDialog>>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'))
      .mockResolvedValue(dialog);
    const showLoadError = vi.fn<(retry: () => void) => void>();
    const button = new EventTarget();
    installLazyBugReportDialog({ buttons: [button], load, showLoadError });
    click(button);
    await flush();
    expect(showLoadError).toHaveBeenCalledOnce();
    expect(dialog.open).not.toHaveBeenCalled();
    expect(hasPendingDialog()).toBe(false);

    showLoadError.mock.calls[0]?.[0]();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(dialog.open).toHaveBeenCalledOnce();
    expect(showLoadError).toHaveBeenCalledOnce();
  });

  it('cleans up a form that arrives after the game was destroyed and ignores later clicks', async () => {
    const dialog = fakeDialog();
    const download = deferred<BugReportDialog>();
    const load = vi.fn(() => download.promise);
    const showLoadError = vi.fn();
    const button = new EventTarget();
    const lazy = installLazyBugReportDialog({ buttons: [button], load, showLoadError });
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
    expect(showLoadError).not.toHaveBeenCalled();
    expect(lazy.isOpen()).toBe(false);
  });
});
