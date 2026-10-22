import { afterEach, describe, expect, it } from 'vitest';
import type { SuspiciousRunCase } from '../../../admin/model';
import { fixture, NOW, run } from '../activity/testDatabase';
import { loadInsightSummaries } from '../insights/store';
import { recordDiscoveryRunPlayer } from '../playableContentIndex/runMetrics';
import { planStatsRollback, prepareStatsRollbackStatements } from './invalidationStats';
import { handleAdminSuspiciousInvalidate } from './suspiciousInvalidation';

const opened: ReturnType<typeof fixture>[] = [];
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });

function setup() {
  const f = fixture(); opened.push(f);
  f.env.ADMIN_API_KEY = 'fixture-admin-key';
  return f;
}

/** A finished room run as the finalize route records it, including its discovery sample. */
async function finish(f: ReturnType<typeof fixture>, id: string, user: string, result: 'completed' | 'failed', elapsedMs: number, finishedAt = NOW) {
  if (result === 'completed') run(f, id, user, elapsedMs);
  else f.sqlite.prepare(`INSERT INTO room_runs (attempt_id,room_id,room_x,room_y,room_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,elapsed_ms,deaths)
    VALUES (?,'0,0',0,0,1,'reach_exit','{"type":"reach_exit"}',?,?,?,?,'failed',?,3)`).run(id, user, user, finishedAt, finishedAt, elapsedMs);
  await recordDiscoveryRunPlayer(f.env, 'room:0,0', 1, user, { result, finishedAt, elapsedMs, deaths: result === 'failed' ? 3 : 0 });
}

async function invalidate(f: ReturnType<typeof fixture>, userId: string, roomRunAttemptIds: string[]) {
  const request = new Request(`https://api.wamp.land/api/admin/suspicious/users/${userId}/invalidate`, {
    method: 'POST', headers: { 'x-admin-key': 'fixture-admin-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomRunAttemptIds, courseRunAttemptIds: [], pointEventIds: [], reason: 'Impossible times', operatorLabel: 'fixture' }),
  });
  expect((await handleAdminSuspiciousInvalidate(request, f.env, userId)).status).toBe(200);
}

const discoveryRow = (f: ReturnType<typeof fixture>, userId: string) => f.sqlite.prepare(
  "SELECT difficulty_choice, sampled_at, last_played_at FROM discovery_run_players WHERE target_key = 'room:0,0' AND version_key = 1 AND user_id = ?",
).get(userId);
const insights = async (f: ReturnType<typeof fixture>) =>
  (await loadInsightSummaries(f.env, [{ contentType: 'room', contentId: '0,0', version: 1 }])).get('room:0,0:1');

describe('invalidated runs leave the statistics copies too (F427)', () => {
  it('drops the removed clears from builder insights and rebuilds the discovery sample from what remains', async () => {
    const f = setup();
    await finish(f, 'rival', 'p2', 'completed', 9000);
    await finish(f, 'legit-fail', 'p1', 'failed', 4000, '2026-10-03T12:00:00.000Z');
    await finish(f, 'flagged', 'p1', 'completed', 800);
    expect(await insights(f)).toMatchObject({ attempts: 3, completions: 2, medianClearMs: 4900 });
    expect(discoveryRow(f, 'p1')).toMatchObject({ difficulty_choice: 'easy', sampled_at: NOW });
    const rival = discoveryRow(f, 'p2');

    await invalidate(f, 'p1', ['flagged']);

    expect(await insights(f)).toMatchObject({ attempts: 2, completions: 1, failures: 1, medianClearMs: 9000 });
    expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM room_insight_attempts WHERE attempt_key = 'room:flagged'").get()).toEqual({ n: 0 });
    // The failed run keeps p1 counted as a recent player, but no longer as a clear (Room of the Day, difficulty).
    expect(discoveryRow(f, 'p1')).toEqual({ difficulty_choice: null, sampled_at: null, last_played_at: '2026-10-03T12:00:00.000Z' });
    expect(discoveryRow(f, 'p2')).toEqual(rival);
  });

  it('removes the discovery sample of a player with no accepted run left', async () => {
    const f = setup();
    await finish(f, 'flagged-1', 'p1', 'completed', 800);
    await finish(f, 'flagged-2', 'p1', 'completed', 700);
    await invalidate(f, 'p1', ['flagged-1', 'flagged-2']);
    expect(discoveryRow(f, 'p1')).toBeUndefined();
    expect(await insights(f)).toBeUndefined();
  });

  it('covers course runs and their Expanded Room copies', async () => {
    const f = setup();
    const course = { kind: 'course', attemptId: 'course-flagged', sourceId: 'course-1', version: 2, userId: 'p1' } as SuspiciousRunCase;
    const plan = await planStatsRollback(f.env, [], [course]);
    expect(plan).toEqual({
      insightAttemptKeys: ['course:course-flagged', 'expanded:course-flagged'],
      removedAttemptIds: ['course-flagged'],
      players: [{ source: 'course', contentId: 'course-1', version: 2, userId: 'p1' }],
    });
    await f.env.DB.batch(prepareStatsRollbackStatements(f.env, {
      ...plan, players: [...plan.players, { source: 'expanded_room', contentId: 'expanded-1', version: 1, userId: 'p1' }],
    }));
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM discovery_run_players').get()).toEqual({ n: 0 });
  });
});
