import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, run, NOW } from '../activity/testDatabase';
import { attachRoomInsights, loadInsightDeathMap, loadInsightSummaries } from './store';
import { ensureInsightRoomFacts, insightEquivalentVersions, previousInsightLayout } from './lineage';
import type { RoomSnapshot } from '../../../persistence/roomModel';
import { createDefaultRoomMusic } from '../../../music/model';
const opened:ReturnType<typeof fixture>[]=[];
const setup=()=>{const f=fixture();opened.push(f);return f;};
afterEach(()=>{for(const f of opened.splice(0))f.sqlite.close();vi.restoreAllMocks();});
const target=(version:number)=>({contentType:'room' as const,contentId:'0,0',version});
function publish(f:ReturnType<typeof fixture>,version:number,changes:Partial<RoomSnapshot>={},publisher='builder'){
 const snapshot={...structuredClone(f.record.published!),version,...changes};
 f.sqlite.prepare('INSERT INTO room_versions(room_id,version,snapshot_json,title,created_at,published_by_user_id) VALUES(?,?,?,?,?,?)')
  .run('0,0',version,JSON.stringify(snapshot),snapshot.title,NOW,publisher);
 f.sqlite.prepare('UPDATE rooms SET published_json=?,published_title=?,last_published_by_user_id=? WHERE id=?')
  .run(JSON.stringify(snapshot),snapshot.title,publisher,'0,0');return snapshot;
}
const summary=async(f:ReturnType<typeof fixture>,version:number)=>(await loadInsightSummaries(f.env,[target(version)])).get(`room:0,0:${version}`);
describe('matching-version insights',()=>{
 it('fills cold title/music versions and retains players, median, deaths and card headlines without double counting',async()=>{
  const f=setup();publish(f,2,{title:'Renamed'});publish(f,3,{title:'New music',music:createDefaultRoomMusic()});
  run(f,'old','p1',1000);run(f,'middle','p2',3000,'passed',2);run(f,'new','p1',5000,'passed',3);
  f.sqlite.exec(`UPDATE room_runs SET deaths=2,insight_deaths_json='[{"roomX":0,"roomY":0,"tileX":4,"tileY":9},{"roomX":0,"roomY":0,"tileX":4,"tileY":9}]' WHERE attempt_id='old'`);
  expect(await summary(f,3)).toMatchObject({attempts:3,uniquePlayers:2,medianClearMs:3000,totalDeaths:2});
  expect((await loadInsightDeathMap(f.env,target(3))).deathMap).toEqual([{roomX:0,roomY:0,tileX:4,tileY:9,deaths:2}]);
  const both=await loadInsightSummaries(f.env,[target(1),target(3)]);expect(both.get('room:0,0:1')?.attempts).toBe(3);expect(both.get('room:0,0:3')?.attempts).toBe(3);
  expect((await attachRoomInsights(f.env,[{roomId:'0,0',roomVersion:3}]))[0].insights.uniquePlayers).toBe(2);
  expect(await insightEquivalentVersions(f.env,target(3))).toEqual([1,2,3]);
  const prepare=vi.spyOn(f.env.DB,'prepare');await summary(f,3);
  expect(prepare.mock.calls.some(([sql])=>/^SELECT snapshot_json FROM room_versions/.test(sql))).toBe(false);
 });
 it('separates a real tile change and restores matching history after a revert',async()=>{
  const f=setup();publish(f,2,{title:'Metadata'});const changed=structuredClone(f.record.published!);changed.tileData.terrain[5][5]=88;
  publish(f,3,{tileData:changed.tileData});publish(f,4,{title:'Restored original'});
  run(f,'v1','p1',1000);run(f,'v2','p2',3000,'passed',2);run(f,'v3','p3',9000,'passed',3);run(f,'v4','p3',2000,'passed',4);
  expect(await summary(f,3)).toMatchObject({attempts:1,medianClearMs:9000});
  expect(await summary(f,4)).toMatchObject({attempts:3,uniquePlayers:3,medianClearMs:2000});
  expect(await insightEquivalentVersions(f.env,target(4))).toEqual([1,2,4]);expect(await previousInsightLayout(f.env,target(4))).toBe(3);
  expect(await previousInsightLayout(f.env,target(3))).toBe(2);
  const delta=f.sqlite.prepare("SELECT change_from_previous AS value FROM room_version_facts WHERE room_id='0,0' AND version=3").get() as {value:number};
  expect(delta.value).toBeGreaterThan(0);expect(delta.value).toBeLessThan(1);
 });
 it('excludes each attempt’s own publisher rather than the publisher of the requested version',async()=>{
  const f=setup();f.sqlite.exec("UPDATE room_versions SET published_by_user_id='p1' WHERE room_id='0,0' AND version=1");publish(f,2,{title:'Other builder'},'p2');
  run(f,'self1','p1',9000);run(f,'cross1','p2',1000);run(f,'self2','p2',9000,'passed',2);run(f,'cross2','p1',2000,'passed',2);run(f,'third','p3',3000);
  expect(await summary(f,2)).toMatchObject({attempts:3,uniquePlayers:3,medianClearMs:2000});
 });
 it('repairs stale, missing-fingerprint and malformed facts without interpreting invalid JSON as a match',async()=>{
  const f=setup();publish(f,2,{title:'Same layout'});publish(f,3,{title:'Unplayed version'});publish(f,4,{title:'Unsupported cached hash'});run(f,'old');
  for(const [version,factsVersion,json] of [[1,0,'{}'],[2,1,'{}'],[3,1,'malformed'],[4,1,'{"fingerprint":"legacy-payload"}']] as const)
   f.sqlite.prepare('INSERT INTO room_version_facts VALUES(?,?,?,?,0,?)').run('0,0',version,factsVersion,json,NOW);
  expect(await summary(f,4)).toMatchObject({attempts:1});
  await ensureInsightRoomFacts(f.env,[target(2)],true);expect(await insightEquivalentVersions(f.env,target(2))).toEqual([1,2,3,4]);
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM room_version_facts WHERE facts_version=1 AND json_valid(facts_json)').get()).toMatchObject({n:4});
 });
 it('falls back to exact counts when an old snapshot is unreadable instead of looping or inventing equivalence',async()=>{
  const f=setup();publish(f,2,{title:'New title'});run(f,'old');run(f,'new','p2',3000,'passed',2);
  f.sqlite.exec("UPDATE room_versions SET snapshot_json='malformed' WHERE room_id='0,0' AND version=1");
  expect(await summary(f,2)).toMatchObject({attempts:1,medianClearMs:3000});expect(await insightEquivalentVersions(f.env,target(2))).toEqual([2]);
 });
});

