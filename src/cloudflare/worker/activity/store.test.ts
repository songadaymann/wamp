import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { award, fixture, guestClear, NOW, params, run, top1 } from './testDatabase';
import { loadActivity, loadAllActivity, loadGuestActivity, markActivitySeen } from './store';
import { activityGuestName } from '../../../activity/guestName';
import { awardCourseRunProgression, awardRoomRunProgression } from '../progression/awards';
import { submitCourseRating, submitRoomRating } from '../progression/ratings';
import { createDefaultCourseGoal, createDefaultCourseRecord } from '../../../courses/model';
import type { CourseRunRecord } from '../../../courses/runModel';
import { createRoomVersionRecord } from '../../../persistence/roomModel';
const opened: ReturnType<typeof fixture>[] = [];
function setup(include = true) { const f = fixture(include); opened.push(f); return f; }
afterEach(() => { for (const f of opened.splice(0)) f.sqlite.close(); });
describe('private builder activity on the migrated schema', () => {
  it('resolves a public guest reference to only that guest’s activity across builders', async () => {
    const f = setup();
    f.sqlite.exec("INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,claimer_user_id) VALUES ('1,0',1,0,'{}','{}','Moon Bounce','p3')");
    guestClear(f, 'g1'); guestClear(f, 'g2', 'guest-fixture', '1,0'); guestClear(f, 'other', 'guest-other', '1,0');
    const own = await loadActivity(f.env.DB, 'builder', true, undefined, 'rooms');
    const ref = own.entries[0].guestActivityRef!;
    const feed = await loadGuestActivity(f.env.DB, ref);
    expect(feed.guestName).toBe(own.entries[0].actorName);
    expect(feed.entries.map(entry => entry.contentPath)).toEqual(['/r/1/0', '/r/0/0']);
    expect(feed.entries.every(entry => entry.actorName === feed.guestName && !entry.unread)).toBe(true);
    expect(JSON.stringify(feed)).not.toContain('guest-fixture'); expect(JSON.stringify(feed)).not.toContain('private-fixture-token');
    expect(feed).not.toHaveProperty('preferences');
    f.sqlite.exec("UPDATE rooms SET published_json=NULL WHERE id='1,0'");
    expect((await loadGuestActivity(f.env.DB, ref)).entries).toHaveLength(1);
    f.sqlite.exec("UPDATE rooms SET published_json=NULL WHERE id='0,0'");
    await expect(loadGuestActivity(f.env.DB, ref)).rejects.toMatchObject({ status: 404 });
  });
  it('paginates one guest across many rooms and rejects missing or registered-player references', async () => {
    const f = setup();
    for (let i = 0; i < 36; i++) {
      const id = `${i + 10},0`;
      f.sqlite.prepare("INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,claimer_user_id) VALUES (?,?,0,'{}','{}','Room','builder')").run(id, i + 10);
      guestClear(f, `guest-${i}`, 'guest-fixture', id);
    }
    const publicFeed = await loadAllActivity(f.env.DB);
    const ref = publicFeed.entries[0].guestActivityRef!;
    const first = await loadGuestActivity(f.env.DB, ref); const next = await loadGuestActivity(f.env.DB, ref, first.nextBefore!);
    expect(first.entries).toHaveLength(30); expect(next.entries).toHaveLength(6); expect(next.nextBefore).toBeNull();
    expect(new Set([...first.entries,...next.entries].map(entry => entry.id)).size).toBe(36);
    award(f, 'registered'); const player = (await loadAllActivity(f.env.DB)).entries[0];
    expect(player.guestActivityRef).toBeUndefined();
    await expect(loadGuestActivity(f.env.DB, player.id)).rejects.toMatchObject({ status: 404 });
    await expect(loadGuestActivity(f.env.DB, 999999)).rejects.toMatchObject({ status: 404 });
  });
  it('scopes My activity and its unread badge to rooms the recipient created', async () => {
    const f = setup(); award(f, 'clear'); top1(f, 'rank');
    expect((await loadActivity(f.env.DB, 'p1', true)).entries).toMatchObject([{ kind: 'dethroned' }]);
    const unrelated = await loadActivity(f.env.DB, 'p1', true, undefined, 'rooms');
    expect(unrelated.entries).toEqual([]); expect(unrelated.unreadCount).toBe(0); expect(unrelated.latestId).toBe(0);
    const own = await loadActivity(f.env.DB, 'builder', true, undefined, 'rooms');
    expect(own.entries.map(entry => entry.kind)).toEqual(['top1', 'completion']);
    expect(own.unreadCount).toBe(2);
    // A later claimant doesn't change who authored the published version.
    f.sqlite.exec("UPDATE rooms SET claimer_user_id='p3'");
    expect((await loadActivity(f.env.DB, 'builder', true, undefined, 'rooms')).entries).toHaveLength(2);
  });
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
    expect((await loadAllActivity(f.env.DB)).entries.map(entry => entry.kind)).toEqual(['top1']);
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
    expect(response.entries).toMatchObject([{ actorName: await activityGuestName('guest-fixture'), kind: 'completion' }]); expect(response.entries.length).toBe(1);
    expect(JSON.stringify(response)).not.toContain('private-secret');
    f.sqlite.exec("UPDATE guest_run_attempts SET claimed_user_id = 'builder' WHERE attempt_id = 'g2'");
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toEqual([]);
  });
  it('names the same guest consistently across rooms, feeds and historical events', async () => {
    const f = setup();
    f.sqlite.exec(`INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,claimer_user_id)
      VALUES ('1,0',1,0,'{}','{}','Second Room','p3')`);
    for (const [id, room] of [['g1', '0,0'], ['g2', '1,0'], ['g3', '1,0']]) {
      f.sqlite.prepare(`INSERT INTO guest_run_attempts
        (attempt_id,guest_user_id,recovery_token_hash,client_run_id,content_type,content_id,content_version,progress_source_type,progress_source_id,snapshot_json,verification_nonce,snapshot_hash,started_at,expires_at)
        VALUES (?,?, 'private-secret',?,'room',?,1,'room',?, '{}','nonce','hash',?,?)`)
        .run(id, id === 'g3' ? 'guest-other' : 'guest-fixture', id, room, room, NOW, '2026-10-18T00:00:00.000Z');
    }
    f.sqlite.exec(`UPDATE guest_run_attempts SET result='completed',verification_status='passed',finished_at='${NOW}'`);
    const mine = await loadActivity(f.env.DB, 'builder', true);
    const other = await loadActivity(f.env.DB, 'p3', true);
    const all = await loadAllActivity(f.env.DB);
    expect(other.entries[1].actorName).toBe(mine.entries[0].actorName);
    expect(other.entries[0].actorName).not.toBe(mine.entries[0].actorName);
    expect(all.entries.map(entry => entry.actorName)).toEqual([other.entries[0].actorName, mine.entries[0].actorName, mine.entries[0].actorName]);
    expect(mine.entries[0].actorName).toMatch(/^Guest [A-Za-z]+ [A-Za-z]+ [A-F0-9]{8}$/);
    expect(JSON.stringify(all)).not.toContain('guest-fixture');
    expect(JSON.stringify(all)).not.toContain('private-secret');
  });
  it('lists other builders’ events without duplicate leaderboard changes or private inbox state', async () => {
    const f = setup(); award(f, 'completion'); top1(f, 'rank');
    const global = await loadAllActivity(f.env.DB);
    expect(global.entries.map(entry => entry.kind)).toEqual(['top1', 'completion']);
    expect(global.entries.every(entry => !entry.unread)).toBe(true);
    expect(global).not.toHaveProperty('preferences'); expect(global).not.toHaveProperty('unreadCount');
    expect(JSON.stringify(global)).not.toContain('@example.test');
    expect(global.entries.some(entry => entry.kind === 'dethroned')).toBe(false);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM builder_activity_preferences').get()).toMatchObject({ n: 0 });
    await markActivitySeen(f.env.DB, 'p1', (await loadActivity(f.env.DB, 'p1', true)).latestId);
    expect((await loadActivity(f.env.DB, 'builder', true)).unreadCount).toBe(2);
  });
  it('pages the public feed without overlaps and drops unpublished, moderated and revoked events', async () => {
    const f = setup(); for (let i=0;i<36;i++) award(f, String(i));
    const page = await loadAllActivity(f.env.DB); const next = await loadAllActivity(f.env.DB, page.nextBefore!);
    expect(page.entries.length).toBe(30); expect(next.entries.length).toBe(6);
    expect(new Set([...page.entries,...next.entries].map(entry => entry.id)).size).toBe(36);
    f.sqlite.exec("DELETE FROM bxp_events WHERE id='0'");
    expect((await loadAllActivity(f.env.DB, page.nextBefore!)).entries.length).toBe(5);
    f.sqlite.prepare(`INSERT INTO room_comments (id,room_id,room_version,room_x,room_y,body,author_user_id,author_display_name,builder_user_id,status,created_at)
      VALUES ('c','0,0',1,0,0,'Nice','p1','p1','builder','approved',?)`).run(NOW);
    expect((await loadAllActivity(f.env.DB)).entries[0].kind).toBe('comment');
    f.sqlite.exec("UPDATE room_comments SET status='rejected' WHERE id='c'");
    expect((await loadAllActivity(f.env.DB)).entries.some(entry => entry.kind==='comment')).toBe(false);
    f.sqlite.exec('UPDATE rooms SET published_json=NULL');
    expect((await loadAllActivity(f.env.DB)).entries).toEqual([]);
  });
  it('tells only the claimer when another builder publishes over their room, once per editor and day', async () => {
    const f = setup();
    const version = (n: number, by: string, at = NOW) => f.sqlite.prepare(`INSERT INTO room_versions
      (room_id,version,snapshot_json,title,created_at,published_by_user_id) VALUES ('0,0',?,'{}','Lava Gauntlet',?,?)`).run(n, at, by);
    version(2, 'builder'); version(3, 'p1'); version(4, 'p1'); version(5, 'p2');
    version(6, 'p1', '2026-10-05T09:00:00.000Z');
    const inbox = await loadActivity(f.env.DB, 'builder', true);
    expect(inbox.entries.map(entry => [entry.kind, entry.actorName, entry.contentVersion])).toEqual([
      ['edited', 'p1', 6], ['edited', 'p2', 5], ['edited', 'p1', 3],
    ]);
    expect(inbox.entries[0].contentPath).toBe('/r/0/0');
    expect(inbox.unreadCount).toBe(3);
    expect((await loadActivity(f.env.DB, 'builder', true, undefined, 'rooms')).entries).toEqual([]);
    expect((await loadActivity(f.env.DB, 'p1', true)).entries).toEqual([]);
    expect((await loadAllActivity(f.env.DB)).entries.some(entry => entry.kind === 'edited')).toBe(false);
    f.sqlite.exec("DELETE FROM room_versions WHERE version = 5");
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toHaveLength(2);
    f.sqlite.prepare(`INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id,reverted_from_version)
      VALUES ('0,0',7,'{}','Lava Gauntlet',?,'p3',1)`).run(NOW);
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toHaveLength(2);
    f.sqlite.exec("UPDATE rooms SET minted_token_id = '9'");
    version(8, 'p3');
    expect((await loadActivity(f.env.DB, 'builder', true)).entries).toHaveLength(2);
  });

  it('keeps the activity id sequence across the 0069 rebuild', async () => {
    const f = setup(false);
    for (const file of ['0055_builder_activity.sql', '0057_daily_rooms.sql', '0066_guest_activity_index.sql']) {
      f.sqlite.exec(readFileSync(new URL(`../../../../migrations/${file}`, import.meta.url), 'utf8'));
    }
    award(f, 'kept'); award(f, 'removed', 'unique_rating_room');
    f.sqlite.exec("DELETE FROM builder_activity WHERE dedupe_key = 'bxp:removed'");
    const highest = (f.sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'builder_activity'").get() as { seq: number }).seq;
    f.sqlite.exec(readFileSync(new URL('../../../../migrations/0069_room_edit_activity.sql', import.meta.url), 'utf8'));
    award(f, 'next', 'unique_completion_room', 'p2');
    const rows = f.sqlite.prepare('SELECT id, dedupe_key FROM builder_activity ORDER BY id').all() as Array<{ id: number; dedupe_key: string }>;
    expect(rows.map(row => row.dedupe_key)).toEqual(['bxp:kept', 'bxp:next']);
    expect(rows[1].id).toBeGreaterThan(highest);
  });
});
