import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const sheets: { onload: (() => void) | null; onerror: (() => void) | null;
  dataset: Record<string, string>; remove: ReturnType<typeof vi.fn> }[] = [];
const shared = {};
const insert = vi.fn();
const dispatched = vi.fn();
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  sheets.length = 0;
  insert.mockClear();
  dispatched.mockClear();
  vi.stubGlobal('window', { setTimeout, clearTimeout, dispatchEvent: dispatched });
  vi.stubGlobal('document', {
    createElement: () => {
      const sheet = { onload: null, onerror: null, dataset: {}, remove: vi.fn() };
      sheets.push(sheet);
      return sheet;
    },
    head: { querySelector: () => shared, insertBefore: insert },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('shares the pending style load and waits for readiness before either editor opens', async () => {
  const { ensureEditorStylesReady } = await import('./editorStyles');
  const first = ensureEditorStylesReady();
  expect(ensureEditorStylesReady()).toBe(first);
  let resolved = false;
  void first.then(() => { resolved = true; });
  await Promise.resolve();
  expect(resolved).toBe(false);
  expect(insert).toHaveBeenCalledWith(sheets[0], shared);
  sheets[0].onload?.();
  await first;
  expect(ensureEditorStylesReady()).toBe(first);
  expect(sheets).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('removes a failed sheet and allows a fresh editor request to retry', async () => {
  const { ensureEditorStylesReady } = await import('./editorStyles');
  const failed = expect(ensureEditorStylesReady()).rejects.toThrow('Please try again');
  sheets[0].onerror?.();
  await failed;
  expect(sheets[0].remove).toHaveBeenCalledOnce();
  // A failed download may mean this tab's build was replaced by a release (F374).
  expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ type: 'wamp:stale-asset' }));
  const retry = ensureEditorStylesReady();
  sheets[1].onload?.();
  await retry;
});

it('times out a stalled download without leaving the next editor request stuck', async () => {
  const { ensureEditorStylesReady } = await import('./editorStyles');
  const stalled = expect(ensureEditorStylesReady()).rejects.toThrow('Please try again');
  await vi.advanceTimersByTimeAsync(20_000);
  await stalled;
  expect(sheets[0].remove).toHaveBeenCalledOnce();
  const retry = ensureEditorStylesReady();
  sheets[1].onload?.();
  await retry;
});
