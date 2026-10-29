import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { activityDescription } from '../../../activity/model';
import { award, fixture, NOW } from './testDatabase';
import { loadActivity, loadAllActivity } from './store';
import { discoveryFixture } from '../runs/discoveryTestDatabase';
import { refreshPlayableContentIndexForRoom } from '../playableContentIndex/store';
const opened: ReturnType<typeof fixture>[]=[];
const setup=(include=true)=>{const f=fixture(include);opened.push(f);return f;};
afterEach(()=>{for(const f of opened.splice(0))f.sqlite.close();});
function feature(f:ReturnType<typeof fixture>,at=NOW){
  f.sqlite.prepare(`INSERT INTO featured_rooms(room_id,room_version,featured_at,target_key,target_version)
    VALUES('0,0',1,?,'room:0,0',1) ON CONFLICT(room_id) DO UPDATE SET featured_at=excluded.featured_at`).run(at);
}
function daily(f:ReturnType<typeof fixture>){
  f.sqlite.prepare(`INSERT INTO daily_rooms(date,target_key,target_type,content_id,version,room_id,room_version,
    room_x,room_y,title,builder_user_id,builder_display_name,goal_json,cell_count,picked_by,picked_at)
    VALUES('2026-10-04','room:0,0','room','0,0',1,'0,0',1,0,0,'Lava Gauntlet','builder','Builder','{}',1,'admin',?)`).run(NOW);
}
describe('builder recognition facts',()=>{
 it('notifies the pinned builder once, privately, without a generated player actor',async()=>{
   const f=setup();await refreshPlayableContentIndexForRoom(f.env,'0,0');feature(f);feature(f,'2026-10-05T00:00:00Z');
   const feed=await loadActivity(f.env.DB,'builder',true,undefined,'rooms');
   expect(feed.entries).toHaveLength(1);expect(feed.entries[0]).toMatchObject({kind:'featured',actorName:'WAMP',contentVersion:1});
   expect(activityDescription(feed.entries[0])).toBe('Lava Gauntlet was added to Featured');
   expect((await loadAllActivity(f.env.DB)).entries).toEqual([]);
   expect((await loadActivity(f.env.DB,'p1',true)).entries).toEqual([]);
 });
 it('resolves native and legacy Expanded recognition to the whole reviewed version',async()=>{
   const f=discoveryFixture();opened.push(f);
   for(const [id,room] of [['native','7,0'],['course:legacy','9,0']]){
     f.sqlite.prepare(`INSERT INTO featured_rooms(room_id,room_version,featured_at,target_key,target_version)
       VALUES(?,1,?,?,3) ON CONFLICT(room_id) DO UPDATE SET target_key=excluded.target_key,
       target_version=excluded.target_version,featured_at=excluded.featured_at`).run(room,NOW,`expanded_room:${id}`);
   }
   const entries=(await loadActivity(f.env.DB,'builder',true,undefined,'rooms')).entries
     .filter(entry=>entry.kind==='featured'&&entry.contentVersion===3);
   expect(entries.map(entry=>[entry.contentTitle,entry.contentPath]).sort()).toEqual([
     ['course:legacy','/r/9/0'],['native','/r/7/0']]);
   expect((await loadAllActivity(f.env.DB)).entries.some(entry=>entry.kind==='featured')).toBe(false);
 });
 it('announces Room of the Day independently of email opt-in and avoids a duplicate Featured notice',async()=>{
   const f=setup();await refreshPlayableContentIndexForRoom(f.env,'0,0');daily(f);feature(f);
   f.sqlite.exec("UPDATE daily_rooms SET notice_attempts=1 WHERE date='2026-10-04'");
   const feed=await loadActivity(f.env.DB,'builder',true,undefined,'rooms');
   expect(feed.entries).toHaveLength(1);expect(feed.entries[0]).toMatchObject({kind:'daily',recognition:{date:'2026-10-04'}});
   expect(activityDescription(feed.entries[0])).toContain('Room of the Day for 2026-10-04');
   expect(f.sqlite.prepare('SELECT daily_features FROM builder_activity_preferences').get()).toMatchObject({daily_features:0});
 });
 it('gives every entrant results, preserves the winner rank and does not repeat settlement notices',async()=>{
   const f=setup();
   f.sqlite.exec(`INSERT INTO build_prompts(slug,title,constraint_text,starts_at,ends_at,created_at,updated_at)
     VALUES('week-one','One Jump','One jump','2026-10-01','2026-10-03','2026-10-01','2026-10-01')`);
   f.sqlite.exec(`INSERT INTO rooms(id,x,y,draft_json,published_json,published_title,claimer_user_id)
     VALUES('1,0',1,0,'{}','{}','Moon Bounce','p1');
     INSERT INTO room_versions(room_id,version,snapshot_json,title,created_at,published_by_user_id)
     VALUES('1,0',1,'{}','Moon Bounce','2026-10-01','p1')`);
   for(const [key,user] of [['room:0,0','builder'],['room:1,0','p1']]){
     f.sqlite.prepare(`INSERT INTO build_prompt_entries(prompt_slug,target_key,content_type,content_id,version,room_id,room_version,
       room_x,room_y,title,builder_user_id,builder_display_name,cell_count,submitted_at)
       VALUES('week-one',?,'room',?,1,?,1,0,0,'Entry',?,?,1,?)`).run(key,key.slice(5),key.slice(5),user,user,NOW);
   }
   f.sqlite.exec("INSERT INTO build_prompt_winners VALUES('week-one',1,'room:0,0',1,2,4.5,'2026-10-04')");
   f.sqlite.prepare('UPDATE build_prompts SET settled_at=? WHERE slug=?').run(NOW,'week-one');
   f.sqlite.exec("UPDATE build_prompts SET settled_at='2026-10-05' WHERE slug='week-one'");
   const winner=(await loadActivity(f.env.DB,'builder',true,undefined,'rooms')).entries,other=(await loadActivity(f.env.DB,'p1',true,undefined,'rooms')).entries;
   expect(winner).toHaveLength(1);expect(other).toHaveLength(1);
   expect(winner[0]).toMatchObject({kind:'prompt_result',recognition:{promptSlug:'week-one',promptTitle:'One Jump',rank:1,entryCount:2}});
   expect(activityDescription(winner[0])).toBe('Lava Gauntlet placed #1 in One Jump');
   expect(activityDescription(other[0])).toBe('One Jump results are in: 2 entries. Your entry: Moon Bounce');
   expect((await loadAllActivity(f.env.DB)).entries).toEqual([]);
 });
 it('preserves deleted high-water ids, old rows, triggers, views and indexes across the rebuild',async()=>{
   const f=setup(false);
   for(const name of ['0055_builder_activity.sql','0057_daily_rooms.sql','0066_guest_activity_index.sql','0069_room_edit_activity.sql'])
     f.sqlite.exec(readFileSync(new URL(`../../../../migrations/${name}`,import.meta.url),'utf8'));
   award(f,'kept');award(f,'removed','unique_rating_room');
   const highest=(f.sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name='builder_activity'").get() as {seq:number}).seq;
   f.sqlite.exec("DELETE FROM builder_activity WHERE dedupe_key='bxp:removed'");
   f.sqlite.exec(readFileSync(new URL('../../../../migrations/0077_builder_recognition_activity.sql',import.meta.url),'utf8'));
   award(f,'next','unique_completion_room','p2');
   const rows=f.sqlite.prepare('SELECT id,dedupe_key FROM builder_activity ORDER BY id').all() as {id:number;dedupe_key:string}[];
   expect(rows.map(row=>row.dedupe_key)).toEqual(['bxp:kept','bxp:next']);expect(rows[1].id).toBeGreaterThan(highest);
   expect(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'builder_activity_%'").all()).toHaveLength(12);
   expect(f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_builder_activity_guest_actor'").get()).toBeTruthy();
   expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 });
});
