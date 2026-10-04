import { afterEach, describe, expect, it } from 'vitest';
import { fixture, run, NOW } from '../activity/testDatabase';
import { loadRoomDiscoveryResponse } from './difficulty';
const fixtures: ReturnType<typeof fixture>[] = [];
function setup() {
  const f = fixture(); fixtures.push(f);
  f.sqlite.exec("UPDATE rooms SET published_goal_type='reach_exit'");
  return f;
}
function room(f: ReturnType<typeof fixture>, x: number, owner = 'builder') {
  const id = `${x},0`;
  f.sqlite.prepare(`INSERT INTO rooms (id,x,y,draft_json,published_json,published_title,published_goal_type,claimer_user_id)
    SELECT ?,?,0,draft_json,published_json,?,'reach_exit',? FROM rooms WHERE id='0,0'`).run(id,x,id,owner);
  f.sqlite.prepare(`INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id)
    SELECT ?,1,snapshot_json,?,?,? FROM room_versions WHERE room_id='0,0' AND version=1`).run(id,id,NOW,owner);
  return id;
}
function clear(f: ReturnType<typeof fixture>, attempt: string, roomId = '0,0', version = 1) {
  run(f, attempt, 'p1', 1000, 'passed', version);
  f.sqlite.prepare('UPDATE room_runs SET room_id=?,room_x=? WHERE attempt_id=?').run(roomId,Number(roomId.split(',')[0]),attempt);
}
afterEach(() => { for (const f of fixtures.splice(0)) f.sqlite.close(); });
describe('Unrated count on the migrated database', () => {
  it('counts rooms rather than repeat clears and reports the same total across pages', async () => {
    const f = setup(); room(f,1); room(f,2);
    clear(f,'a'); clear(f,'replay'); clear(f,'b','1,0'); clear(f,'c','2,0');
    const first = await loadRoomDiscoveryResponse(f.env,null,1,'unrated',false,'p1');
    const second = await loadRoomDiscoveryResponse(f.env,null,1,'unrated',false,'p1',null,1);
    expect(first.totalCount).toBe(3); expect(second.totalCount).toBe(3);
    expect(first.results).toHaveLength(1); expect(second.results).toHaveLength(1);
    expect(first.results[0]?.roomId).not.toBe(second.results[0]?.roomId); expect(first.nextCursor).toBeTruthy();
  });
  it('excludes rated, own, obsolete-version and uncleared rooms, and changes after a rating', async () => {
    const f = setup(); room(f,1); room(f,2,'p1'); room(f,3); room(f,4);
    clear(f,'a'); clear(f,'b','1,0'); clear(f,'self','2,0'); clear(f,'old','3,0');
    f.sqlite.exec("INSERT INTO room_versions (room_id,version,snapshot_json,title,created_at,published_by_user_id) SELECT room_id,2,snapshot_json,title,created_at,published_by_user_id FROM room_versions WHERE room_id='3,0'");
    const rate = (id: string) => f.sqlite.prepare(`INSERT INTO room_ratings (room_id,lineage_key,version_key,user_id,quality_stars,first_rated_at,updated_at) VALUES (?,?,1,'p1',4,?,?)`).run(id,id,NOW,NOW);
    rate('1,0');
    expect(await loadRoomDiscoveryResponse(f.env,null,1,'unrated',false,'p1')).toMatchObject({ totalCount:1,results:[{roomId:'0,0'}] });
    rate('0,0'); expect(await loadRoomDiscoveryResponse(f.env,null,1,'unrated',false,'p1')).toMatchObject({ totalCount:0,results:[] });
    expect((await loadRoomDiscoveryResponse(f.env,null,1,'unrated',false,'p2')).totalCount).toBe(0);
  });
  it('returns zero for an empty world and keeps the personal count private', async () => {
    const f = setup(); f.sqlite.exec('UPDATE rooms SET published_json=NULL');
    expect(await loadRoomDiscoveryResponse(f.env,null,1,'unrated',false,'p1')).toMatchObject({ totalCount:0,results:[] });
    await expect(loadRoomDiscoveryResponse(f.env,null,1,'unrated')).rejects.toMatchObject({ status:401 });
    expect((await loadRoomDiscoveryResponse(f.env,null,1,'newest')).totalCount).toBeUndefined();
  });
});
