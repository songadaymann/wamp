import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fixture, run, NOW } from '../activity/testDatabase';
import { loadInsightSummaries, loadInsightDeathMap, attachRoomInsights } from './store';
import { handleRoomInsights, resolveInsightMetadata } from './routes';
import { deathLocationsJson } from './deathLocations';
import { RankedRunTraceRecorder } from '../../../scenes/overworld/rankedRunTraceRecorder';
import { normalizeRankedRunVerificationTrace } from '../../../runs/verificationTrace';
const fixtures: ReturnType<typeof fixture>[] = [];
const setup = () => { const f = fixture(); fixtures.push(f); return f; };
afterEach(() => { for (const f of fixtures.splice(0)) f.sqlite.close(); });
const target = { contentType: 'room' as const, contentId: '0,0', version: 1 };
const summary = async (f: ReturnType<typeof fixture>, t = target) => (await loadInsightSummaries(f.env,[t])).get(`room:${t.contentId}:${t.version}`);
function guest(f: ReturnType<typeof fixture>, id: string, user = 'g1', result = 'completed', type = 'room', content = '0,0', status = 'passed', deaths = 2) {
  f.sqlite.prepare(`INSERT INTO guest_run_attempts (attempt_id,guest_user_id,recovery_token_hash,client_run_id,content_type,content_id,content_version,
    progress_source_type,progress_source_id,verification_nonce,snapshot_hash,started_at,expires_at,result,verification_status,finished_at,metrics_json)
    VALUES (?,?,?,?,?,?,1,?,?, 'nonce','hash',?,?, ?,?,?,?)`).run(id,user,'private-recovery-hash',id,type,content,type === 'room' ? 'room':'course',content,NOW,'2030',result,status,NOW,JSON.stringify({ elapsedMs: 5000, deaths }));
}
function course(f: ReturnType<typeof fixture>) {
  const snapshot = JSON.stringify({ id: 'c1',version: 1,title: 'Two cells',roomRefs: [{ roomId: '0,0',coordinates: { x:0,y:0 },roomVersion:1 }],goal: { type:'reach_exit' } });
  f.sqlite.prepare(`INSERT INTO courses (id,owner_user_id,owner_display_name,draft_json,published_json,published_version,created_at,updated_at) VALUES ('c1','builder','builder',?,?,1,?,?)`).run(snapshot,snapshot,NOW,NOW);
  f.sqlite.prepare(`INSERT INTO course_versions (course_id,version,snapshot_json,created_at,published_by_user_id) VALUES ('c1',1,?,?,'builder')`).run(snapshot,NOW);
  f.sqlite.prepare(`INSERT INTO expanded_rooms (id,owner_user_id,owner_display_name,source_type,legacy_course_id,anchor_room_id,anchor_x,anchor_y,draft_json,published_json,published_version,created_at,updated_at) VALUES ('native1','builder','builder','native_expanded_room','c1','0,0',0,0,?,?,1,?,?)`).run(snapshot,snapshot,NOW,NOW);
  f.sqlite.prepare(`INSERT INTO expanded_room_versions (expanded_room_id,version,snapshot_json,created_at) VALUES ('native1',1,?,?)`).run(snapshot,NOW);
  f.sqlite.exec("INSERT INTO expanded_room_cells (expanded_room_id,expanded_room_version,cell_order,room_id,room_x,room_y,room_version) VALUES ('native1',1,0,'0,0',0,0,1)");
}

