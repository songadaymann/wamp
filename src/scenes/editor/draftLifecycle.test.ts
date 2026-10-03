import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftBackupDebouncer, EditorDraftLifecycle } from './draftLifecycle';

function fixture() {
  const browserWindow = new EventTarget() as unknown as Window;
  const browserDocument = new EventTarget() as unknown as Document;
  Object.defineProperty(browserDocument, 'visibilityState', { value: 'visible', writable: true });
  const host = { isActive: vi.fn(() => true), hasUnsavedChanges: vi.fn(() => true), flush: vi.fn() };
  const lifecycle = new EditorDraftLifecycle(host, { window: browserWindow, document: browserDocument });
  lifecycle.start();
  return { browserWindow, browserDocument, host, lifecycle };
}

afterEach(() => vi.useRealTimers());

describe('editor browser lifecycle', () => {
  it('synchronously flushes and requests a close warning only for active dirty editors', () => {
    const { browserWindow, host } = fixture();
    const dirtyClose = new Event('beforeunload', { cancelable: true });
    browserWindow.dispatchEvent(dirtyClose);
    expect(dirtyClose.defaultPrevented).toBe(true);
    expect(host.flush).toHaveBeenCalledTimes(1);
    host.hasUnsavedChanges.mockReturnValue(false);
    const cleanClose = new Event('beforeunload', { cancelable: true });
    browserWindow.dispatchEvent(cleanClose);
    expect(cleanClose.defaultPrevented).toBe(false);
    host.hasUnsavedChanges.mockReturnValue(true);
    host.isActive.mockReturnValue(false);
    const inactiveClose = new Event('beforeunload', { cancelable: true });
    browserWindow.dispatchEvent(inactiveClose);
    expect(inactiveClose.defaultPrevented).toBe(false);
    expect(host.flush).toHaveBeenCalledTimes(1);
  });

  it('flushes immediately for pagehide and hidden visibility, and removes all listeners on shutdown', () => {
    const { browserWindow, browserDocument, host, lifecycle } = fixture();
    lifecycle.start();
    browserDocument.dispatchEvent(new Event('visibilitychange'));
    expect(host.flush).not.toHaveBeenCalled();
    Object.defineProperty(browserDocument, 'visibilityState', { value: 'hidden' });
    browserDocument.dispatchEvent(new Event('visibilitychange'));
    browserWindow.dispatchEvent(new Event('pagehide'));
    expect(host.flush).toHaveBeenCalledTimes(2);
    lifecycle.destroy();
    expect(host.flush).toHaveBeenCalledTimes(3);
    lifecycle.destroy();
    browserDocument.dispatchEvent(new Event('visibilitychange'));
    browserWindow.dispatchEvent(new Event('pagehide'));
    const close = new Event('beforeunload', { cancelable: true });
    browserWindow.dispatchEvent(close);
    expect(close.defaultPrevented).toBe(false);
    expect(host.flush).toHaveBeenCalledTimes(3);
  });
});

describe('local backup debounce', () => {
  it('coalesces edits and performs a synchronous lifecycle flush before the timer expires', () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const debounce = new DraftBackupDebouncer(write);
    debounce.schedule();
    vi.advanceTimersByTime(300);
    debounce.schedule();
    vi.advanceTimersByTime(300);
    expect(write).not.toHaveBeenCalled();
    debounce.flush();
    expect(write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
    debounce.schedule();
    vi.advanceTimersByTime(500);
    expect(write).toHaveBeenCalledTimes(2);
    debounce.schedule();
    debounce.cancel();
    vi.advanceTimersByTime(500);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
