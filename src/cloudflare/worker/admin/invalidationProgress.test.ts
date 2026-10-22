import { afterEach, describe, expect, it } from 'vitest';
import type { SuspiciousRunCase } from '../../../admin/model';
import { fixture, guestClear, NOW, params, run } from '../activity/testDatabase';
import { awardRoomRunProgression } from '../progression/awards';
import { submitRoomRating } from '../progression/ratings';
import { loadOrBackfillUserProgress } from '../progression/progressRows';
import { finishProgressRollback, planProgressRollback, prepareProgressRollbackStatements } from './invalidationProgress';

const opened: ReturnType<typeof fixture>[] = [];
// Progress rows are created first: creating one later seeds XP from clears that already exist.
async function setup() {
  const f = fixture(); opened.push(f);
  for (const user of ['builder', 'p1', 'p2']) await loadOrBackfillUserProgress(f.env, user);
  return f;
}
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

const runCase = (attemptId: string, userId = 'p1'): SuspiciousRunCase => ({
  kind: 'room', attemptId, sourceId: '0,0', version: 1, userId, finishedAt: NOW,
} as SuspiciousRunCase);

async function invalidate(f: ReturnType<typeof fixture>, runs: SuspiciousRunCase[]) {
  const rollback = await planProgressRollback(f.env, runs);
  f.sqlite.prepare('DELETE FROM room_runs WHERE attempt_id IN (SELECT value FROM json_each(?))').run(JSON.stringify(runs.map((entry) => entry.attemptId)));
  await f.env.DB.batch(prepareProgressRollbackStatements(f.env, rollback, NOW));
  await finishProgressRollback(f.env, rollback);
  return rollback;
}

const progress = (f: ReturnType<typeof fixture>, userId: string) => f.sqlite.prepare(
  'SELECT total_pxp, total_bxp, total_cxp, hidden_trust_score FROM user_progress WHERE user_id = ?').get(userId) as
  { total_pxp: number; total_bxp: number; total_cxp: number; hidden_trust_score: number };
const events = (f: ReturnType<typeof fixture>, table: string, userId: string) =>
  (f.sqlite.prepare(`SELECT event_type FROM ${table} WHERE user_id = ? ORDER BY event_type`).all(userId) as Array<{ event_type: string }>)
    .map((row) => row.event_type);

