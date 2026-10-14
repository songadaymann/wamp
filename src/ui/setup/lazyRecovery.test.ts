import { afterEach, expect, it, vi } from 'vitest';
import { LazyRecoveryController } from './lazyRecovery';
import { APP_READY_EVENT } from '../appFeedback';
afterEach(() => vi.useRealTimers());
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function fixture() {
  vi.useFakeTimers(); const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const events = new EventTarget();
  const button = Object.assign(events, { click: () => events.dispatchEvent(new Event('click')) });
  const doc = Object.assign(new EventTarget(), { body: { dataset: { appReady: 'false' } }, getElementById: () => button });
  const controller = { init: vi.fn(), close: vi.fn(), destroy: vi.fn(), open: vi.fn() };
  let resolve!: (value: typeof controller) => void;
  const load = vi.fn(() => new Promise<typeof controller>(done => { resolve = done; }));
  const lazy = new LazyRecoveryController(load, 'history', 200, doc as unknown as Document, win as unknown as Window); lazy.init();
  return { doc, win, button, controller, load, lazy, finish: () => resolve(controller), ready: () => { doc.body.dataset.appReady = 'true'; win.dispatchEvent(new Event(APP_READY_EVENT)); } };
}
it('waits for app readiness before automatically starting recovery, and deduplicates wakeups', async () => {
  const f = fixture(); await vi.advanceTimersByTimeAsync(4000); expect(f.load).not.toHaveBeenCalled();
  f.ready(); f.win.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(199); expect(f.load).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(f.load).toHaveBeenCalledOnce(); f.finish(); await settle(); expect(f.controller.init).toHaveBeenCalledOnce();
  f.win.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(4000); expect(f.load).toHaveBeenCalledOnce(); f.lazy.destroy();
});
it('replays an explicit first menu click once after its listeners initialize', async () => {
  const f = fixture(); f.controller.init.mockImplementation(() => f.button.addEventListener('click', f.controller.open));
  f.button.click(); f.button.click(); f.finish(); await settle(); expect(f.load).toHaveBeenCalledOnce(); expect(f.controller.open).toHaveBeenCalledOnce(); f.lazy.destroy();
});
it('close cancels a pending history action without stopping automatic recovery initialization', async () => {
  const f = fixture(); const opening = f.lazy.invoke(controller => controller.open()); f.lazy.close(); f.finish(); await opening;
  expect(f.controller.init).toHaveBeenCalledOnce(); expect(f.controller.open).not.toHaveBeenCalled(); f.lazy.destroy();
});
it('does not initialize or perform actions after destruction during a download', async () => {
  const f = fixture(); const opening = f.lazy.invoke(controller => controller.open()); f.lazy.destroy(); f.finish(); await opening;
  expect(f.controller.init).not.toHaveBeenCalled(); expect(f.controller.open).not.toHaveBeenCalled();
});
it('retries an automatic download failure after backoff', async () => {
  const f = fixture(); f.load.mockRejectedValueOnce(new Error('offline')); f.ready(); await vi.advanceTimersByTimeAsync(200);
  expect(f.load).toHaveBeenCalledOnce(); await vi.advanceTimersByTimeAsync(19999); expect(f.load).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(f.load).toHaveBeenCalledTimes(2); f.finish(); await settle(); expect(f.controller.init).toHaveBeenCalledOnce(); f.lazy.destroy();
});
it('teardown clears the delayed start and wake listeners', async () => {
  const f = fixture(); f.ready(); f.lazy.destroy(); f.win.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(1000);
  expect(f.load).not.toHaveBeenCalled();
});
