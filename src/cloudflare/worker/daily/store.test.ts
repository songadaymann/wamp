import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture, run, params, NOW } from '../activity/testDatabase';
import { refreshPlayableContentIndexForRoom, refreshPlayableContentIndexForExpandedRoom } from '../playableContentIndex/store';
import { createDefaultCourseSnapshot, createDefaultCourseGoal } from '../../../courses/model';
import { awardRoomRunProgression } from '../progression/awards';
import { ensureDailyPick, loadDailyResponse, dailyWindow, overrideDailyPick, awardDailyClear } from './store';
import { handleAdminDaily, handleDaily } from './routes';
import { saveActivityPreferences } from '../activity/store';
import { sendDailyFeatureEmail } from './emails';
import { handleActivityUnsubscribe } from '../activity/unsubscribe';
import { claimGuestRuns } from '../guestRuns/claims';

let f: ReturnType<typeof fixture>;
beforeEach(async()=>{ vi.useFakeTimers();vi.setSystemTime(new Date(NOW)); f=fixture();
  f.sqlite.exec("UPDATE rooms SET last_published_by_user_id='builder',last_published_by_display_name='builder' WHERE id='0,0'");
  await refreshPlayableContentIndexForRoom(f.env,'0,0'); });
afterEach(()=>{f.sqlite.close();vi.restoreAllMocks();vi.useRealTimers();});
async function pick() {run(f,'seed');return ensureDailyPick(f.env,NOW);}
function guest(id: string, date=NOW, version=1, status='passed') {
  f.sqlite.prepare(`INSERT INTO guest_run_attempts
    (attempt_id,guest_user_id,recovery_token_hash,client_run_id,content_type,content_id,content_version,progress_source_type,progress_source_id,
      verification_nonce,snapshot_hash,started_at,finished_at,expires_at,result,verification_status,metrics_json)
    VALUES (?,'guest','secret',?,'room','0,0',?,'room','0,0','nonce','hash',?,?,?,'completed',?,'{"elapsedMs":1000,"deaths":0}')`)
    .run(id,id,version,date,date,'2026-10-18T00:00:00.000Z',status);
}
describe('daily challenge against the complete migrated schema',()=>{
  it('starts a new day at UTC midnight across local offsets',()=>{
    expect(dailyWindow('2026-10-04T20:00:00-04:00')).toEqual({date:'2026-10-05',start:'2026-10-05T00:00:00.000Z',end:'2026-10-06T00:00:00.000Z'});
    expect(()=>dailyWindow('bad')).toThrow('Invalid daily clock');
  });
  it('does not pick a goal until a real accepted clear exists, including guest verification',async()=>{
    expect(await ensureDailyPick(f.env,NOW)).toBeNull();run(f,'bad','p1',1000,'failed');
    expect(await ensureDailyPick(f.env,NOW)).toBeNull();guest('guest-bad',NOW,1,'failed');
    expect(await ensureDailyPick(f.env,NOW)).toBeNull();guest('guest-good');
    expect(await ensureDailyPick(f.env,NOW)).toMatchObject({target_key:'room:0,0',version:1});
  });
  it('shares one winning pick on simultaneous first visits and features its exact version',async()=>{
    run(f,'seed');const rows=await Promise.all(Array.from({length:8},()=>ensureDailyPick(f.env,NOW)));
    expect(new Set(rows.map(row=>row?.target_key)).size).toBe(1);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM daily_rooms').get()).toMatchObject({count:1});
    expect(f.sqlite.prepare('SELECT * FROM featured_rooms').get()).toMatchObject({room_id:'0,0',room_version:1,target_key:'room:0,0',target_version:1});
    expect(f.sqlite.prepare('SELECT featured_at FROM playable_content_index').get()).toMatchObject({featured_at:NOW});
  });
  it('excludes generated-only builders and their artificial clears',async()=>{
    f.sqlite.exec("UPDATE users SET display_name='playfun-fixture' WHERE id='p1'");run(f,'seed');
    expect(await ensureDailyPick(f.env,NOW)).toBeNull();
    f.sqlite.exec("UPDATE users SET display_name='p1' WHERE id='p1';UPDATE users SET display_name='playfun-builder' WHERE id='builder'");
    expect(await ensureDailyPick(f.env,NOW)).toBeNull();
  });
  it('keeps private-world content outside daily community discovery',async()=>{
    run(f,'seed');
    f.sqlite.exec(`INSERT INTO world_entitlements (id,owner_user_id,owner_email,source,status,claim_limit_ceiling,publish_limit_ceiling,created_at,updated_at)
      VALUES ('private-entitlement','builder','builder@example.test','complimentary','active',10,10,'${NOW}','${NOW}');
      INSERT INTO worlds (id,number,origin_x,origin_y,owner_user_id,entitlement_id,build_policy,publish_policy,claim_limit_per_day,publish_limit_per_day,activated_at,created_at,updated_at)
      VALUES ('private',1,64,0,'builder','private-entitlement','invite_only','approval_required',10,10,'${NOW}','${NOW}','${NOW}');
      INSERT INTO world_room_claims (room_id,x,y,world_id,claimed_at) VALUES ('0,0',0,0,'private','${NOW}')`);
    expect(await ensureDailyPick(f.env,NOW)).toBeNull();
  });
  it('keeps a published pin stable after republish and visibly withdraws Play',async()=>{
    await pick();const json=JSON.stringify({...f.record.published,version:2,title:'New private-ish title'});
    f.sqlite.prepare('UPDATE rooms SET published_json=? WHERE id=\'0,0\'').run(json);
    const result=await loadDailyResponse(f.env,null,NOW);
    expect(result.pick).toMatchObject({version:1,title:'Lava Gauntlet',available:false});
    expect(JSON.stringify(result)).not.toContain('New private-ish title');
    expect(await awardDailyClear(f.env,'p2','room','0,0',2,NOW)).toBe(0);
  });
  it.each(['native_expanded_room','legacy_course','legacy_only'])('picks one whole %s with pinned member versions and ranks assembly clears',async source=>{
    const course=createDefaultCourseSnapshot('level');course.version=3;course.status='published';course.title='Whole Adventure';
    course.goal=createDefaultCourseGoal('reach_exit');course.publishedAt=NOW;
    course.roomRefs=[{roomId:'0,0',coordinates:{x:0,y:0},roomVersion:1,roomTitle:'First'},
      {roomId:'1,0',coordinates:{x:1,y:0},roomVersion:1,roomTitle:'Second'}];
    const json=JSON.stringify(course),room=JSON.stringify({...f.record.published,id:'1,0',coordinates:{x:1,y:0}});
    f.sqlite.prepare("INSERT INTO rooms (id,x,y,draft_json,published_json,last_published_by_user_id) VALUES ('1,0',1,0,?,?,'builder')").run(room,room);
    f.sqlite.prepare("INSERT INTO room_versions (room_id,version,snapshot_json,created_at) VALUES ('1,0',1,?,?)").run(room,NOW);
    f.sqlite.prepare(`INSERT INTO expanded_rooms (id,owner_user_id,owner_display_name,source_type,legacy_course_id,
      anchor_room_id,anchor_x,anchor_y,draft_json,published_json,published_title,published_version,created_at,updated_at,published_at)
      VALUES ('course:level','builder','builder',?,?,'0,0',0,0,?,?,'Whole Adventure',3,?,?,?)`)
      .run(source==='legacy_only'?'legacy_course':source,source==='native_expanded_room'?null:'level',json,json,NOW,NOW,NOW);
    f.sqlite.prepare("INSERT INTO expanded_room_versions (expanded_room_id,version,snapshot_json,title,created_at) VALUES ('course:level',3,?,'Whole Adventure',?)").run(json,NOW);
    f.sqlite.exec("INSERT INTO expanded_room_cells (expanded_room_id,expanded_room_version,cell_order,room_id,room_x,room_y,room_version) VALUES ('course:level',3,0,'0,0',0,0,1),('course:level',3,1,'1,0',1,0,1)");
    await refreshPlayableContentIndexForExpandedRoom(f.env,'course:level');
    if (source==='legacy_only') {
      f.sqlite.prepare(`INSERT INTO courses (id,owner_user_id,owner_display_name,draft_json,published_json,published_title,published_version,created_at,updated_at,published_at)
        VALUES ('level','builder','builder',?,?,'Whole Adventure',3,?,?,?)`).run(json,json,NOW,NOW,NOW);
      f.sqlite.prepare("INSERT INTO course_versions (course_id,version,snapshot_json,title,created_at) VALUES ('level',3,?,'Whole Adventure',?)").run(json,NOW);
      f.sqlite.exec("DELETE FROM expanded_rooms WHERE id='course:level'");
    }
    f.sqlite.prepare(source==='legacy_only'
      ? `INSERT INTO course_runs (attempt_id,course_id,course_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,elapsed_ms,verification_status) VALUES ('assembly','level',3,'reach_exit',?,'p1','p1',?,?,'completed',10000,'passed')`
      : `INSERT INTO expanded_room_runs (attempt_id,expanded_room_id,expanded_room_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,elapsed_ms,verification_status)
      VALUES ('assembly','course:level',3,'reach_exit',?,'p1','p1',?,?,'completed',10000,'passed')`).run(JSON.stringify(course.goal),NOW,NOW);
    expect(await ensureDailyPick(f.env,NOW)).toMatchObject({target_type:'expanded_room',content_id:'course:level',version:3,room_version:1,cell_count:2,title:'Whole Adventure'});
    expect((await loadDailyResponse(f.env,'p1',NOW)).leaderboard).toMatchObject([{userId:'p1',rank:1}]);
    expect(await awardDailyClear(f.env,'p2','course',source==='native_expanded_room'?'course:level':'level',3,NOW)).toBe(5);
    expect(await awardDailyClear(f.env,'p2','room','0,0',1,NOW)).toBe(0);
    if(source==='legacy_only') f.sqlite.exec("UPDATE courses SET published_json=NULL WHERE id='level'");
    else f.sqlite.exec("UPDATE expanded_rooms SET archived_at='2026-10-04T18:00:00.000Z'");
    expect((await loadDailyResponse(f.env,null,NOW)).pick?.available).toBe(false);
  });
  it('uses one best run per player inside the UTC day and excludes rejected/wrong-version finishes',async()=>{
    await pick();run(f,'p2-slow','p2',9000);run(f,'p2-fast','p2',5000);run(f,'p3','p3',7000);run(f,'failed','builder',100,'failed');
    run(f,'new-version','builder',50,'passed',2);run(f,'yesterday','builder',10);
    f.sqlite.exec("UPDATE room_runs SET finished_at='2026-10-03T23:59:59.999Z' WHERE attempt_id='yesterday'");
    run(f,'tomorrow','builder',5);f.sqlite.exec("UPDATE room_runs SET finished_at='2026-10-05T00:00:00.000Z' WHERE attempt_id='tomorrow'");
    const result=await loadDailyResponse(f.env,'p2',NOW);
    expect(result.leaderboard.map(row=>[row.rank,row.userId,row.elapsedMs])).toEqual([[1,'p2',5000],[2,'p3',7000],[3,'p1',10000]]);
    expect(result.viewer?.rank).toBe(1);expect(result.bonusPxp).toBe(5);
  });
  it('awards +5 only once for a verified pinned clear and reflects it in seven-day progress',async()=>{
    await pick();const value=run(f,'win','p2',4000);
    await awardRoomRunProgression(f.env,params(f.record,value));await awardRoomRunProgression(f.env,params(f.record,value));
    expect(f.sqlite.prepare("SELECT COUNT(*) AS count, SUM(amount) AS total FROM pxp_events WHERE user_id='p2' AND event_type='daily_clear'").get()).toMatchObject({count:1,total:5});
    expect((await loadDailyResponse(f.env,'p2',NOW)).viewer).toMatchObject({completed:true,completedLast7:1});
    expect(await awardRoomRunProgression(f.env,params(f.record,run(f,'rejected','p3',1000,'failed')))).toMatchObject({pxp:0});
    expect((await loadDailyResponse(f.env,'p3',NOW)).viewer?.completed).toBe(false);
  });
  it('claims a guest daily bonus once transactionally, without adding the guest to ranked boards',async()=>{
    await pick();guest('one');guest('two');
    const identity={guestUserId:'guest',recoveryTokenHash:'secret'};
    const first=await claimGuestRuns(f.env,identity,'p2','claim-a');
    expect(first).toMatchObject({clearsSaved:2,pxpAwarded:25});
    expect(await claimGuestRuns(f.env,identity,'p2','claim-a')).toEqual(first);
    guest('three');expect((await claimGuestRuns(f.env,identity,'p2','claim-b')).pxpAwarded).toBe(0);
    const daily=await loadDailyResponse(f.env,'p2',NOW);expect(daily.viewer).toMatchObject({completed:true,rank:null});
    expect(daily.leaderboard.some(row=>row.userId==='p2')).toBe(false);
  });
  it('rotates to a new UTC day even with a small eligible pool, and resets its board',async()=>{
    await pick();const tomorrow='2026-10-05T00:00:00.000Z';
    const result=await loadDailyResponse(f.env,null,tomorrow);
    expect(result.date).toBe('2026-10-05');expect(result.pick?.date).toBe('2026-10-05');expect(result.leaderboard).toEqual([]);
    expect(result.recentPicks.map(row=>row.date)).toEqual(['2026-10-05','2026-10-04']);
  });
  it('allows an admin pick before today starts and locks it when a guest run has started',async()=>{
    run(f,'before','p1');f.sqlite.exec("UPDATE room_runs SET started_at='2026-10-03T12:00:00.000Z' WHERE attempt_id='before'");
    await overrideDailyPick(f.env,'0,0',NOW);expect((await ensureDailyPick(f.env,NOW))?.picked_by).toBe('admin');
    guest('active');f.sqlite.exec("UPDATE guest_run_attempts SET result='active', verification_status='pending' WHERE attempt_id='active'");
    await expect(overrideDailyPick(f.env,'0,0',NOW)).rejects.toMatchObject({status:409});
  });
  it('protects admin mutation and never exposes notice/email fields in the public response',async()=>{
    await pick();f.env.ADMIN_API_KEY='admin-test';
    await expect(handleAdminDaily(new Request('https://api.wamp.land/api/admin/daily'),f.env)).rejects.toMatchObject({status:403});
    await expect(handleAdminDaily(new Request('https://api.wamp.land/api/admin/daily',{method:'PUT',headers:{'x-admin-key':'admin-test',Origin:'https://hostile.test'},body:'{}'}),f.env)).rejects.toMatchObject({status:403});
    const result=await handleDaily(new Request('https://api.wamp.land/api/daily'),f.env);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    const body=await result.text();expect(body).not.toContain('notice_');expect(body).not.toContain('@example.test');
  });
});
describe('builder feature notices',()=>{
  const enable=async()=>{f.env.RESEND_API_KEY='fake-provider';await saveActivityPreferences(f.env.DB,'builder',{weeklyDigest:false,dethroneAlerts:false,dailyFeatures:true},'2026-10-04T00:00:00.000Z');};
  const sender=()=>vi.fn<typeof fetch>().mockResolvedValue(new Response('{"id":"fake"}'));
  it('keeps email opt-in off by default and never sends from a public read',async()=>{
    f.env.RESEND_API_KEY='fake';await pick();const send=sender();await loadDailyResponse(f.env,null,NOW);
    expect(await sendDailyFeatureEmail(f.env,NOW,send)).toBe(0);expect(send).not.toHaveBeenCalled();
  });
  it('leases one notice, escapes builder titles and provides a scoped unsubscribe',async()=>{
    await enable();await pick();f.sqlite.exec("UPDATE daily_rooms SET title='<Adventure>'");
    const send=sender();await Promise.all([sendDailyFeatureEmail(f.env,NOW,send),sendDailyFeatureEmail(f.env,NOW,send)]);
    expect(send).toHaveBeenCalledTimes(1);const message=JSON.parse(String(send.mock.calls[0][1]?.body));
    expect(message.html).toContain('&lt;Adventure&gt;');expect(message.text).toContain('https://wamp.land/today');
    const link=message.text.match(/Unsubscribe: (\S+)/)?.[1];expect(link).toBeTruthy();
    await handleActivityUnsubscribe(new Request(link,{method:'POST'}),new URL(link),f.env.DB,Date.parse(NOW));
    expect(f.sqlite.prepare("SELECT daily_features,weekly_digest,dethrone_alerts FROM builder_activity_preferences WHERE user_id='builder'").get()).toMatchObject({daily_features:0,weekly_digest:0,dethrone_alerts:0});
    expect(await sendDailyFeatureEmail(f.env,NOW,send)).toBe(0);
  });
  it('backs off failures and retains the provider key, stopping after midnight',async()=>{
    await enable();await pick();const send=sender();send.mockResolvedValueOnce(new Response('outage',{status:503}));vi.spyOn(console,'error').mockImplementation(()=>{});
    expect(await sendDailyFeatureEmail(f.env,NOW,send)).toBe(0);
    expect(await sendDailyFeatureEmail(f.env,'2026-10-04T17:01:00.000Z',send)).toBe(0);
    expect(await sendDailyFeatureEmail(f.env,'2026-10-04T17:16:00.000Z',send)).toBe(1);
    expect(new Headers(send.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe(new Headers(send.mock.calls[1][1]?.headers).get('Idempotency-Key'));
    expect(send.mock.calls[0][1]?.body).toBe(send.mock.calls[1][1]?.body);
    expect(await sendDailyFeatureEmail(f.env,'2026-10-05T00:00:00.000Z',send)).toBe(0);
  });
  it('does not mail a new opt-in for a past pick, or a removed level',async()=>{
    await pick();await enable();f.sqlite.exec("UPDATE builder_activity_preferences SET daily_enabled_at='2026-10-04T18:00:00.000Z'");
    const send=sender();expect(await sendDailyFeatureEmail(f.env,NOW,send)).toBe(0);
    f.sqlite.exec("UPDATE builder_activity_preferences SET daily_enabled_at='2026-10-04T00:00:00.000Z';UPDATE rooms SET published_json=NULL");
    expect(await sendDailyFeatureEmail(f.env,NOW,send)).toBe(0);expect(send).not.toHaveBeenCalled();
  });
});