describe('cheat cleanup takes back what the removed runs earned (F205)', () => {
  it('removes the clear, rank, trust, rating and builder rewards when no other clear remains', async () => {
    const f = await setup();
    const baseline = progress(f, 'p1');
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'cheat', 'p1', 1000)));
    await submitRoomRating(f.env, { roomRecord: f.record, userId: 'p1', body: { roomCoordinates: { x: 0, y: 0 }, roomVersion: 1,
      qualityStars: 5, difficultyChoice: 'easy', autoSuggestedDifficulty: null }, now: NOW });
    expect(events(f, 'pxp_events', 'p1')).toEqual(expect.arrayContaining(['room_clear_first', 'top1_take', 'room_rating_submit']));
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM badge_awards WHERE user_id = 'p1' AND badge_id = 'player_first_clear'").get()).toEqual({ n: 1 });
    const builderBefore = progress(f, 'builder');

    const rollback = await invalidate(f, [runCase('cheat')]);

    expect(events(f, 'pxp_events', 'p1')).toEqual(['weekly_play']);
    expect(events(f, 'trust_events', 'p1')).toEqual([]);
    expect(events(f, 'cxp_events', 'p1')).toEqual(['weekly_curation']);
    expect(events(f, 'bxp_events', 'builder')).toEqual([]);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM room_ratings').get()).toEqual({ n: 0 });
    expect(rollback.ratings).toEqual([{ contentId: '0,0', versionKey: 1, userId: 'p1' }]);
    // Back to where p1 started, plus only the weekly play and weekly curation rewards that stay.
    const kept = (table: string) => (f.sqlite.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM ${table} WHERE user_id = 'p1'`).get() as { n: number }).n;
    expect(progress(f, 'p1')).toMatchObject({
      total_pxp: baseline.total_pxp + kept('pxp_events'), total_cxp: baseline.total_cxp + kept('cxp_events'),
      hidden_trust_score: baseline.hidden_trust_score,
    });
    expect(progress(f, 'builder').total_bxp).toBeLessThan(builderBefore.total_bxp);
    expect(f.sqlite.prepare("SELECT badge_id FROM badge_awards WHERE user_id = 'p1' AND badge_id IN ('player_first_clear', 'player_top1_finisher', 'curator_first_rating')").all()).toEqual([]);
  });

  it('keeps rewards another accepted clear still earns and only takes the removed run\'s rank rewards', async () => {
    const f = await setup();
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'rival', 'p2', 5000)));
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'legit', 'p1', 9000)));
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'cheat', 'p1', 1000)));
    const rollback = await invalidate(f, [runCase('cheat')]);
    expect(rollback.events.map((event) => event.eventType).sort()).toEqual(['top10_improve', 'top1_take']);
    expect(events(f, 'pxp_events', 'p1')).toEqual(expect.arrayContaining(['room_clear_first', 'top10_entry']));
    expect(events(f, 'pxp_events', 'p1')).not.toContain('top1_take');
    expect(events(f, 'trust_events', 'p1')).toEqual(['room_clear_completed']);
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM bxp_events WHERE user_id = 'builder' AND source_id LIKE '%:p1'").get()).toEqual({ n: 1 });
  });

  it('does not count a rejected run as a remaining clear', async () => {
    const f = await setup();
    run(f, 'rejected', 'p1', 9000, 'failed');
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'cheat', 'p1', 1000)));
    const rollback = await invalidate(f, [runCase('cheat')]);
    expect(rollback.events.some((event) => event.eventType === 'room_clear_first')).toBe(true);
  });

  it('keeps the first-clear reward a claimed guest clear earned', async () => {
    const f = await setup();
    guestClear(f, 'guest-run', 'guest-p1');
    f.sqlite.exec("UPDATE guest_run_attempts SET claimed_user_id = 'p1' WHERE attempt_id = 'guest-run'");
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'cheat', 'p1', 1000)));
    const rollback = await planProgressRollback(f.env, [runCase('cheat')]);
    expect(rollback.events.some((event) => event.eventType === 'room_clear_first')).toBe(false);
  });

  it('subtracts a reward once even when two invalidations were planned at the same time', async () => {
    const f = await setup();
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'cheat', 'p1', 1000)));
    const first = await planProgressRollback(f.env, [runCase('cheat')]);
    const second = await planProgressRollback(f.env, [runCase('cheat')]);
    await f.env.DB.batch(prepareProgressRollbackStatements(f.env, first, NOW));
    const afterFirst = progress(f, 'p1');
    await f.env.DB.batch(prepareProgressRollbackStatements(f.env, second, NOW));
    expect(progress(f, 'p1')).toEqual(afterFirst);
  });

  it('only takes back badges this cleanup took below their threshold', async () => {
    const f = await setup();
    f.sqlite.prepare("INSERT INTO badge_awards (user_id, badge_id, source_type, source_id, awarded_at) VALUES ('builder', 'builder_first_trophy_room', 'trophy_count', '1', ?)").run(NOW);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'cheat', 'p1', 1000)));
    await invalidate(f, [runCase('cheat')]);
    // The builder's trophy badge had already lapsed for other reasons; this cleanup leaves it alone.
    expect(f.sqlite.prepare("SELECT badge_id FROM badge_awards WHERE user_id = 'builder'").all()).toContainEqual({ badge_id: 'builder_first_trophy_room' });
    expect(f.sqlite.prepare("SELECT badge_id FROM badge_awards WHERE user_id = 'p1' AND badge_id = 'player_first_clear'").all()).toEqual([]);
  });

  it('matches Expanded Room runs to the legacy course id their rewards use', async () => {
    const f = await setup();
    f.sqlite.prepare(`INSERT INTO expanded_rooms (id, legacy_course_id, owner_user_id, owner_display_name, anchor_room_id, anchor_x, anchor_y, draft_json, created_at, updated_at)
      VALUES ('course:c1', 'c1', 'builder', 'builder', '0,0', 0, 0, '{}', ?, ?)`).run(NOW, NOW);
    f.sqlite.prepare(`INSERT INTO pxp_events (id, user_id, event_type, source_type, source_id, dedupe_key, amount, created_at)
      VALUES ('e1', 'p1', 'course_clear_first', 'course', 'c1:1', 'pxp:course_clear_first:p1:c1:1', 30, ?)`).run(NOW);
    const rollback = await planProgressRollback(f.env, [{ ...runCase('expanded-cheat'), kind: 'course', sourceId: 'course:c1' }]);
    expect(rollback.events.map((event) => event.id)).toContain('e1');
  });
});
