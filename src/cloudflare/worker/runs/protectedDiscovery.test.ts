import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoveryFixture } from './discoveryTestDatabase';
import { loadRoomDiscoveryResponse } from './difficulty';
import { handleRoomDiscovery } from './routes';
import type { RoomDiscoveryResponse } from '../../../runs/model';

let f: ReturnType<typeof discoveryFixture>;
beforeEach(() => {
  f=discoveryFixture(); f.rate('p2',1,4,'easy');
  for(const [target,id] of [['native','8,0'],['course:legacy','10,0']]) f.sqlite.prepare('INSERT INTO playable_content_index_members(target_key,room_id,room_version) VALUES (?,?,1)').run(`expanded_room:${target}`,id);
  f.sqlite.prepare("UPDATE rooms SET minted_chain_id=8453 WHERE id IN ('1,0','8,0','10,0','13,0')").run();
});
afterEach(()=>{f.sqlite.close();vi.restoreAllMocks();});
const targetKey=(r:RoomDiscoveryResponse['results'][number])=>r.expandedRoom?.expandedRoomId??r.roomId;

describe('Protected discovery eligibility before pagination',()=>{
  it.each([false,true])('returns only protected standalone/native/legacy targets, including goal-less rooms; index=%s',async index=>{
    f.env.PLAYABLE_CONTENT_INDEX_READS=index?'1':'0';
    const results=(await loadRoomDiscoveryResponse(f.env,null,100,'protected')).results;
    expect(new Set(results.map(targetKey))).toEqual(new Set(['1,0','native','course:legacy','13,0']));
    expect(results.every(r=>r.protectedCellCount===1)).toBe(true);
    expect(results.find(r=>r.roomId==='13,0')?.goalType).toBeNull();
    expect(results.find(r=>r.expandedRoom?.expandedRoomId==='native')?.expandedRoom?.cellCount).toBe(2);
  });
  it.each([false,true])('filters before page boundaries and keeps cursor sort-bound; index=%s',async index=>{
    f.env.PLAYABLE_CONTENT_INDEX_READS=index?'1':'0';let cursor:string|undefined;const seen:string[]=[];
    do{
      const url=new URL('https://api.wamp.land/api/leaderboards/rooms/discover?sort=protected&limit=1');if(cursor)url.searchParams.set('cursor',cursor);
      const response=await handleRoomDiscovery(new Request(url),url,f.env),body=await response.json() as RoomDiscoveryResponse;
      expect(body.results).toHaveLength(1);seen.push(...body.results.map(targetKey));cursor=body.nextCursor;
    }while(cursor);
    expect(seen).toHaveLength(4);expect(new Set(seen).size).toBe(4);
    const first=await loadRoomDiscoveryResponse(f.env,null,1,'protected');expect(first.nextCursor).toBeDefined();
    const url=new URL('https://api.wamp.land/api/leaderboards/rooms/discover?sort=newest&cursor='+first.nextCursor);
    await expect(handleRoomDiscovery(new Request(url),url,f.env)).rejects.toMatchObject({status:400});
  });
  it.each([false,true])('retains difficulty filtering and excludes goal-less results when a difficulty is selected; index=%s',async index=>{
    f.env.PLAYABLE_CONTENT_INDEX_READS=index?'1':'0';
    const results=(await loadRoomDiscoveryResponse(f.env,'easy',100,'protected')).results;
    expect(results.map(r=>r.roomId)).toContain('1,0');expect(results.every(r=>r.goalType!==null&&r.consensusDifficulty==='easy')).toBe(true);
    expect(results.some(r=>r.roomId==='13,0')).toBe(false);
  });
  it.each([false,true])('orders by first publication, not by the date a cell was protected; index=%s',async index=>{
    f.env.PLAYABLE_CONTENT_INDEX_READS=index?'1':'0';
    f.sqlite.prepare("UPDATE room_versions SET created_at='2026-10-20T00:00:00Z' WHERE room_id='1,0'").run();
    f.sqlite.prepare("UPDATE playable_content_index SET first_published_at='2026-10-20T00:00:00Z' WHERE content_id='1,0'").run();
    expect((await loadRoomDiscoveryResponse(f.env,null,1,'protected')).results[0]?.roomId).toBe('1,0');
  });
  it.each([false,true])('omits missing, zero and unprotected membership; empty pages carry no continuation; index=%s',async index=>{
    f.env.PLAYABLE_CONTENT_INDEX_READS=index?'1':'0';f.sqlite.prepare('UPDATE rooms SET minted_chain_id=NULL').run();
    const result=await loadRoomDiscoveryResponse(f.env,null,1,'protected');expect(result.results).toEqual([]);expect(result.nextCursor).toBeUndefined();
  });
});