describe('room insights on the actual migrated database', () => {
  it('counts finished replays, failures and abandonments; median is per clear and uniques are per player', async () => {
    const f = setup(); run(f,'a','p1',1000); run(f,'b','p1',3000); run(f,'c','p2',5000);
    f.sqlite.exec("UPDATE room_runs SET result='failed',deaths=4 WHERE attempt_id='c'");
    run(f,'d','p2',9000); f.sqlite.exec("UPDATE room_runs SET result='abandoned',deaths=2 WHERE attempt_id='d'");
    expect(await summary(f)).toMatchObject({ attempts:4,uniquePlayers:2,completions:2,failures:1,abandonments:1,clearRate:0.5,medianClearMs:2000,averageDeaths:1.5,mappedAttempts:0,mappedDeaths:0 });
  });
  it('excludes own/generated runs, rejected clears, unplayed starts, and other exact versions', async () => {
    const f=setup(); run(f,'real'); run(f,'self','builder'); run(f,'bad','p2',5000,'failed'); run(f,'timeout','p2',5000,'timeout');
    run(f,'zero','p2',0); run(f,'other-version','p2',5000,'passed',2); run(f,'unplayed','p2');
    f.sqlite.exec("UPDATE room_runs SET result='active',finished_at=NULL WHERE attempt_id='unplayed'; UPDATE users SET email=NULL WHERE id='generated'; INSERT INTO playfun_user_links (user_id,ogp_id,created_at,updated_at) VALUES ('generated','generated','2026','2026')");
    run(f,'generated','generated'); expect(await summary(f)).toMatchObject({ attempts:1,uniquePlayers:1,completions:1 });
    expect((await loadInsightSummaries(f.env,[{...target,version:2}])).get('room:0,0:2')?.attempts).toBe(1);
  });
  it('uses captured play time and excludes new intro-only abandonments despite a running server clock', async () => {
    const f=setup(); run(f,'intro','p1',5000); run(f,'played','p2',7000);
    f.sqlite.exec("UPDATE room_runs SET result='abandoned',insight_play_ms=0 WHERE attempt_id='intro'; UPDATE room_runs SET insight_play_ms=3000 WHERE attempt_id='played'");
    expect(await summary(f)).toMatchObject({attempts:1,uniquePlayers:1,medianClearMs:3000});
  });
  it('retains guest failures and maps after pruning; retries and claims do not add plays or unique accounts', async () => {
    const f=setup(); run(f,'account','p1'); guest(f,'gclear'); guest(f,'gfail','g1','failed','room','0,0','failed');
    f.sqlite.exec("UPDATE guest_run_attempts SET metrics_json=metrics_json WHERE attempt_id='gclear'");
    expect(await summary(f)).toMatchObject({ attempts:3,uniquePlayers:2,completions:2,failures:1 });
    f.sqlite.exec("UPDATE guest_run_attempts SET claimed_user_id='p1' WHERE attempt_id='gclear'; DELETE FROM guest_run_attempts WHERE attempt_id='gfail'");
    expect(await summary(f)).toMatchObject({ attempts:3,uniquePlayers:1,completions:2,failures:1 });
  });
  it('preserves earlier account attribution when another account claims later plays from the same browser', async () => {
    const f=setup(); guest(f,'first'); f.sqlite.exec("UPDATE guest_run_attempts SET claimed_user_id='p1' WHERE attempt_id='first'");
    guest(f,'later'); f.sqlite.exec("UPDATE guest_run_attempts SET claimed_user_id='p2' WHERE attempt_id='later'");
    expect(await summary(f)).toMatchObject({attempts:2,uniquePlayers:2});
    const duplicated=await loadInsightSummaries(f.env,[target,target]); expect(duplicated.get('room:0,0:1')?.attempts).toBe(2);
  });
  it('excludes guest self plays after claim and counts no invalid guest clears', async () => {
    const f=setup(); guest(f,'self'); guest(f,'rejected','g2','completed','room','0,0','failed');
    f.sqlite.exec("UPDATE guest_run_attempts SET claimed_user_id='builder' WHERE attempt_id='self'"); expect(await summary(f)).toBeUndefined();
  });
  it('aggregates room-local tiles once per result, distinguishes unknown older locations and preserves zero-death coverage', async () => {
    const f=setup(); run(f,'old'); run(f,'new'); run(f,'newzero');
    const points=JSON.stringify([{roomX:0,roomY:0,tileX:4,tileY:9},{roomX:0,roomY:0,tileX:4,tileY:9}]);
    f.sqlite.prepare('UPDATE room_runs SET deaths=2,insight_deaths_json=? WHERE attempt_id=\'new\'').run(points);
    f.sqlite.exec("UPDATE room_runs SET insight_deaths_json='[]' WHERE attempt_id='newzero'; UPDATE room_runs SET deaths=deaths WHERE attempt_id='new'");
    expect(await loadInsightDeathMap(f.env,target)).toEqual({ deathMap:[{roomX:0,roomY:0,tileX:4,tileY:9,deaths:2}],deathMapTruncated:false });
    expect(await summary(f)).toMatchObject({ attempts:3,totalDeaths:2,mappedAttempts:2,mappedDeaths:2 });
  });
  it('does not count mirrored native/legacy attempts twice, and merges native and course-backed guest targets', async () => {
    const f=setup(); course(f);
    for (const [table,col,id] of [['expanded_room_runs','expanded_room_id','native1'],['course_runs','course_id','c1']]) {
      const version=table==='course_runs'?'course_version':'expanded_room_version';
      f.sqlite.prepare(`INSERT INTO ${table} (attempt_id,${col},${version},goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,elapsed_ms,deaths,verification_status) VALUES ('mirror',?,1,'reach_exit','{}','p1','p1',?,?,'completed',1000,0,'passed')`).run(id,NOW,NOW);
    }
    guest(f,'cg','g1','completed','course','c1'); guest(f,'ng','g2','completed','expanded_room','native1');
    const native={contentType:'expanded_room' as const,contentId:'native1',version:1};
    const rows=await loadInsightSummaries(f.env,[native]); expect(rows.get('expanded_room:native1:1')).toMatchObject({attempts:3,uniquePlayers:3});
    expect((await resolveInsightMetadata(f.env,{contentType:'course',contentId:'c1'})).target).toEqual(native);
    expect((await resolveInsightMetadata(f.env,native)).cells).toEqual([{x:0,y:0}]);
  });
  it('backfills available history idempotently and returns zero/null rather than inventing a clear rate', async () => {
    const f=setup(); run(f,'existing'); guest(f,'existingguest');
    f.sqlite.exec('DELETE FROM room_insight_attempts');
    const migration=readFileSync(new URL('../../../../migrations/0056_room_insights.sql',import.meta.url),'utf8');
    const inserts=migration.match(/INSERT OR IGNORE INTO room_insight_attempts[\s\S]*?;/g)!;
    for(let i=0;i<2;i++) for(const sql of inserts) f.sqlite.exec(sql);
    expect(await summary(f)).toMatchObject({attempts:2,uniquePlayers:2});
    const rows=await attachRoomInsights(f.env,[{roomId:'0,0',roomVersion:2}]); expect(rows[0].insights).toMatchObject({attempts:0,clearRate:null,averageDeaths:null,medianClearMs:null,lastPlayedAt:null});
  });
  it('serves public aggregates only and rejects missing targets and invalid versions', async () => {
    const f=setup(); guest(f,'guest-secret'); const url=new URL('https://api.wamp.land/api/rooms/0%2C0/stats?version=1');
    const response=await handleRoomInsights(new Request(url),url,f.env,'room','0,0'); const body=await response.text();
    expect(response.status).toBe(200); expect(body).not.toMatch(/g1|guest-secret|private-recovery-hash|player_key|user_id/);
    expect(JSON.parse(body).summary).toMatchObject({attempts:1,completions:1});
    await expect(handleRoomInsights(new Request(url),new URL(url.href.replace('version=1','version=0')),f.env,'room','0,0')).rejects.toMatchObject({status:400});
    await expect(resolveInsightMetadata(f.env,{...target,version:2})).rejects.toMatchObject({status:404});
    await expect(resolveInsightMetadata(f.env,{...target,contentId:'999,999'})).rejects.toMatchObject({status:404});
  });
});

