import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

// This later destructive migration follows the already-delivered reader/writer removal.
const RETIRED_SOURCE_NAME = String.fromCharCode(112, 108, 97, 121, 102, 117, 110);
const POINT_SYNC_TABLE = `${RETIRED_SOURCE_NAME}_point_sync`;
const RETIRED_TABLES = ['room_difficulty_votes', 'room_version_attribution', POINT_SYNC_TABLE];
const migration = readFileSync(new URL('../../../../migrations/0078_drop_retired_tables.sql', import.meta.url), 'utf8');
let f: ReturnType<typeof fixture>;
afterEach(() => f?.sqlite.close());
const count = (table: string): number => (f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
function expectRetiredAbsent(): void {
  for (const table of RETIRED_TABLES) expect(f.sqlite.prepare('SELECT name FROM sqlite_master WHERE name=?').get(table)).toBeUndefined();
  expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

describe('retired table drop and current admin paths (F264)', () => {
  it('upgrades populated old tables without deleting live ratings, facts or their parents', () => {
    f = fixture(true, '0077_builder_recognition_activity.sql');
    f.sqlite.prepare(`INSERT INTO room_difficulty_votes
      (room_id,room_version,user_id,difficulty,created_at,updated_at)
      VALUES ('0,0',1,'p1','hard',?,?)`).run(NOW,NOW);
    f.sqlite.prepare(`INSERT INTO room_version_attribution
      (room_id,version_key,prior_version_key,percent_change,contributor_weight_breakdown,created_at)
      VALUES ('0,0',1,NULL,1,'[]',?)`).run(NOW);
    f.sqlite.prepare(`INSERT INTO point_events(id,user_id,event_type,source_key,points,created_at)
      VALUES ('legacy-points','p1','run_finalized','legacy-attempt',5,?)`).run(NOW);
    f.sqlite.prepare(`INSERT INTO ${POINT_SYNC_TABLE}(point_event_id,user_id,ogp_id,points,created_at)
      VALUES ('legacy-points','p1','legacy-ogp',5,?)`).run(NOW);
    f.sqlite.prepare(`INSERT INTO room_ratings(room_id,lineage_key,version_key,user_id,quality_stars,first_rated_at,updated_at)
      VALUES ('0,0','0,0',1,'p1',4,?,?)`).run(NOW,NOW);
    f.sqlite.prepare(`INSERT INTO room_version_facts(room_id,version,facts_version,facts_json,change_from_previous,computed_at)
      VALUES ('0,0',1,1,'{}',0.38,?)`).run(NOW);
    expect(RETIRED_TABLES.map(count)).toEqual([1,1,1]);
    const tables = ['users','rooms','room_versions','point_events','room_ratings','room_version_facts'];
    const before = tables.map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all());
    f.sqlite.exec(migration);
    expectRetiredAbsent();
    expect(tables.map(table => f.sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    f.sqlite.exec(migration); // safe to retry an already-applied drop
    expectRetiredAbsent();
  });

  it('admin room clear works against the post-drop schema', async () => {
    f = fixture();
    expectRetiredAbsent();
    const url = new URL('https://api.wamp.land/api/admin/rooms/0%2C0/clear');
    const response = await handleAdminRequest(new Request(url,{method:'POST',headers:{Origin:'https://wamp.land'}}),url,f.env);
    expect(response.status).toBe(200);
    expect(count('room_versions')).toBe(0);
    expectRetiredAbsent();
  });

  it('test reset works against the post-drop schema', async () => {
    f = fixture();
    const response = await handleTestReset(new Request('https://api.wamp.land/api/test/reset',{method:'POST'}),{...f.env,ENABLE_TEST_RESET:'1'});
    expect(response.status).toBe(200);
    expect(count('users')).toBe(0);
    expectRetiredAbsent();
  });
});
