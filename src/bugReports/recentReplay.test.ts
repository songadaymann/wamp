import { expect, it, vi } from 'vitest';
import { RecentBugReplay } from './recentReplay';
import { normalizeBugContext } from './model';
const context = normalizeBugContext({ mode: 'play', coordinates: { x: 1, y: 2 }, player: { x: 40, y: 90 } });
it('reads scene context only at the capture cadence and consumes actions only on a capture', async () => {
  let now = 0;
  const read = vi.fn(() => context), replay = new RecentBugReplay(async () => null, () => now);
  const actions = ['tiles_changed'] as const;
  const queued = [...actions];
  await replay.onFrame(read);
  for (let i = 1; i < 125; i++) { now = i; await replay.onFrame(read, queued); }
  expect(read).toHaveBeenCalledOnce(); expect(queued).toEqual(actions);
  now = 125; await replay.onFrame(read, queued);
  expect(read).toHaveBeenCalledTimes(2); expect(queued).toEqual([]);
  replay.setAllowed(false); now = 1000; await replay.onFrame(read);
  expect(read).toHaveBeenCalledTimes(2);
});
it('retains only recent bounded images, freezes an independent preview and resumes capture', async () => {
  let now = 0;
  const replay = new RecentBugReplay(async () => 'data:image/jpeg;base64,/9j/a', () => now);
  for (let i = 0; i < 200; i++) { now = i * 125; await replay.onFrame(context); }
  const evidence = replay.freeze();
  expect(evidence.samples.length).toBeLessThanOrEqual(120);
  expect(evidence.samples.at(-1)!.time).toBeLessThanOrEqual(15000);
  expect(evidence.samples[0].sequence).toBe(0);
  expect(evidence.samples[0].time).toBe(0);
  const captured = replay.debug().captures;
  now += 1000; await replay.onFrame(context); expect(replay.debug().captures).toBe(captured);
  replay.setFrozen(false); await replay.onFrame(context); expect(replay.latestImage()).toContain('/9j/');
  expect(evidence.samples.at(-1)!.time).toBeLessThanOrEqual(15000);
});
it('has one capture in flight and discards late frames after opt-out', async () => {
  let resolve!: (image: string) => void, captures = 0;
  const replay = new RecentBugReplay(() => { captures++; return new Promise(done => { resolve = done; }); });
  const pending = replay.onFrame(context); await replay.onFrame(context); expect(captures).toBe(1);
  replay.setAllowed(false); resolve('secret old frame'); await pending;
  expect(replay.freeze()).toEqual({ samples: [], screenshot: null, reason: 'disabled' });
  expect(replay.latestImage()).toBeNull();
});
it('stays within bytes, slows costly capture and supports reports with unreadable graphics', async () => {
  let now = 0;
  const replay = new RecentBugReplay(async () => { now += 60; return 'x'.repeat(8000); }, () => now);
  for (let i = 0; i < 160; i++) { now += 1000; await replay.onFrame(context); }
  expect(Number(replay.debug().bytes)).toBeLessThan(970000); expect(replay.debug().intervalMs).toBe(1000);
  const unavailable = new RecentBugReplay(async () => null, () => 0); await unavailable.onFrame(context);
  expect(unavailable.freeze()).toEqual({ samples: [], screenshot: null, reason: 'unavailable' });
});