it('serves a different-layout comparison with separate grouped medians and maps',async()=>{
 const {handleRoomInsights}=await import('./routes');const f=setup();publish(f,2,{title:'Renamed'});
 const changed=structuredClone(f.record.published!);changed.tileData.terrain[5][5]=88;publish(f,3,{title:'Changed',tileData:changed.tileData});
 run(f,'old','p1',1000);run(f,'metadata','p2',3000,'passed',2);run(f,'layout','p3',9000,'passed',3);
 f.sqlite.exec(`UPDATE room_runs SET deaths=2,insight_deaths_json='[{"roomX":0,"roomY":0,"tileX":4,"tileY":9}]' WHERE attempt_id='old';
   UPDATE room_runs SET deaths=4,insight_deaths_json='[{"roomX":0,"roomY":0,"tileX":6,"tileY":9}]' WHERE attempt_id='layout'`);
 const url=new URL('https://api.wamp.land/api/rooms/0%2C0/stats?version=3');
 const response=await handleRoomInsights(new Request(url),url,f.env,'room','0,0'),body=await response.json();
 expect(body).toMatchObject({target:{version:3},equivalentVersions:[3],versionGrouping:'matching',summary:{attempts:1,medianClearMs:9000},
   comparison:{target:{version:2},equivalentVersions:[1,2],summary:{attempts:2,medianClearMs:2000},deathMap:[{tileX:4}]},deathMap:[{tileX:6}]});
 expect(JSON.stringify(body)).not.toContain('p1');expect(response.headers.get('cache-control')).toBe('public, max-age=30');
 url.searchParams.set('version','2');const earlier=await(await handleRoomInsights(new Request(url),url,f.env,'room','0,0')).json();
 expect(earlier.comparison).toBeNull();expect(earlier.equivalentVersions).toEqual([1,2]);
 expect((await attachRoomInsights(f.env,[{roomId:'0,0',roomVersion:2,expandedRoom:{expandedRoomId:'room:0,0',expandedRoomVersion:2}}]))[0].insights.attempts).toBe(2);
});
it('batches a large cold page within D1 bind limits without reading many snapshots in one result',async()=>{
 const f=setup(),targets=[];for(let x=10;x<55;x++){
   const id=`${x},0`,snapshot={...structuredClone(f.record.published!),id,coordinates:{x,y:0}};
   f.sqlite.prepare('INSERT INTO rooms(id,x,y,draft_json,published_json) VALUES(?,?,0,?,?)').run(id,x,JSON.stringify(snapshot),JSON.stringify(snapshot));
   f.sqlite.prepare('INSERT INTO room_versions(room_id,version,snapshot_json,created_at,published_by_user_id) VALUES(?,1,?,?,?)').run(id,JSON.stringify(snapshot),NOW,'builder');
   targets.push({roomId:id,roomVersion:1});
 }
 const original=f.env.DB.prepare.bind(f.env.DB);let maxBinds=0,summaryQueries=0;
 vi.spyOn(f.env.DB,'prepare').mockImplementation(sql=>{if(sql.includes('requested(target_key,version_key)'))summaryQueries++;
   if(sql.includes('SELECT snapshot_json FROM room_versions'))expect(sql).toContain('version=?');
   const statement=original(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{maxBinds=Math.max(maxBinds,values.length);return bind(...values);};return statement;
 });
 expect(await attachRoomInsights(f.env,targets)).toHaveLength(45);expect(summaryQueries).toBe(2);expect(maxBinds).toBeLessThanOrEqual(100);
 expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM room_version_facts').get()).toMatchObject({n:45});
});
