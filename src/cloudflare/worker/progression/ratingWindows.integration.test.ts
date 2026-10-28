import { repairRatingIndex } from '../../../../scripts/repair_rating_index';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCourseSnapshot } from '../../../courses/model';
import { publishRoomAs, workerApi, type WorkerApi } from '../core/workerApi.testSupport';
import { loadRoomDiscoveryResponse } from '../runs/difficulty';
import { refreshPlayableContentIndexForRoom } from '../playableContentIndex/store';
import { loadDiscoveryViewerRoomStates } from '../runs/discoveryViewerStates';
import { loadDiscoveryRatingVersionKeys, ratingVersionIdentity } from './discoveryRatingWindows';
import { buildRoomRatingWindow } from './ratings';
import { loadRoomRankingRecord } from '../rooms/rankingRecord';

vi.mock('../runs/verification', async original => ({ ...await original<typeof import('../runs/verification')>(),
  createCourseVerificationTrigger: vi.fn(() => null) }));
let api: WorkerApi, owner: string, player: string, second: string;
const base = '/api/courses/buckets';
const native = '/api/expanded-rooms/course%3Abuckets';
const goal = { type: 'reach_exit', exit: { roomId: '1,0', x: 600, y: 256 }, timeLimitMs: null };
const finishBody = { result: 'completed', elapsedMs: 9000, deaths: 0, collectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0 };
const rating = { qualityStars: 5, difficultyChoice: 'hard', autoSuggestedDifficulty: 'hard' };
async function clear(session: string, version: number) {
  const started = await api.call(`${native}/runs/start`, { session, body: { expandedRoomVersion: version, goal } });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  vi.setSystemTime(Date.now() + 9000);
  expect((await api.call(`/api/expanded-room-runs/${started.body.attemptId}/finish`, { session, body: finishBody })).status).toBe(204);
}
async function republish(changes: Record<string, unknown>) {
  const record = await api.call(base, { session: owner });
  expect((await api.call(`${base}/draft`, { method: 'PUT', session: owner, body: { ...record.body.draft, ...changes } })).status).toBe(200);
  const response = await api.call(`${base}/publish`, { method: 'POST', session: owner });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body;
}
const row = (sql: string) => api.sqlite.prepare(sql).get() as Record<string, any>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T18:00:00Z'));
  api = workerApi({ PLAYABLE_CONTENT_INDEX_READS: '1' });
  owner = await api.signIn('builder'); player = await api.signIn('p1'); second = await api.signIn('p2');
  await publishRoomAs(api, owner, 1, 0);
  await api.setBuilderCaps('builder', { expandedRoomCellLimit: 4 });
  const created = await api.call('/api/courses', { session: owner, body: { ...createDefaultCourseSnapshot('buckets'), title: 'Bucket test', goal,
    roomRefs: [0, 1].map(x => ({ roomId: `${x},0`, coordinates: { x, y: 0 }, roomVersion: 1, roomTitle: null })),
    startPoint: { roomId: '0,0', x: 64, y: 256 } } });
  expect(created.status).toBe(200);
  expect((await api.call(`${base}/publish`, { method: 'POST', session: owner })).status).toBe(200);
});
afterEach(() => { api.close(); vi.useRealTimers(); });

