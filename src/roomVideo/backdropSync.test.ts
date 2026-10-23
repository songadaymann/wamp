import { expect, it, vi } from 'vitest';
vi.mock('../main/clientErrorReporter', () => ({ reportClientError: vi.fn() }));
// Stands in for the room video file failing to download.
vi.mock('./frames', () => { throw new TypeError('Failed to fetch dynamically imported module'); });
import { reportClientError } from '../main/clientErrorReporter';
import { releaseRoomVideoBackdrop, syncRoomVideoBackdrop } from './backdropSync';

it('a room video download that fails is logged and reported once, not on every frame, and nothing else breaks', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const scene = { getRoomOrigin: () => ({ x: 0, y: 0 }) };
  for (let frame = 0; frame < 5; frame++) syncRoomVideoBackdrop(scene, null);
  await vi.waitFor(() => expect(reportClientError).toHaveBeenCalledOnce());
  for (let frame = 0; frame < 5; frame++) syncRoomVideoBackdrop(scene, null);
  await new Promise(done => setTimeout(done, 0));
  expect(logged).toHaveBeenCalledOnce(); expect(reportClientError).toHaveBeenCalledOnce();
  expect(vi.mocked(reportClientError).mock.lastCall![0].message).toMatch(/^Room video backdrops failed to load: /);
  expect(() => releaseRoomVideoBackdrop(scene)).not.toThrow();
  logged.mockRestore();
});
