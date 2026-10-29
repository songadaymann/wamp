import { afterEach, describe, expect, it } from 'vitest';
import { discoveryFixture } from '../runs/discoveryTestDatabase';
import { refreshPlayableContentIndexForRoom } from '../playableContentIndex/store';
import { createSession } from '../auth/store';
import { fixture } from './testDatabase';
import { handlePublishRecognition } from './recognition';
const opened:ReturnType<typeof fixture>[]=[];
const setup=()=>{const f=fixture();opened.push(f);return f;};
afterEach(()=>{for(const f of opened.splice(0))f.sqlite.close();});
describe('publication recognition warning read',()=>{
 it('requires a session, returns exact version-bound flags and prevents shared caching',async()=>{
   const f=setup(),url=new URL('https://api.wamp.land/api/me/publish-recognition?targetKey=room%3A0%2C0&version=1');
   await expect(handlePublishRecognition(new Request(url),url,f.env)).rejects.toMatchObject({status:401});
   const token=await createSession(f.env,'builder'),headers={Cookie:`ep_session=${token}`};
   f.sqlite.exec("INSERT INTO featured_rooms VALUES('0,0',1,'2026-10-01','room:0,0',1)");await refreshPlayableContentIndexForRoom(f.env,'0,0');
   const response=await handlePublishRecognition(new Request(url,{headers}),url,f.env);
   expect(await response.json()).toEqual({targetKey:'room:0,0',version:1,featured:true,roomOfTheDay:false});
   expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('vary')).toContain('Cookie');
   url.searchParams.set('version','2');expect(await(await handlePublishRecognition(new Request(url,{headers}),url,f.env)).json()).toMatchObject({featured:false});
 });
 it('matches Expanded target versions and the current UTC daily pick rather than the anchor cell alone',async()=>{
   const f=discoveryFixture();opened.push(f);const token=await createSession(f.env,'builder'),headers={Cookie:`ep_session=${token}`};
   const day=new Date().toISOString().slice(0,10);
   f.sqlite.exec("INSERT INTO featured_rooms VALUES('7,0',1,'2026-10-01','expanded_room:native',3)");
   f.sqlite.prepare(`INSERT INTO daily_rooms(date,target_key,target_type,content_id,version,room_id,room_version,room_x,room_y,title,
     builder_user_id,builder_display_name,goal_json,cell_count,picked_by,picked_at)
     VALUES(?,'expanded_room:native','expanded_room','native',3,'7,0',1,7,0,'Expanded','builder','Builder','{}',2,'admin',?)`).run(day,new Date().toISOString());
   const url=new URL('https://api.wamp.land/api/me/publish-recognition?targetKey=expanded_room%3Anative&version=3');
   expect(await(await handlePublishRecognition(new Request(url,{headers}),url,f.env)).json()).toMatchObject({featured:true,roomOfTheDay:true});
   url.searchParams.set('targetKey','room:7,0');url.searchParams.set('version','1');
   expect(await(await handlePublishRecognition(new Request(url,{headers}),url,f.env)).json()).toMatchObject({featured:false,roomOfTheDay:false});
 });
 it.each(['version=0&targetKey=room:0,0','version=1.5&targetKey=room:0,0','version=1&targetKey=unrecognized','targetKey=room:0,0'])('rejects invalid target/version %s',async query=>{
   const f=setup(),token=await createSession(f.env,'builder'),url=new URL('https://api.wamp.land/api/me/publish-recognition?'+query);
   await expect(handlePublishRecognition(new Request(url,{headers:{Cookie:`ep_session=${token}`}}),url,f.env)).rejects.toMatchObject({status:400});
 });
});