describe('rating windows across publication and compatibility APIs (F268)', () => {
  it('retains both voters across a rename, in indexed and legacy discovery, viewer state and boards; a new goal resets the window', async () => {
    await clear(player, 1);
    const queries = vi.spyOn(api.env.DB, 'prepare');
    const first = await api.call(`${native}/ratings`, { session: player, body: { expandedRoomVersion: 1, ...rating } });
    expect(first.status).toBe(200);
    // One badge pass for the owner, one for the rater, even on a first vote.
    expect(queries.mock.calls.filter(([sql]) => sql.includes("event_type = 'top10_entry'"))).toHaveLength(2);
    queries.mockRestore();
    await republish({ title: 'Renamed only', pitsAreDeadly: true, playerHearts: 3 });
    expect(row("SELECT quality_vote_count FROM playable_content_index WHERE content_id='course:buckets'").quality_vote_count).toBe(1);
    await clear(second, 2);
    const next = await api.call(`${base}/ratings`, { session: second, body: { courseVersion: 2, ...rating } });
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect(next.body.summary.quality.voteCount).toBe(2);
    expect(row("SELECT COUNT(*) AS n FROM expanded_room_ratings WHERE expanded_room_id='course:buckets' AND version_key=1").n).toBe(2);
    for (const indexed of ['1', '0']) {
      api.env.PLAYABLE_CONTENT_INDEX_READS = indexed;
      const discovery = await loadRoomDiscoveryResponse(api.env, null, 48, 'newest', false, 'p1');
      const entry = discovery.results.find(item => item.expandedRoom?.expandedRoomId === 'course:buckets');
      expect(entry, JSON.stringify(discovery)).toMatchObject({ quality: { voteCount: 2 }, viewerState: { rated: true } });
    }
    const board = await api.call('/api/leaderboards/expanded-rooms/course%3Abuckets?version=2', { session: player });
    expect(board.body).toMatchObject({ quality: { voteCount: 2 }, viewerRating: { qualityStars: 5 } });
    const retry = await api.call(`${native}/ratings`, { session: player, body: { expandedRoomVersion: 2, ...rating } });
    expect(retry.status).toBe(200);
    expect(retry.body.progressionDelta).toMatchObject({ pxp: 0, cxp: 0, trust: 0 });
    await republish({ goal: { ...goal, exit: { ...goal.exit, x: 500 } } });
    expect(row("SELECT quality_vote_count FROM playable_content_index WHERE content_id='course:buckets'").quality_vote_count).toBe(0);
    const reset = await api.call('/api/leaderboards/expanded-rooms/course%3Abuckets?version=3', { session: player });
    expect(reset.body).toMatchObject({ quality: { voteCount: 0 }, viewerRating: null });
  });

  it.each([['p3', 3], ['p1', 2]])('refreshes each distinct person once when bucket publisher is %s', async (publisher, passes) => {
    api.sqlite.prepare("UPDATE course_versions SET published_by_user_id=? WHERE course_id='buckets'").run(publisher);
    api.sqlite.prepare("UPDATE expanded_room_versions SET published_by_user_id=? WHERE expanded_room_id='course:buckets'").run(publisher);
    await clear(player, 1);
    const queries = vi.spyOn(api.env.DB, 'prepare');
    const response = await api.call(`${native}/ratings`, { session: player, body: { expandedRoomVersion: 1, ...rating } });
    expect(response.status).toBe(200);
    expect(queries.mock.calls.filter(([sql]) => sql.includes("event_type = 'top10_entry'"))).toHaveLength(passes);
    queries.mockRestore();
  });

  it('does not let an older deferred index refresh restore votes after a significant republish', async () => {
    await clear(player, 1);
    expect((await api.call(`${native}/ratings`, { session: player, body: { expandedRoomVersion: 1, ...rating } })).status).toBe(200);
    const { refreshPlayableContentIndexForExpandedRoom } = await import('../playableContentIndex/store');
    const held = api.holdNextQuery(/DELETE FROM playable_content_index_members/);
    expect(held).toBeDefined();
    const stale = refreshPlayableContentIndexForExpandedRoom(api.env, 'course:buckets');
    await held!.held;
    await republish({ goal: { ...goal, exit: { ...goal.exit, x: 500 } } });
    held!.release(); await stale;
    expect(row("SELECT version_key,quality_vote_count FROM playable_content_index WHERE content_id='course:buckets'"))
      .toMatchObject({ version_key: 2, quality_vote_count: 0 });
  });

  it('repairs old missing/stale mirrors and cached index rows without changing version pins or rewards', async () => {
    await clear(player, 1);
    expect((await api.call(`${native}/ratings`, { session: player, body: { expandedRoomVersion: 1, ...rating } })).status).toBe(200);
    await republish({ title: 'Rename' });
    api.sqlite.exec("DELETE FROM expanded_room_ratings; UPDATE playable_content_index SET quality_vote_count=0, quality_adjusted_average=NULL, consensus_difficulty=NULL, difficulty_vote_count=0");
    const before = api.sqlite.prepare('SELECT * FROM course_ratings').all();
    const events = row('SELECT COUNT(*) AS n FROM bxp_events').n;
    const pins = api.sqlite.prepare('SELECT target_key,version_key FROM playable_content_index ORDER BY target_key').all();
    expect(await repairRatingIndex(api.env)).toMatchObject({ applied: false, retainedRatingWindows: 1 });
    expect(row('SELECT COUNT(*) AS n FROM expanded_room_ratings').n).toBe(0);
    await repairRatingIndex(api.env, true);
    await repairRatingIndex(api.env, true);
    expect(row("SELECT quality_vote_count FROM playable_content_index WHERE content_id='course:buckets'").quality_vote_count).toBe(1);
    expect(api.sqlite.prepare('SELECT * FROM course_ratings').all()).toEqual(before);
    expect(api.sqlite.prepare('SELECT target_key,version_key FROM playable_content_index ORDER BY target_key').all()).toEqual(pins);
    expect(row('SELECT COUNT(*) AS n FROM bxp_events').n).toBe(events);
    expect(api.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('keeps a single canonical quality trophy on the bucket and removes old duplicate raw-version awards', async () => {
    await clear(player, 1);
    for (const user of ['p2', 'p3']) {
      api.sqlite.prepare(`INSERT INTO course_ratings(course_id,lineage_key,version_key,user_id,quality_stars,trust_weight,first_rated_at,updated_at,rewarded_at)
        VALUES ('buckets','fixture',1,?,5,4,'2026-10-04','2026-10-04','2026-10-04')`).run(user);
    }
    await republish({ title: 'Same quality window' });
    api.sqlite.exec(`INSERT INTO content_trophies(content_type,content_id,version_key,trophy_type,metric_value,weighted_vote_count,awarded_at)
      VALUES('course','buckets',1,'quality',4.8,9,'2026-10-04'),('expanded_room','course:buckets',2,'quality',4.8,9,'2026-10-04')`);
    const response = await api.call(`${native}/ratings`, { session: player, body: { expandedRoomVersion: 2, ...rating } });
    expect(response.status).toBe(200);
    expect(response.body.summary.trophy).toMatchObject({ contentType: 'expanded_room', versionKey: 1 });
    expect(api.sqlite.prepare("SELECT content_type,version_key FROM content_trophies WHERE content_id IN ('buckets','course:buckets') AND trophy_type='quality'").all())
      .toEqual([{ content_type: 'expanded_room', version_key: 1 }]);
    const discovery = await loadRoomDiscoveryResponse(api.env, null, 48, 'newest', false, 'p1');
    expect(discovery.results.find(item => item.expandedRoom?.expandedRoomId === 'course:buckets')?.trophy)
      .toMatchObject({ contentType: 'expanded_room', versionKey: 1 });
    expect(row("SELECT trophy_count FROM user_progress WHERE user_id='builder'").trophy_count).toBe(1);
  });

  it('uses the room rating window for discovery after a small edit, with compact facts or cold history', async () => {
    // A standalone room outside the Expanded Room footprint.
    await publishRoomAs(api, owner, 2, 0);
    const original = JSON.parse(row("SELECT published_json FROM rooms WHERE id='2,0'").published_json);
    const updated = { ...original, version: 2, title: 'Small edit' };
    updated.tileData.terrain[1][1] = 1;
    api.sqlite.prepare('INSERT INTO room_versions(room_id,version,snapshot_json,created_at,published_by_user_id) VALUES (?,2,?,?,?)')
      .run('2,0', JSON.stringify(updated), original.publishedAt, 'builder');
    api.sqlite.prepare("UPDATE rooms SET published_json=? WHERE id='2,0'").run(JSON.stringify(updated));
    api.sqlite.exec("INSERT INTO room_ratings(room_id,lineage_key,version_key,user_id,quality_stars,difficulty_choice,first_rated_at,updated_at) VALUES('2,0','fixture',1,'p1',5,'hard','2026-10-04','2026-10-04')");
    for (const compact of [false, true]) {
      if (compact) {
        const record = await loadRoomRankingRecord(api.env, '2,0', { x: 2, y: 0 });
        expect(buildRoomRatingWindow(record.versions, 2).versionKey).toBe(1);
      }
      api.sqlite.exec("UPDATE room_versions SET rating_version_key=NULL WHERE room_id='2,0'");
      const buckets = await loadDiscoveryRatingVersionKeys(api.env, 'room', [{ id: '2,0', version: 2 }]);
      expect(buckets.get(ratingVersionIdentity('2,0', 2))).toBe(1);
      await refreshPlayableContentIndexForRoom(api.env, '2,0');
      expect(row("SELECT quality_vote_count FROM playable_content_index WHERE content_id='2,0'").quality_vote_count).toBe(1);
      expect((await loadDiscoveryViewerRoomStates(api.env, 'p1', [{ roomId: '2,0', roomVersion: 2 }])).get('2,0:2')).toMatchObject({ rated: true, completed: false });
    }
  });
});
