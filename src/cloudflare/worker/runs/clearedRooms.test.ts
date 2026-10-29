import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultRoomSnapshot } from '../../../persistence/roomModel';
import { fixture, run, NOW } from '../activity/testDatabase';
import { createSession } from '../auth/store';
import worker from '../../worker';
import { loadClearedRoomProgress } from './clearedRooms';
let f:ReturnType<typeof fixture>;
beforeEach(()=>{f=fixture();});afterEach(()=>f.sqlite.close());
function room(x:number){const snapshot={...createDefaultRoomSnapshot(`${x},0`,{x,y:0}),status:'published',version:1};
 f.sqlite.prepare('INSERT OR IGNORE INTO rooms(id,x,y,draft_json,published_json) VALUES(?,?,0,?,?)').run(snapshot.id,x,JSON.stringify(snapshot),JSON.stringify(snapshot));}
function clear(id:string,roomId='0,0',user='p1',status='passed'){
 run(f,id,user,1000,status);const x=Number(roomId.split(',')[0]);f.sqlite.prepare('UPDATE room_runs SET room_id=?,room_x=? WHERE attempt_id=?').run(roomId,x,id);
}
describe('private cleared-room map progress',()=>{
 it('uses only the authenticated account, deduplicates accepted completions and rejects invalid cursors',async()=>{
   clear('good');clear('repeat');clear('invalid','0,0','p2','failed');
   const session=await createSession(f.env,'p1');
   const get=(query='',cookie:string|null=session)=>worker.fetch(new Request(`https://api.wamp.land/api/me/cleared-rooms${query}`,{headers:cookie?{Cookie:`ep_session=${cookie}`}:{}}),f.env);
   expect((await get('',null)).status).toBe(401);
   const response=await get('?userId=p2');expect(response.headers.get('cache-control')).toBe('private, no-store');
   expect(await response.json()).toEqual({userId:'p1',roomIds:['0,0'],nextCursor:null});
   expect((await get('?cursor=not-a-room')).status).toBe(400);
   f.sqlite.prepare("UPDATE room_runs SET verification_status='failed' WHERE user_id='p1'").run();
   expect((await loadClearedRoomProgress(f.env,'p1')).roomIds).toEqual([]);
 });
 it('keyset-pages more than512 distinct clears without dropping or repeating room IDs',async()=>{
   for(let x=0;x<515;x++){room(x);clear(`run-${x}`,`${x},0`);}
   const first=await loadClearedRoomProgress(f.env,'p1');expect(first.roomIds).toHaveLength(512);expect(first.nextCursor).not.toBeNull();
   const second=await loadClearedRoomProgress(f.env,'p1',first.nextCursor!);
   expect(second.roomIds).toHaveLength(3);expect(second.nextCursor).toBeNull();
   expect([...first.roomIds,...second.roomIds]).toEqual(Array.from({length:515},(_,x)=>`${x},0`).sort());
 });
 it('marks the completed Expanded version footprint, not cells added by a later publication',async()=>{
   room(1);room(2);
   f.sqlite.prepare(`INSERT INTO expanded_rooms(id,owner_user_id,owner_display_name,anchor_room_id,anchor_x,anchor_y,draft_json,published_json,published_version,created_at,updated_at)
    VALUES('expanded','builder','Builder','0,0',0,0,'{}','{}',2,?,?)`).run(NOW,NOW);
   for(const version of [1,2]){
     f.sqlite.prepare("INSERT INTO expanded_room_versions(expanded_room_id,version,snapshot_json,created_at) VALUES('expanded',?,'{}',?)").run(version,NOW);
     for(let x=0;x<(version===1?2:3);x++)f.sqlite.prepare(`INSERT INTO expanded_room_cells(expanded_room_id,expanded_room_version,cell_order,room_id,room_x,room_y,room_version)
       VALUES('expanded',?,?,?,?,0,1)`).run(version,x,`${x},0`,x);
   }
   f.sqlite.prepare(`INSERT INTO expanded_room_runs(attempt_id,expanded_room_id,expanded_room_version,goal_type,goal_json,user_id,user_display_name,started_at,finished_at,result,verification_status)
     VALUES('clear','expanded',1,'survival','{}','p1','Player',?,?,'completed','passed')`).run(NOW,NOW);
   expect((await loadClearedRoomProgress(f.env,'p1')).roomIds).toEqual(['0,0','1,0']);
   const footprint=(version:string)=>worker.fetch(new Request(`https://api.wamp.land/api/expanded-rooms/expanded/footprint?version=${version}`),f.env);
   expect(await (await footprint('1')).json()).toEqual({expandedRoomId:'expanded',version:1,roomIds:['0,0','1,0']});
   expect(await (await footprint('2')).json()).toEqual({expandedRoomId:'expanded',version:2,roomIds:['0,0','1,0','2,0']});
   expect((await footprint('0')).status).toBe(400);
   f.sqlite.prepare("UPDATE expanded_rooms SET published_json=NULL WHERE id='expanded'").run();
   expect((await footprint('1')).status).toBe(404);
   f.sqlite.prepare("UPDATE expanded_room_runs SET verification_status='failed'").run();
   expect((await loadClearedRoomProgress(f.env,'p1')).roomIds).toEqual([]);
 });
});
