import { expect, it } from 'vitest';
import { assertLostSongPickupProof, parseLostSongFind, parseLostSongTarget } from './validation';

it('bounds targets, trace length, types, room positions, elapsed time and plausible motion', () => {
  expect(parseLostSongTarget({ roomId: '-5,10', roomVersion: 2 })).toMatchObject({ roomId: '-5,10', roomVersion: 2 });
  expect(() => parseLostSongTarget({ roomId: '0,0', roomVersion: '1' })).toThrow();
  expect(() => parseLostSongTarget({ roomId: '0,0', roomVersion: 1, expandedRoomId: 'course:x' })).toThrow();
  const body = { sessionId: crypto.randomUUID(), token: 'a'.repeat(64), samples: [{ atMs: 0, x: 10, y: 20 }, { atMs: 1000, x: 100, y: 30 }] };
  const parsed = parseLostSongFind(body);
  expect(() => parseLostSongFind({ ...body, samples: Array(129).fill(body.samples[0]) })).toThrow();
  expect(() => parseLostSongFind({ ...body, samples: [{ atMs: 10, x: 0, y: 0 }, { atMs: 9, x: 0, y: 0 }] })).toThrow();
  expect(() => parseLostSongFind({ ...body, samples: [{ atMs: 0, x: 0, y: 0 }, { atMs: 1, x: 600, y: 0 }] })).toThrow();
  expect(() => parseLostSongFind({ ...body, samples: [{ atMs: 0, x: Infinity, y: 20 }] })).toThrow();
  const session = { song_x: 100, song_y: 30, started_at: '2026-10-09T01:00:00Z' }, now = Date.parse(session.started_at) + 1000;
  expect(() => assertLostSongPickupProof(parsed, session, now)).not.toThrow();
  expect(() => assertLostSongPickupProof(parsed, { ...session, song_x: 200 }, now)).toThrow(/does not reach/);
  expect(() => assertLostSongPickupProof({ ...parsed, samples: [{ atMs: 5000, x: 100, y: 30 }] }, session, now)).toThrow();
});
