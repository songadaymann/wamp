import { expect, it, vi } from 'vitest';
import { LazyFirstPublishController } from './lazyFirstPublish';
import { ROOM_FIRST_PUBLISHED_EVENT, ROOM_PUBLISH_NAME_REQUEST_EVENT, type RoomPublishNameRequest } from '../../publishing/events';
import { APP_MODE_CHANGED_EVENT } from '../appMode';
import { AUTH_STATE_CHANGED_EVENT } from '../../auth/client';

const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function fixture() {
  const win = new EventTarget(); let account: string | null = 'builder', mode = 'editor';
  const controller = { init: vi.fn(), destroy: vi.fn(), close: vi.fn(), requestName: vi.fn(() => true), announcePublished: vi.fn() };
  let resolve!: (value: typeof controller) => void;
  const load = vi.fn(() => new Promise<typeof controller>(done => { resolve = done; }));
  const lazy = new LazyFirstPublishController(load, win as Window, () => account, () => mode); lazy.init();
  const name = (userId = 'builder') => {
    const detail: RoomPublishNameRequest = { userId, suggestedTitle: 'Treasure', resolve: vi.fn() };
    const handled = !win.dispatchEvent(new CustomEvent(ROOM_PUBLISH_NAME_REQUEST_EVENT, { detail, cancelable: true }));
    return { detail, handled };
  };
  return { win, controller, lazy, load, name, finish: () => resolve(controller),
    account: (next: string | null) => { account = next; win.dispatchEvent(new Event(AUTH_STATE_CHANGED_EVENT)); },
    mode: (next: string) => { mode = next; win.dispatchEvent(new Event(APP_MODE_CHANGED_EVENT)); } };
}
it('accepts a synchronous publish request and retains its original resolver during download', async () => {
  const f = fixture(); expect(f.load).not.toHaveBeenCalled(); const request = f.name(); expect(request.handled).toBe(true);
  expect(request.detail.resolve).not.toHaveBeenCalled(); f.finish(); await settle();
  expect(f.controller.init).toHaveBeenCalledOnce(); expect(f.controller.requestName).toHaveBeenCalledExactlyOnceWith(request.detail);
  expect(request.detail.resolve).not.toHaveBeenCalled(); f.lazy.destroy();
});
it('cancels replaced requests once, leaving only the newest prompt', async () => {
  const f = fixture(), first = f.name(), latest = f.name(); expect(first.detail.resolve).toHaveBeenCalledExactlyOnceWith(null);
  f.finish(); await settle(); expect(f.load).toHaveBeenCalledOnce(); expect(f.controller.requestName).toHaveBeenCalledExactlyOnceWith(latest.detail); f.lazy.destroy();
});
it('does not consume or download another account request', () => {
  const f = fixture(), request = f.name('other'); expect(request.handled).toBe(false); expect(f.load).not.toHaveBeenCalled(); f.lazy.destroy();
});
it('cancels pending downloads on scene or account changes, but preserves same-account/session mode refreshes', async () => {
  const f = fixture(), first = f.name(); f.account('builder'); f.mode('editor'); expect(first.detail.resolve).not.toHaveBeenCalled();
  f.mode('world'); expect(first.detail.resolve).toHaveBeenCalledExactlyOnceWith(null);
  const second = f.name(); f.account(null); expect(second.detail.resolve).toHaveBeenCalledExactlyOnceWith(null);
  f.finish(); await settle(); expect(f.controller.requestName).not.toHaveBeenCalled(); f.lazy.destroy();
});
it('closing or destroying while loading cannot reopen a dialog or initialize after destruction', async () => {
  const f = fixture(), request = f.name(); f.lazy.close(); f.lazy.destroy(); f.finish(); await settle();
  expect(request.detail.resolve).toHaveBeenCalledExactlyOnceWith(null); expect(f.controller.init).not.toHaveBeenCalled(); expect(f.controller.requestName).not.toHaveBeenCalled();
});
it('download failure resolves the publisher and the next request retries', async () => {
  const f = fixture(); f.load.mockRejectedValueOnce(new Error('offline')); const first = f.name(); await settle();
  expect(first.detail.resolve).toHaveBeenCalledExactlyOnceWith(null); const second = f.name(); f.finish(); await settle();
  expect(f.controller.requestName).toHaveBeenCalledExactlyOnceWith(second.detail); f.lazy.destroy();
});
it('resolves a held name if the loaded controller can no longer accept it', async () => {
  const f = fixture(); f.controller.requestName.mockReturnValue(false); const request = f.name(); f.finish(); await settle();
  expect(request.detail.resolve).toHaveBeenCalledExactlyOnceWith(null); f.lazy.destroy();
});
it('keeps the published-room payload and hands subsequent events to the initialized controller', async () => {
  const f = fixture(); const detail = { userId: 'builder', title: 'A saved room', play: vi.fn() };
  f.win.dispatchEvent(new CustomEvent(ROOM_FIRST_PUBLISHED_EVENT, { detail })); f.finish(); await settle();
  expect(f.controller.announcePublished).toHaveBeenCalledExactlyOnceWith(detail);
  f.win.dispatchEvent(new CustomEvent(ROOM_FIRST_PUBLISHED_EVENT, { detail })); expect(f.load).toHaveBeenCalledOnce(); expect(f.controller.announcePublished).toHaveBeenCalledOnce(); f.lazy.destroy();
});
