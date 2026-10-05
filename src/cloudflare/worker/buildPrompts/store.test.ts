import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {fixture,run} from '../activity/testDatabase';
import {createDefaultCourseSnapshot,createDefaultCourseGoal} from '../../../courses/model';
import {refreshPlayableContentIndexForExpandedRoom,refreshPlayableContentIndexForRoom} from '../playableContentIndex/store';
import {loadPublicProgressionSummary} from '../progression/badgesTrophies';
import {submitRoomRating,submitCourseRating} from '../progression/ratings';
import {loadCourseRecord} from '../courses/store';
import {handleAdminBuildPrompts,handleBuildPrompts} from './routes';
import {weekStart,saveBuildPrompt,deleteBuildPrompt,loadBuildPrompts,submitBuildPromptEntry,withdrawBuildPromptEntry,settleExpiredBuildPrompts} from './store';
const NOW='2026-10-05T18:00:00.000Z',END='2026-10-12T00:00:00.000Z';
const input={slug:'only-one-jump',title:'Only One Jump',constraint:'Build a goal level that needs exactly one jump.',startsAt:'2026-10-05T00:00:00.000Z'};
let f:ReturnType<typeof fixture>;
beforeEach(async()=>{vi.useFakeTimers();vi.setSystemTime(new Date(NOW));f=fixture();
  f.record.published!.publishedAt=NOW;
  f.sqlite.prepare("UPDATE rooms SET published_json=?,last_published_by_user_id='builder',last_published_by_display_name='builder' WHERE id='0,0'").run(JSON.stringify(f.record.published));
  await refreshPlayableContentIndexForRoom(f.env,'0,0');});
