import { expect, it, vi } from 'vitest';
import { LazyRunRatingController } from './lazyRunRating';
import { POST_RUN_GUEST_CLAIM_REQUEST_EVENT, POST_RUN_RATING_REQUEST_EVENT, type PostRunRatingRequestDetail } from '../../progression/postRunRatingEvents';
import { GUEST_RUN_PROGRESS_CHANGED_EVENT, type GuestRunSaveResult } from '../../guestRooms/runService';

const detail: PostRunRatingRequestDetail = { contentType: 'room', contentId: '0,0', roomCoordinates: { x: 0, y: 0 }, contentTitle: 'Room', version: 1,
  previousViewerRank: null, elapsedMs: 15000, deaths: 0, score: null, autoSuggestedDifficulty: 'easy' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function controller() { return { init: vi.fn(), destroy: vi.fn(), close: vi.fn(), requestRating: vi.fn(), recordGuestSave: vi.fn(), openForSequence: vi.fn().mockResolvedValue(undefined) }; }
async function settle() { for (let index = 0; index < 6; index++) await Promise.resolve(); }
function request(win: EventTarget, kind: string, data: unknown) { win.dispatchEvent(new CustomEvent(kind, { detail: data })); }

it('defers loading, retains multiple completed runs and restores guest saves before the prompts', async () => {
  const win = new EventTarget(), modal = controller(), download = deferred<typeof modal>(), load = vi.fn(() => download.promise);
  const lazy = new LazyRunRatingController(load, win as Window); lazy.init(); expect(load).not.toHaveBeenCalled();
  request(win, POST_RUN_RATING_REQUEST_EVENT, detail);
  request(win, POST_RUN_GUEST_CLAIM_REQUEST_EVENT, { ...detail, contentId: '1,0' });
  const result: GuestRunSaveResult = { clientRunId: 'run-1', attemptId: null, status: 'saved', durable: true, reason: null };
  request(win, GUEST_RUN_PROGRESS_CHANGED_EVENT, result); download.resolve(modal); await settle();
  expect(load).toHaveBeenCalledOnce(); expect(modal.init).toHaveBeenCalledOnce(); expect(modal.requestRating.mock.calls).toEqual([[detail, false], [{ ...detail, contentId: '1,0' }, true]]);
  expect(modal.recordGuestSave).toHaveBeenCalledExactlyOnceWith(result);
  expect(modal.recordGuestSave.mock.invocationCallOrder[0]).toBeLessThan(modal.requestRating.mock.invocationCallOrder[0]);
  request(win, POST_RUN_RATING_REQUEST_EVENT, detail); expect(modal.requestRating).toHaveBeenCalledTimes(2); // Loaded controller owns subsequent events.
  lazy.destroy(); expect(modal.destroy).toHaveBeenCalledOnce();
});

it('cancels pending prompts and a sequence dialog when closed during download', async () => {
  const win = new EventTarget(), modal = controller(), download = deferred<typeof modal>();
  const lazy = new LazyRunRatingController(() => download.promise, win as Window); lazy.init();
  request(win, POST_RUN_RATING_REQUEST_EVENT, detail);
  const entry = { roomId: '0,0', roomCoordinates: { x: 0, y: 0 }, roomVersion: 1 };
  const opening = lazy.openForSequence(entry); lazy.close(); download.resolve(modal); await opening;
  expect(modal.requestRating).not.toHaveBeenCalled(); expect(modal.openForSequence).not.toHaveBeenCalled();
  await lazy.openForSequence(entry); expect(modal.openForSequence).toHaveBeenCalledExactlyOnceWith(entry); lazy.destroy();
});

it('retries a failed download without losing waiting runs', async () => {
  const win = new EventTarget(), modal = controller(), load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(modal);
  const lazy = new LazyRunRatingController(load, win as Window); lazy.init(); request(win, POST_RUN_RATING_REQUEST_EVENT, detail); await settle();
  request(win, POST_RUN_GUEST_CLAIM_REQUEST_EVENT, { ...detail, contentId: '1,0' }); await settle();
  expect(load).toHaveBeenCalledTimes(2); expect(modal.requestRating).toHaveBeenCalledTimes(2); lazy.destroy();
});

it('does not initialize or reopen after the game is destroyed during download', async () => {
  const win = new EventTarget(), modal = controller(), download = deferred<typeof modal>();
  const lazy = new LazyRunRatingController(() => download.promise, win as Window); lazy.init(); request(win, POST_RUN_RATING_REQUEST_EVENT, detail);
  lazy.destroy(); download.resolve(modal); await settle(); expect(modal.init).not.toHaveBeenCalled(); expect(modal.requestRating).not.toHaveBeenCalled();
});
