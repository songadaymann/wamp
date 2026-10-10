import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloneRoomSnapshot, createRoomVersionRecord } from '../../../persistence/roomModel';
import { NOW, fixture, params, run } from '../activity/testDatabase';
import { awardRoomCreatorCompletionPoints, loadBestCompletedRunForUserAndRoomVersion } from '../runs/points';
import { awardRoomRunProgression } from './awards';
import { resolveRoomClearRewardScope, scopeClearRewardFlags } from './clearRewardScope';
import { loadBackfillSeedMetrics } from './progressRows';

type Fixture = ReturnType<typeof fixture>;

/** Publishes the next version of room 0,0: unchanged, or with its terrain rebuilt. */
function republish(f: Fixture, options: { changed?: boolean; by?: string } = {}): number {
  const by = options.by ?? 'builder';
  const snapshot = cloneRoomSnapshot(f.record.versions.at(-1)!.snapshot);
  snapshot.version += 1;
  if (options.changed) for (const row of snapshot.tileData.terrain) row.fill(1);
  f.record.versions.push(createRoomVersionRecord(snapshot, { publishedByUserId: by, publishedByDisplayName: by }));
  f.record.published = snapshot;
  f.sqlite.prepare(`INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id)
    VALUES ('0,0',?,?,'Lava Gauntlet',?,?)`).run(snapshot.version, JSON.stringify(snapshot), NOW, by);
  return snapshot.version;
}

const count = (f: Fixture, sql: string, ...values: string[]) =>
  Number((f.sqlite.prepare(sql).get(...values) as { n: number }).n);

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T12:00:00.000Z')); });
afterEach(() => vi.useRealTimers());

describe('clear rewards across republishes', () => {
  it('treats an unchanged republish as the same room and a significant change as a new one', () => {
    const f = fixture();
    const same = republish(f);
    const changed = republish(f, { changed: true });
    expect(resolveRoomClearRewardScope(f.record, same, 'p1')).toEqual({ versions: [1, 2], ownContent: false });
    expect(resolveRoomClearRewardScope(f.record, 1, 'p1').versions).toEqual([1, 2]);
    expect(resolveRoomClearRewardScope(f.record, changed, 'p1').versions).toEqual([3]);
  });

  it('marks the claimer and each version publisher as owners, and withholds their clear rewards', () => {
    const f = fixture();
    const byOther = republish(f, { by: 'p3' });
    expect(resolveRoomClearRewardScope(f.record, 1, 'builder').ownContent).toBe(true);
    expect(resolveRoomClearRewardScope(f.record, byOther, 'p3').ownContent).toBe(true);
    expect(resolveRoomClearRewardScope(f.record, 1, 'p3').ownContent).toBe(false);
    const own = resolveRoomClearRewardScope(f.record, 1, 'builder');
    expect(scopeClearRewardFlags(own, { isFirstCompletion: true, isNewPersonalBest: true }))
      .toEqual({ isFirstCompletion: false, isNewPersonalBest: false });
  });

  it('finds an earlier clear on an equivalent version, so a republish grants no second first clear', async () => {
    const f = fixture();
    run(f, 'first', 'p1', 10_000, 'passed', 1);
    const same = republish(f);
    const goal = f.record.published!.goal!;
    const scope = resolveRoomClearRewardScope(f.record, same, 'p1');
    expect(await loadBestCompletedRunForUserAndRoomVersion(f.env, 'p1', '0,0', scope.versions, goal)).toMatchObject({ attemptId: 'first' });
    // The old per-version lookup would have called this a first clear.
    expect(await loadBestCompletedRunForUserAndRoomVersion(f.env, 'p1', '0,0', same, goal)).toBeNull();
  });

  it('pays the builder once per player across an unchanged republish, and again after a real rework', async () => {
    const f = fixture();
    const paid = (version: number) => awardRoomCreatorCompletionPoints(f.env, {
      creatorUserId: 'builder', roomId: '0,0', roomVersion: version, finisherUserId: 'p1', attemptId: `a${version}`,
      rewardVersions: resolveRoomClearRewardScope(f.record, version, 'p1').versions,
    });
    const first = await paid(1);
    const same = republish(f);
    expect((await paid(same))?.id).toBe(first?.id);
    const reworked = republish(f, { changed: true });
    expect((await paid(reworked))?.id).not.toBe(first?.id);
    expect(count(f, `SELECT COUNT(*) AS n FROM point_events WHERE event_type = 'room_creator_completion'`)).toBe(2);
  });

  it('gives the room builder no rank XP on their own room, while another player still earns it', async () => {
    const f = fixture();
    await awardRoomRunProgression(f.env, { ...params(f.record, run(f, 'own', 'builder', 5_000)),
      isFirstCompletion: false, isNewPersonalBest: false, ownContent: true });
    expect(count(f, `SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'builder'
      AND event_type IN ('room_clear_first', 'top10_entry', 'top1_take', 'daily_personal_best')`)).toBe(0);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'player', 'p1', 9_000)));
    expect(count(f, `SELECT COUNT(*) AS n FROM pxp_events WHERE user_id = 'p1' AND event_type = 'top10_entry'`)).toBe(1);
  });

  it('counts each room once toward clear badges, never the player\'s own room, and not failed runs', async () => {
    const f = fixture();
    run(f, 'v1', 'p1', 10_000, 'passed', 1);
    const same = republish(f);
    run(f, 'v2', 'p1', 9_000, 'passed', same);
    run(f, 'rejected', 'p2', 9_000, 'failed', 1);
    run(f, 'own', 'builder', 9_000, 'passed', 1);
    expect((await loadBackfillSeedMetrics(f.env, 'p1')).roomClearCount).toBe(1);
    expect((await loadBackfillSeedMetrics(f.env, 'p2')).roomClearCount).toBe(0);
    expect((await loadBackfillSeedMetrics(f.env, 'builder')).roomClearCount).toBe(0);
  });
});
