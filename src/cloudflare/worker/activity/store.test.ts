import { afterEach, describe, expect, it } from 'vitest';
import { award, fixture, NOW, params, run, top1 } from './testDatabase';
import { loadActivity, markActivitySeen } from './store';
import { awardCourseRunProgression, awardRoomRunProgression } from '../progression/awards';
import { submitCourseRating, submitRoomRating } from '../progression/ratings';
import { createDefaultCourseGoal, createDefaultCourseRecord } from '../../../courses/model';
import type { CourseRunRecord } from '../../../courses/runModel';
import { createRoomVersionRecord } from '../../../persistence/roomModel';
const opened: ReturnType<typeof fixture>[] = [];
function setup(include = true) { const f = fixture(include); opened.push(f); return f; }
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });
describe('private builder activity on the migrated schema', () => {
  it('backfills safe legacy events and keeps future awards atomic and deduplicated', async () => {
    const f = setup(false); award(f, 'old', 'unique_completion_room', 'p1', NOW, false); f.migrate();
    award(f, 'new', 'unique_rating_room'); award(f, 'new', 'unique_rating_room');
    const result = await loadActivity(f.env.DB, 'builder', true);
    expect(result.entries.map(entry => [entry.kind, entry.actorName, entry.qualityStars])).toEqual([['rating', 'p1', 4], ['completion', 'p1', null]]);
    expect(result.unreadCount).toBe(2); expect(result.entries[0].contentPath).toBe('/r/0/0');
    expect((await loadActivity(f.env.DB, 'p2', true)).entries).toEqual([]);
  });
  it('acknowledges a snapshot without reading events that arrive later or other users', async () => {
    const f = setup(); award(f, 'a'); const first = await loadActivity(f.env.DB, 'builder', true);
    award(f, 'b'); await markActivitySeen(f.env.DB, 'builder', first.latestId);
    expect((await loadActivity(f.env.DB, 'builder', true)).unreadCount).toBe(1);
    await markActivitySeen(f.env.DB, 'builder', 9999);
    expect((await loadActivity(f.env.DB, 'builder', true)).unreadCount).toBe(1);
    await markActivitySeen(f.env.DB, 'p2', first.latestId);
    expect(f.sqlite.prepare('SELECT seen_id FROM builder_activity_preferences WHERE user_id = ?').get('p2')).toMatchObject({ seen_id: 0 });
  });
  it('paginates without overlaps and hides unpublished targets and removed awards', async () => {
    const f = setup(); for (let index = 0; index < 36; index++) award(f, String(index));
    const page = await loadActivity(f.env.DB, 'builder', true);
    const next = await loadActivity(f.env.DB, 'builder', true, page.nextBefore!);
    expect(page.entries.length).toBe(30); expect(next.entries.length).toBe(6);
    expect(new Set([...page.entries, ...next.entries].map(entry => entry.id)).size).toBe(36);
    f.sqlite.exec("DELETE FROM bxp_events WHERE id = '0'"); expect((await loadActivity(f.env.DB, 'builder', true)).unreadCount).toBe(35);
    f.sqlite.exec('UPDATE rooms SET published_json = NULL'); expect((await loadActivity(f.env.DB, 'builder', true)).entries).toEqual([]);
  });
  it('only includes approved comments and eligible players; never the builder’s own activity', async () => {
    const f = setup(); award(f, 'self', 'unique_completion_room', 'builder');
    f.sqlite.exec("UPDATE users SET email = NULL WHERE id = 'generated'; INSERT INTO playfun_user_links (user_id,ogp_id,created_at,updated_at) VALUES ('generated','generated','2026','2026')");
    award(f, 'generated', 'unique_completion_room', 'generated');
    f.sqlite.prepare(`INSERT INTO room_comments (id,room_id,room_version,room_x,room_y,body,author_user_id,author_display_name,builder_user_id,status,created_at) VALUES ('c','0,0',1,0,0,'Nice room','p1','p1','builder','pending_review',?)`).run(NOW);
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toEqual([]);
    f.sqlite.exec("UPDATE room_comments SET status = 'approved' WHERE id = 'c'"); expect((await loadActivity(f.env.DB, 'builder', true)).entries[0].kind).toBe('comment');
    f.sqlite.exec("UPDATE room_comments SET status = 'rejected' WHERE id = 'c'"); expect((await loadActivity(f.env.DB, 'builder', true)).entries).toEqual([]);
  });
  it('records genuine verified leaderboard changes, ignoring a leader’s own PB, pending and rejected runs', async () => {
    const f = setup(); run(f, 'old', 'p1', 10000);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'pb', 'p1', 9000)));
    expect((await loadActivity(f.env.DB, 'p1', true)).entries).toEqual([]);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'rejected', 'p3', 2000, 'failed')));
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'pending', 'p3', 1000, 'pending')));
    expect(f.sqlite.prepare("SELECT COUNT(*) AS count FROM bxp_events WHERE source_id LIKE '%p3'").get()).toMatchObject({ count: 0 });
    expect((await loadActivity(f.env.DB, 'p1', true)).entries).toEqual([]);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'winner', 'p2', 8000)));
    expect((await loadActivity(f.env.DB, 'p1', true)).entries).toMatchObject([{ kind: 'dethroned', actorName: 'p2' }]);
    expect((await loadActivity(f.env.DB, 'builder', true)).entries.some(entry => entry.kind === 'top1')).toBe(true);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'same-winner', 'p2', 7000)));
    expect((await loadActivity(f.env.DB, 'p1', true)).entries.length).toBe(1);
  });
  it('uses the public leaderboard family across equivalent versions before alerting a former leader', async () => {
    const f = setup(); run(f, 'old', 'p1', 5000);
    const snapshot = structuredClone(f.record.published!); snapshot.version = 2;
    f.record.published = snapshot; f.record.versions.push(createRoomVersionRecord(snapshot, { publishedByUserId: 'builder', publishedByDisplayName: 'builder' }));
    f.sqlite.prepare("INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id) VALUES ('0,0',2,?,'Lava Gauntlet',?,'builder')").run(JSON.stringify(snapshot), NOW);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'slower-new-version', 'p2', 8000, 'passed', 2)));
    expect((await loadActivity(f.env.DB, 'p1', true)).entries).toEqual([]);
    await awardRoomRunProgression(f.env, params(f.record, run(f, 'faster-new-version', 'p2', 4000, 'passed', 2)));
    expect((await loadActivity(f.env.DB, 'p1', true)).entries[0].kind).toBe('dethroned');
  });
  it('notifies the displaced builder once instead of duplicating the same top1 message', async () => {
    const f = setup(); top1(f, 'a', 'builder');
    expect((await loadActivity(f.env.DB, 'builder', true)).entries.map(entry => entry.kind)).toEqual(['dethroned']);
  });
  it('records the first real rating’s stars without replaying notifications when a vote changes', async () => {
    const f = setup(); run(f, 'clear');
    await submitRoomRating(f.env, { roomRecord: f.record, userId: 'p1', body: { roomCoordinates: { x: 0, y: 0 }, roomVersion: 1, qualityStars: 4, difficultyChoice: 'easy', autoSuggestedDifficulty: null }, now: NOW });
    await submitRoomRating(f.env, { roomRecord: f.record, userId: 'p1', body: { roomCoordinates: { x: 0, y: 0 }, roomVersion: 1, qualityStars: 5, difficultyChoice: 'easy', autoSuggestedDifficulty: null }, now: NOW });
    const ratings = (await loadActivity(f.env.DB, 'builder', true)).entries.filter(entry => entry.kind === 'rating');
    expect(ratings).toMatchObject([{ qualityStars: 4, actorName: 'p1' }]); expect(ratings.length).toBe(1);
  });
  it('links course-backed expanded clears, ratings and dethrones to the anchor and ignores own improvements', async () => {
    const f = setup(), record = createDefaultCourseRecord('fixture');
    record.ownerUserId = 'builder'; const snapshot = record.draft; snapshot.status = 'published'; snapshot.title = 'Expanded Gauntlet';
    snapshot.goal = createDefaultCourseGoal('reach_exit'); snapshot.roomRefs = [{ roomId: '0,0', coordinates: { x: 0, y: 0 }, roomVersion: 1, roomTitle: 'Lava Gauntlet' }];
    record.published = snapshot; record.versions = [{ version: 1, snapshot, createdAt: NOW, publishedByUserId: 'builder', publishedByDisplayName: 'builder' }];
    const json = JSON.stringify(snapshot);
    f.sqlite.prepare("INSERT INTO courses (id,owner_user_id,owner_display_name,draft_json,published_json,published_title,published_version,created_at,updated_at) VALUES ('fixture','builder','builder',?,?,'Expanded Gauntlet',1,?,?)").run(json, json, NOW, NOW);
    f.sqlite.prepare("INSERT INTO course_versions (course_id,version,snapshot_json,title,created_at) VALUES ('fixture',1,?,'Expanded Gauntlet',?)").run(json, NOW);
    f.sqlite.exec("INSERT INTO course_room_refs (course_id,course_version,room_order,room_id,room_x,room_y,room_version) VALUES ('fixture',1,0,'0,0',0,0,1)");
    const finish = async (id: string, user: string, time: number) => {
      const goal = snapshot.goal!;
      f.sqlite.prepare("INSERT INTO course_runs (attempt_id,course_id,course_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,elapsed_ms,verification_status) VALUES (?,'fixture',1,'reach_exit',?,?,?,?,?,'completed',?,'passed')").run(id, JSON.stringify(goal), user, user, NOW, NOW, time);
      const value: CourseRunRecord = { attemptId: id, courseId: 'fixture', courseVersion: 1, goalType: 'reach_exit', goal, userId: user, userDisplayName: user,
        startedAt: NOW, finishedAt: NOW, result: 'completed', elapsedMs: time, deaths: 0, score: 0, collectiblesCollected: 0, enemiesDefeated: 0, checkpointsReached: 0, verificationStatus: 'passed' };
      await awardCourseRunProgression(f.env, { run: value, goal, isFirstCompletion: true, isNewPersonalBest: true, creatorUserId: 'builder', courseRecord: record, completedAt: NOW });
    };
    await finish('old-course', 'p1', 10000); await finish('own-course', 'p1', 9000);
    expect((await loadActivity(f.env.DB, 'p1', true)).entries).toEqual([]);
    await finish('new-course', 'p2', 8000);
    expect((await loadActivity(f.env.DB, 'p1', true)).entries[0]).toMatchObject({ kind: 'dethroned', contentTitle: 'Expanded Gauntlet', contentPath: '/r/0/0' });
    await submitCourseRating(f.env, { courseRecord: record, userId: 'p2', body: { courseVersion: 1, qualityStars: 5, difficultyChoice: 'hard', autoSuggestedDifficulty: null }, now: NOW });
    expect((await loadActivity(f.env.DB, 'builder', true)).entries[0]).toMatchObject({ kind: 'rating', qualityStars: 5, contentTitle: 'Expanded Gauntlet' });
  });
  it('shows verified guest clears once per guest/target, excludes failed verification, and removes claimed self clears', async () => {
    const f = setup();
    for (const id of ['g1', 'g2', 'g3']) f.sqlite.prepare(`INSERT INTO guest_run_attempts
      (attempt_id,guest_user_id,recovery_token_hash,client_run_id,content_type,content_id,content_version,progress_source_type,progress_source_id,snapshot_json,verification_nonce,snapshot_hash,started_at,expires_at)
      VALUES (?,'guest-fixture','private-secret',?,'room','0,0',1,'room','0,0','{}','nonce','hash',?,?)`).run(id, id, NOW, '2026-10-18T00:00:00.000Z');
    f.sqlite.exec(`UPDATE guest_run_attempts SET result = 'completed', verification_status = 'failed', finished_at = '${NOW}' WHERE attempt_id = 'g1'`);
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toEqual([]);
    f.sqlite.exec(`UPDATE guest_run_attempts SET result = 'completed', verification_status = 'passed', finished_at = '${NOW}' WHERE attempt_id IN ('g2','g3')`);
    const response = await loadActivity(f.env.DB, 'builder', true);
    expect(response.entries).toMatchObject([{ actorName: 'Guest', kind: 'completion' }]); expect(response.entries.length).toBe(1);
    expect(JSON.stringify(response)).not.toContain('private-secret');
    f.sqlite.exec("UPDATE guest_run_attempts SET claimed_user_id = 'builder' WHERE attempt_id = 'g2'");
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toEqual([]);
  });
});