describe('bounded death positions', () => {
  const frame={roomCoordinates:{x:-2,y:3},x:50,y:999,vx:0,vy:0,grounded:false,horizontalInput:0,verticalInput:0,jumpPressed:false};
  const binding={verificationSchemaVersion:1,verificationNonce:'nonce',snapshotHash:'hash'};
  it('captures the dying position before respawn, caps the first 50 and clamps falls to the room edge', () => {
    const recorder=new RankedRunTraceRecorder(); recorder.start('room',binding,frame);
    for(let i=0;i<60;i++) {recorder.recordFrame(16,frame);recorder.recordDeath(frame);}
    const trace=recorder.buildTrace(960)!; expect(trace.deathEvents).toHaveLength(50);
    expect(trace.deathEvents?.[0]).toEqual({atMs:16,roomX:-2,roomY:3,tileX:3,tileY:21});
    expect(JSON.parse(deathLocationsJson(trace,binding,[frame.roomCoordinates],960,60)!)).toHaveLength(50);
    recorder.clear(); expect(recorder.buildTrace(1)).toBeNull();
  });
  it('ignores invalid tiles, foreign cells, out-of-time and unbound locations while preserving older traces', () => {
    const recorder=new RankedRunTraceRecorder();recorder.start('course',binding,frame);const trace=recorder.buildTrace(1000)!;
    trace.deathEvents=[{atMs:100,roomX:-2,roomY:3,tileX:2,tileY:4},{atMs:200,roomX:0,roomY:0,tileX:2,tileY:4},
      {atMs:300,roomX:-2,roomY:3,tileX:40,tileY:4},{atMs:1800,roomX:-2,roomY:3,tileX:2,tileY:4}];
    expect(JSON.parse(deathLocationsJson(trace,binding,[frame.roomCoordinates],1000,4)!)).toEqual([{roomX:-2,roomY:3,tileX:2,tileY:4}]);
    expect(deathLocationsJson(trace,{...binding,snapshotHash:'wrong'},[frame.roomCoordinates],1000,4)).toBeNull();
    delete trace.deathEvents; expect(deathLocationsJson(trace,binding,[frame.roomCoordinates],1000,4)).toBeNull();
    expect(normalizeRankedRunVerificationTrace(trace)).not.toBeNull();
  });
  it('limits client-supplied death arrays before copying them and never exceeds the reported death count', () => {
    const recorder=new RankedRunTraceRecorder();recorder.start('room',binding,frame);const trace=recorder.buildTrace(1000)!;
    trace.deathEvents=Array.from({length:1000},()=>({atMs:100,roomX:-2,roomY:3,tileX:2,tileY:4}));
    const normalized=normalizeRankedRunVerificationTrace(trace)!; expect(normalized.deathEvents).toHaveLength(50);
    expect(JSON.parse(deathLocationsJson(normalized,binding,[frame.roomCoordinates],1000,3)!)).toHaveLength(3);
  });
});
