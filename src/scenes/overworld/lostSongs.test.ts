import { afterEach, expect, it, vi } from 'vitest';
import { LostSongService } from '../../lostSongs/service';
import { LostSongApiError, type LostSongRepository } from '../../lostSongs/repository';
import { OverworldLostSongController, type LostSongPlayContext } from './lostSongs';

function fixture() {
  let context: LostSongPlayContext | null = { target: { roomId: '0,0', roomVersion: 1 }, practice: false, position: { x: 100, y: 100 } };
  const repository: LostSongRepository = { progress: vi.fn(), claim: vi.fn(),
    play: vi.fn(async () => ({ id: 'proof', token: 't'.repeat(64), expiresAt: new Date(Date.now() + 100000).toISOString() })),
    find: vi.fn(async () => ({ roomId: '0,0', foundAt: new Date().toISOString(), xp: 0 })),
  };
  const service = new LostSongService(repository, null, userId => ({ userId, guest: { guestUserId: 'guest', recoveryToken: 'r'.repeat(64) } }));
  const host = { getContext: () => context, showStatus: vi.fn(), onFoundChanged: vi.fn() };
  const controller = new OverworldLostSongController(host, service); controller.start();
  return { controller, service, repository, host, setContext: (next: LostSongPlayContext | null) => { context = next; } };
}
const settle = async () => { for(let i=0;i<10;i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());
it('starts proof only in published song play and makes a personal find once without fetching on re-entry', async () => {
  const f = fixture(); f.controller.update(); f.controller.collect('0,0'); f.controller.collect('0,0'); await settle();
  expect(f.repository.play).toHaveBeenCalledTimes(1); expect(f.repository.find).toHaveBeenCalledTimes(1);
  expect(f.service.snapshot().total).toBe(1); expect(f.controller.isGhosted('0,0')).toBe(true);
  f.setContext(null); f.controller.update(); f.controller.collect('0,0');
  expect(f.repository.play).toHaveBeenCalledTimes(1); f.controller.destroy();
});
it('never awards draft or owned practice pickups and clears the practice ghost when leaving', () => {
  vi.useFakeTimers();
  const f = fixture(); f.setContext({ target: { roomId: '0,0', roomVersion: 1 }, practice: true, position: { x: 1, y: 1 } });
  f.controller.collect('0,0');
  expect(f.repository.play).not.toHaveBeenCalled(); expect(f.repository.find).not.toHaveBeenCalled();
  expect(f.service.snapshot().total).toBe(0); expect(f.controller.isGhosted('0,0')).toBe(true);
  f.setContext(null); vi.advanceTimersByTime(100); f.controller.update(); expect(f.controller.isGhosted('0,0')).toBe(false);
});
it('retains an identical proof on an uncertain reply retry, but unghosts a rejected pickup and lets the player retry', async () => {
  vi.useFakeTimers();
  const f = fixture(); vi.mocked(f.repository.find).mockRejectedValueOnce(new Error('Lost response'));
  f.controller.collect('0,0'); await settle(); await vi.advanceTimersByTimeAsync(1000); await settle();
  expect(f.repository.find).toHaveBeenCalledTimes(2);
  expect(vi.mocked(f.repository.find).mock.calls[0]).toEqual(vi.mocked(f.repository.find).mock.calls[1]);
  const g = fixture(); vi.mocked(g.repository.find).mockRejectedValueOnce(new LostSongApiError(409, 'Expired'));
  g.controller.collect('0,0'); await settle();
  expect(g.controller.isGhosted('0,0')).toBe(false); expect(g.service.snapshot().total).toBe(0);
  g.controller.collect('0,0'); await settle(); expect(g.repository.play).toHaveBeenCalledTimes(2);
});