afterEach(()=>{f.sqlite.close();vi.restoreAllMocks();vi.useRealTimers();});
async function enter(){await saveBuildPrompt(f.env,input,NOW);return submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',1,NOW);}
function rating(id='vote',user='p1',stars:number|null=5,at=NOW,status='passed',version=1) {
  run(f,id,user,1000,status,version);
  f.sqlite.prepare('UPDATE room_runs SET started_at=?,finished_at=? WHERE attempt_id=?').run(at,at,id);
  f.sqlite.prepare(`INSERT INTO room_ratings(room_id,lineage_key,version_key,user_id,quality_stars,trust_weight,completed_attempt_id,first_rated_at,updated_at)
    VALUES('0,0','lineage',1,?,?,1,?,?,?) ON CONFLICT(room_id,version_key,user_id) DO UPDATE SET quality_stars=excluded.quality_stars,
      completed_attempt_id=excluded.completed_attempt_id,updated_at=excluded.updated_at`).run(user,stars,id,at,at);
}
describe('weekly prompts on the complete migrated database',()=>{
  it('projects real rating-service writes and requires a clear of the exact entered publication',async()=>{
    await enter();run(f,'real-clear','p1',1000,'passed',1);
    f.sqlite.prepare('UPDATE room_runs SET started_at=?,finished_at=? WHERE attempt_id=?').run(NOW,NOW,'real-clear');
    const rate=()=>submitRoomRating(f.env,{roomRecord:f.record,userId:'p1',body:{roomCoordinates:{x:0,y:0},roomVersion:f.record.published!.version,qualityStars:5,difficultyChoice:'easy',autoSuggestedDifficulty:'medium'},now:NOW});
    await rate();
    expect(f.sqlite.prepare("SELECT completed_attempt_id FROM room_ratings WHERE user_id='p1'").get()).toMatchObject({completed_attempt_id:'real-clear'});
    expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0].voteCount).toBe(1);
    const snapshot={...f.record.published!,version:2};f.record.published=snapshot;
    f.record.versions.push({...f.record.versions[0],version:2,snapshot});
    f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify(snapshot));
    f.sqlite.prepare("INSERT INTO room_versions(room_id,version,snapshot_json,created_at) VALUES('0,0',2,?,?)").run(JSON.stringify(snapshot),NOW);
    await refreshPlayableContentIndexForRoom(f.env,'0,0');await submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',2,NOW);
    await rate();expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0].voteCount).toBe(0);
    run(f,'new-clear','p1',1000,'passed',2);f.sqlite.prepare('UPDATE room_runs SET started_at=?,finished_at=? WHERE attempt_id=?').run(NOW,NOW,'new-clear');
    await rate();expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0]).toMatchObject({version:2,voteCount:1});
  });
  it('starts empty: there is no automatic or seeded first theme',async()=>{
    expect(await loadBuildPrompts(f.env,null,undefined,0,NOW)).toMatchObject({current:null,prompt:null,entries:[],recent:[],viewerEntry:null});
    expect(await settleExpiredBuildPrompts(f.env,NOW)).toBe(0);
  });
  it('uses Monday midnight UTC across timezone and daylight-saving offsets',()=>{
    expect(weekStart('2026-10-04T20:00:00-04:00')).toBe(input.startsAt);
    expect(weekStart('2026-11-01T22:00:00-05:00')).toBe('2026-11-02T00:00:00.000Z');
  });
  it('validates the weekly window and disallows overlapping prompts',async()=>{
    await expect(saveBuildPrompt(f.env,{...input,startsAt:'2026-10-06T00:00:00.000Z'},NOW)).rejects.toMatchObject({status:400});
    await expect(saveBuildPrompt(f.env,{...input,slug:'unsafe/sql'},NOW)).rejects.toMatchObject({status:400});
    await expect(saveBuildPrompt(f.env,{...input,title:''},NOW)).rejects.toMatchObject({status:400});
    await saveBuildPrompt(f.env,input,NOW);
    await expect(saveBuildPrompt(f.env,{...input,slug:'another'},NOW)).rejects.toMatchObject({status:409});
  });
  it('keeps scheduled themes out of public pages until the opening instant',async()=>{
    await saveBuildPrompt(f.env,{...input,startsAt:END},NOW);
    expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).prompt).toBeNull();
    expect((await loadBuildPrompts(f.env,null,undefined,0,END)).current?.slug).toBe(input.slug);
    await expect(loadBuildPrompts(f.env,null,input.slug,0,NOW)).rejects.toMatchObject({status:404});
  });
  it('enters the exact owned goal version using account identity without username or email',async()=>{
    f.sqlite.exec("UPDATE users SET email=NULL,username=NULL WHERE id='builder'");
    const entry=await enter();expect(entry).toMatchObject({targetKey:'room:0,0',contentId:'0,0',version:1,builderUserId:'builder',available:true,voteCount:0,winnerRank:null});
    const response=await loadBuildPrompts(f.env,'builder',undefined,0,NOW);expect(response.viewerEntry?.targetKey).toBe(entry.targetKey);expect(response.prompt?.entryCount).toBe(1);
  });
  it('rejects another account, stale versions, old publications, generated-only builders and no-goal rooms',async()=>{
    await saveBuildPrompt(f.env,input,NOW);
    await expect(submitBuildPromptEntry(f.env,input.slug,'p1','room:0,0',1,NOW)).rejects.toMatchObject({status:403});
    await expect(submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',2,NOW)).rejects.toMatchObject({status:403});
    f.record.published!.publishedAt='2026-10-04T12:00:00.000Z';f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify(f.record.published));
    await expect(submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',1,NOW)).rejects.toMatchObject({status:409});
    f.record.published!.publishedAt=NOW;f.record.published!.goal=null;f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify(f.record.published));await refreshPlayableContentIndexForRoom(f.env,'0,0');
    await expect(submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',1,NOW)).rejects.toMatchObject({status:403});
    f.record.published!.goal={type:'reach_exit',exit:{x:700,y:320},timeLimitMs:null};f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify(f.record.published));await refreshPlayableContentIndexForRoom(f.env,'0,0');
    f.sqlite.exec("UPDATE users SET display_name='playfun-builder' WHERE id='builder'");
    await expect(submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',1,NOW)).rejects.toMatchObject({status:403});
  });
  it('locks prompt edits once an entry exists, and supports deliberate owner withdrawal',async()=>{
    await enter();await expect(saveBuildPrompt(f.env,{...input,title:'Different constraint'},NOW)).rejects.toMatchObject({status:409});
    await expect(deleteBuildPrompt(f.env,input.slug)).rejects.toMatchObject({status:409});
    await withdrawBuildPromptEntry(f.env,input.slug,'p1',NOW);expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries).toHaveLength(1);
    await withdrawBuildPromptEntry(f.env,input.slug,'builder',NOW);await deleteBuildPrompt(f.env,input.slug);expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).prompt).toBeNull();
  });
  it('is idempotent on entry retry and stops entry/withdrawal exactly at closing',async()=>{
    await enter();await submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',1,NOW);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM build_prompt_entries').get()).toMatchObject({count:1});
    await expect(submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',1,END)).rejects.toMatchObject({status:409});
    await expect(withdrawBuildPromptEntry(f.env,input.slug,'builder',END)).rejects.toMatchObject({status:409});
  });
  it('projects only actual verified non-builder quality ratings, with exact run versions and one vote per person',async()=>{
    await enter();rating();rating('repeat','p1',4);rating('owner','builder',5);rating('rejected','p2',5,NOW,'failed');rating('wrong-version','p3',5,NOW,'passed',2);
    const row=(await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0];expect(row.voteCount).toBe(1);expect(row.adjustedAverage).toBe(3.58);
    rating('removed','p1',null);expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0].voteCount).toBe(0);
  });
  it('includes qualifying ratings made before entry and excludes generated voters',async()=>{
    rating();await enter();expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0].voteCount).toBe(1);
    f.sqlite.exec("UPDATE users SET display_name='playfun-p1' WHERE id='p1'");
    expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0].voteCount).toBe(0);
  });
  it('settles exactly once, awarding the winner badge, immutable ribbon and featured pin',async()=>{
    await enter();rating();await settleExpiredBuildPrompts(f.env,END);await settleExpiredBuildPrompts(f.env,END);
    expect(f.sqlite.prepare('SELECT * FROM build_prompt_winners').get()).toMatchObject({rank:1,target_key:'room:0,0',version:1,vote_count:1});
    expect(f.sqlite.prepare('SELECT * FROM badge_awards').get()).toMatchObject({user_id:'builder',badge_id:'builder_prompt_winner'});
    expect(f.sqlite.prepare('SELECT * FROM featured_rooms').get()).toMatchObject({room_id:'0,0',room_version:1,target_key:'room:0,0',target_version:1});
    const response=await loadBuildPrompts(f.env,'builder',undefined,0,END);expect(response.current).toBeNull();expect(response.prompt?.settledAt).toBe(END);expect(response.entries[0].winnerRank).toBe(1);
    expect((await loadPublicProgressionSummary(f.env,'builder')).featuredBadges.some(b=>b.badgeId==='builder_prompt_winner'&&b.label==='Prompt Winner')).toBe(true);
  });
  it('freezes closed votes: later edits do not rewrite awards or averages',async()=>{
    await enter();rating();await settleExpiredBuildPrompts(f.env,END);rating('late','p1',1,END);
    expect((await loadBuildPrompts(f.env,null,undefined,0,END)).entries[0]).toMatchObject({voteCount:1,adjustedAverage:3.75,winnerRank:1});
  });
  it('closes with no fabricated winners when entries have no eligible votes',async()=>{
    await enter();await settleExpiredBuildPrompts(f.env,END);
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM build_prompt_winners').get()).toMatchObject({count:0});
    expect((await loadBuildPrompts(f.env,null,undefined,0,END)).prompt?.settledAt).toBe(END);
  });
  it('keeps republished versions unplayable and out of awards until deliberately reentered',async()=>{
    await enter();rating();f.record.published!.version=2;f.sqlite.prepare('UPDATE rooms SET published_json=?').run(JSON.stringify(f.record.published));
    f.sqlite.prepare("INSERT INTO room_versions(room_id,version,snapshot_json,created_at,published_by_user_id) VALUES('0,0',2,?,?,'builder')").run(JSON.stringify(f.record.published),NOW);await refreshPlayableContentIndexForRoom(f.env,'0,0');
    expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0]).toMatchObject({version:1,available:false,voteCount:1});
    await submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',2,NOW);
    expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0]).toMatchObject({version:2,available:true,voteCount:0});
  });
  it.each(['native_expanded_room','legacy_course','legacy_only'])('enters and verifies exact whole %s publications',async source=>{
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
    await saveBuildPrompt(f.env,input,NOW);
    expect(await submitBuildPromptEntry(f.env,input.slug,'builder','expanded_room:course:level',3,NOW)).toMatchObject({contentType:'expanded_room',version:3,roomVersion:1,cellCount:2});
    const table=source==='legacy_only'?'course_ratings':'expanded_room_ratings';
    const column=source==='legacy_only'?'course_id':'expanded_room_id',id=source==='legacy_only'?'level':'course:level';
    f.sqlite.prepare(`INSERT INTO ${table}(${column},lineage_key,version_key,user_id,quality_stars,trust_weight,completed_attempt_id,first_rated_at,updated_at)
      VALUES (?,'lineage',3,'p1',5,1,'assembly',?,?)`).run(id,NOW,NOW);
    expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0]).toMatchObject({voteCount:1,adjustedAverage:3.75});
    if(source==='legacy_only') {
      const record=await loadCourseRecord(f.env,'level');if(!record)throw new Error('Missing course fixture.');
      await submitCourseRating(f.env,{courseRecord:record,userId:'p1',body:{courseVersion:3,qualityStars:5,difficultyChoice:'easy',autoSuggestedDifficulty:'medium'},now:NOW});
      expect(f.sqlite.prepare("SELECT completed_attempt_id FROM course_ratings WHERE user_id='p1'").get()).toMatchObject({completed_attempt_id:'assembly'});
      expect((await loadBuildPrompts(f.env,null,undefined,0,NOW)).entries[0]).toMatchObject({voteCount:1,adjustedAverage:3.66});
    }
    await settleExpiredBuildPrompts(f.env,END);
    expect(f.sqlite.prepare('SELECT * FROM featured_rooms').get()).toMatchObject({target_key:'expanded_room:course:level',target_version:3,room_version:1});
  });
  it('does not leak an entry when any member becomes a private World room',async()=>{
    await enter();
    f.sqlite.exec(`INSERT INTO world_entitlements(id,owner_user_id,owner_email,source,status,claim_limit_ceiling,publish_limit_ceiling,created_at,updated_at)
      VALUES('entitlement','builder','builder@example.test','complimentary','active',10,10,'${NOW}','${NOW}');
      INSERT INTO worlds(id,number,origin_x,origin_y,owner_user_id,entitlement_id,build_policy,publish_policy,claim_limit_per_day,publish_limit_per_day,activated_at,created_at,updated_at)
      VALUES('private',1,64,0,'builder','entitlement','invite_only','approval_required',10,10,'${NOW}','${NOW}','${NOW}');
      INSERT INTO world_room_claims(room_id,x,y,world_id,claimed_at) VALUES('0,0',0,0,'private','${NOW}');`);
    const response=await loadBuildPrompts(f.env,'builder',undefined,0,NOW);expect(response.entries).toHaveLength(0);expect(response.prompt?.entryCount).toBe(0);expect(response.viewerEntry).toBeNull();
    await settleExpiredBuildPrompts(f.env,END);expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM build_prompt_winners').get()).toMatchObject({count:0});
  });
  it('bounds public pages and orders top-three ties deterministically without rounding the ranking',async()=>{
    await enter();rating();
    for(let index=1;index<=49;index++){
      const user=`b${index}`,id=`${index},0`,snapshot={...f.record.published,id,coordinates:{x:index,y:0}};
      f.sqlite.prepare('INSERT INTO users(id,display_name,created_at,updated_at) VALUES(?,?,?,?)').run(user,user,NOW,NOW);
      f.sqlite.prepare('INSERT INTO rooms(id,x,y,draft_json,published_json,claimer_user_id,last_published_by_user_id) VALUES(?,?,0,?,?,?,?)').run(id,index,JSON.stringify(snapshot),JSON.stringify(snapshot),user,user);
      f.sqlite.prepare('INSERT INTO room_versions(room_id,version,snapshot_json,created_at) VALUES(?,1,?,?)').run(id,JSON.stringify(snapshot),NOW);
      await refreshPlayableContentIndexForRoom(f.env,id);
      await submitBuildPromptEntry(f.env,input.slug,user,`room:${id}`,1,NOW);
      f.sqlite.prepare(`INSERT INTO build_prompt_votes(prompt_slug,target_key,version,user_id,quality_stars,trust_weight,completed_attempt_id,rated_at) VALUES(?,?,1,'p1',5,1,'vote',?)`).run(input.slug,`room:${id}`,NOW);
    }
    const page=await loadBuildPrompts(f.env,null,undefined,0,NOW),more=await loadBuildPrompts(f.env,null,undefined,page.nextOffset!,NOW);
    expect(page.entries).toHaveLength(48);expect(page.nextOffset).toBe(48);expect(more.entries).toHaveLength(2);expect(more.nextOffset).toBeNull();
    expect(new Set([...page.entries,...more.entries].map(entry=>entry.targetKey)).size).toBe(50);
    await settleExpiredBuildPrompts(f.env,END);expect(f.sqlite.prepare('SELECT target_key FROM build_prompt_winners ORDER BY rank').all().map(row=>(row as {target_key:string}).target_key)).toEqual(['room:0,0','room:1,0','room:10,0']);
  });
  it('serializes different simultaneous entries by one builder and rejects a second target safely',async()=>{
    await saveBuildPrompt(f.env,input,NOW);
    const json=JSON.stringify({...f.record.published,id:'1,0',coordinates:{x:1,y:0}});
    f.sqlite.prepare("INSERT INTO rooms(id,x,y,draft_json,published_json,claimer_user_id,last_published_by_user_id) VALUES('1,0',1,0,?,?,'builder','builder')").run(json,json);f.sqlite.prepare("INSERT INTO room_versions(room_id,version,snapshot_json,created_at) VALUES('1,0',1,?,?)").run(json,NOW);await refreshPlayableContentIndexForRoom(f.env,'1,0');
    const result=await Promise.allSettled([submitBuildPromptEntry(f.env,input.slug,'builder','room:0,0',1,NOW),submitBuildPromptEntry(f.env,input.slug,'builder','room:1,0',1,NOW)]);
    expect(result.filter(row=>row.status==='fulfilled')).toHaveLength(1);expect(result.find(row=>row.status==='rejected')).toMatchObject({reason:{status:409}});
    expect(f.sqlite.prepare('SELECT COUNT(*) AS count FROM build_prompt_entries').get()).toMatchObject({count:1});
  });
  it('bounds and validates API pages, hides emails and denies anonymous/admin-origin mutation',async()=>{
    await enter();f.env.ADMIN_API_KEY='fixture-key';
    await expect(handleAdminBuildPrompts(new Request('https://api.wamp.land/api/admin/build-prompts'),new URL('https://api.wamp.land/api/admin/build-prompts'),f.env)).rejects.toMatchObject({status:403});
    const request=new Request('https://api.wamp.land/api/admin/build-prompts',{method:'PUT',headers:{'x-admin-key':'fixture-key',Origin:'https://hostile.test'},body:JSON.stringify(input)});
    await expect(handleAdminBuildPrompts(request,new URL(request.url),f.env)).rejects.toMatchObject({status:403});
    const post=new Request('https://api.wamp.land/api/build-prompts/only-one-jump/entry',{method:'POST',body:'{}'});
    await expect(handleBuildPrompts(post,new URL(post.url),f.env)).rejects.toMatchObject({status:401});
    const bad=new Request('https://api.wamp.land/api/build-prompts?offset=-1');await expect(handleBuildPrompts(bad,new URL(bad.url),f.env)).rejects.toMatchObject({status:400});
    const get=new Request('https://api.wamp.land/api/build-prompts');const response=await handleBuildPrompts(get,new URL(get.url),f.env);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(await response.text()).not.toContain('@example.test');
  });
});
