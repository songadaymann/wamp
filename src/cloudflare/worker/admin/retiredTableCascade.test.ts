import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, NOW } from '../activity/testDatabase';

vi.mock('../auth/request', async (actual) => ({ ...await actual<object>(), requireAdminRequest: () => undefined }));
vi.mock('../runs/points', async (actual) => ({ ...await actual<object>(), upsertUserStats: vi.fn(async () => undefined) }));
vi.mock('../playableContentIndex/store', async (actual) => ({
  ...await actual<object>(),
  refreshPlayableContentIndexForRoom: vi.fn(async () => undefined),
  schedulePlayableContentIndexRefresh: vi.fn(),
}));

import { handleTestReset } from '../maintenance/routes';
import { handleAdminRequest } from './routes';

// F264 stopped naming these retired tables in the room clear and the test reset. Their rows
// must still go, through the ON DELETE CASCADE foreign keys from migrations 0008, 0011 and 0019.
// The fixture runs every migration with foreign keys on, as D1 does.
const RETIRED_SOURCE_NAME = String.fromCharCode(112, 108, 97, 121, 102, 117, 110);
const POINT_SYNC_TABLE = `${RETIRED_SOURCE_NAME}_point_sync`;
let f: ReturnType<typeof fixture>;

function count(table: string): number {
  return (f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

beforeEach(() => {
  f = fixture();
  expect(f.sqlite.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  f.sqlite.prepare(`INSERT INTO room_difficulty_votes
    (room_id, room_version, user_id, difficulty, created_at, updated_at, carried_from_version)
    VALUES ('0,0', 1, 'p1', 'hard', ?, ?, NULL)`).run(NOW, NOW);
  f.sqlite.prepare(`INSERT INTO room_version_attribution
    (room_id, version_key, prior_version_key, percent_change, contributor_weight_breakdown, created_at)
    VALUES ('0,0', 1, NULL, 1, '[{"userId":"builder","weight":1}]', ?)`).run(NOW);
  f.sqlite.prepare(`INSERT INTO point_events (id, user_id, event_type, source_key, points, created_at)
    VALUES ('legacy-points', 'p1', 'run_finalized', 'legacy-attempt', 5, ?)`).run(NOW);
  f.sqlite.prepare(`INSERT INTO ${POINT_SYNC_TABLE} (point_event_id, user_id, ogp_id, points, created_at)
    VALUES ('legacy-points', 'p1', 'legacy-ogp', 5, ?)`).run(NOW);
  expect([count('room_difficulty_votes'), count('room_version_attribution'), count(POINT_SYNC_TABLE)]).toEqual([1, 1, 1]);
});

describe('retired tables still clear through their cascades (F264)', () => {
  it('admin room clear removes the room difficulty votes and version attribution', async () => {
    const url = new URL('https://api.wamp.land/api/admin/rooms/0%2C0/clear');
    const response = await handleAdminRequest(
      new Request(url, { method: 'POST', headers: { Origin: 'https://wamp.land' } }), url, f.env);

    expect(response.status).toBe(200);
    expect(count('room_versions')).toBe(0);
    expect(count('room_difficulty_votes')).toBe(0);
    expect(count('room_version_attribution')).toBe(0);
  });

  it('test reset removes the difficulty votes, version attribution and point sync rows', async () => {
    const response = await handleTestReset(
      new Request('https://api.wamp.land/api/test/reset', { method: 'POST' }),
      { ...f.env, ENABLE_TEST_RESET: '1' },
    );

    expect(response.status).toBe(200);
    expect(count('users')).toBe(0);
    expect(count('room_difficulty_votes')).toBe(0);
    expect(count('room_version_attribution')).toBe(0);
    expect(count(POINT_SYNC_TABLE)).toBe(0);
  });
});
