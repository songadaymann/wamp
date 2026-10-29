import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClearedRoomPage } from './clearedRooms';
import { hasClearedRoom, replaceClearedRooms } from './clearedRooms';
import { CLEARED_ROOM_STORAGE_KEY, ClearedRoomService } from './clearedRoomService';
import type { GuestRunProgressRecord } from './guestRunProgress';
import type { PostRunRatingRequestDetail } from './postRunRatingEvents';
const page=(userId:string,roomIds:string[],nextCursor:string|null=null):ClearedRoomPage=>({userId,roomIds,nextCursor});
function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}} as Storage;}
const detail=(id:string,ids=[id]):PostRunRatingRequestDetail=>({contentType:'room',contentId:id,roomCoordinates:{x:0,y:0},clearedRoomIds:ids,
 contentTitle:null,version:1,previousViewerRank:null,elapsedMs:1000,deaths:0,score:null,autoSuggestedDifficulty:'easy'});
afterEach(()=>{replaceClearedRooms([]);vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('personal map session cache',()=>{
 it('loads every page once per session and does not publish partial or another account’s progress',async()=>{
   const load=vi.fn().mockResolvedValueOnce(page('p1',['0,0'],'0,0')).mockResolvedValueOnce(page('p1',['1,0']));
   const service=new ClearedRoomService(load,null,()=>[]);await service.setUser('p1');await service.setUser('p1');
   expect(load).toHaveBeenCalledTimes(2);expect(hasClearedRoom('0,0')).toBe(true);expect(service.snapshot().total).toBe(2);
   let finish!:(p:ClearedRoomPage)=>void;
   load.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const pending=service.setUser('p2');
   expect(hasClearedRoom('0,0')).toBe(false);
   load.mockResolvedValueOnce(page('p3',['3,0']));await service.setUser('p3');finish(page('p2',['2,0']));await pending;
   expect(hasClearedRoom('3,0')).toBe(true);expect(hasClearedRoom('2,0')).toBe(false);
 });
 it('preserves guest map progress beyond the50-entry history and across sessions without making account claims',async()=>{
   const saved=storage(),load=vi.fn(async()=>page('p1',[]));
   const service=new ClearedRoomService(load,saved,()=>[]);await service.setUser(null);
   for(let x=0;x<60;x++)service.rememberGuest(detail(`${x},0`));
   const next=new ClearedRoomService(load,saved,()=>[]);await next.setUser(null);expect(next.snapshot().total).toBe(60);
   expect(load).not.toHaveBeenCalled();await next.setUser('p1');expect(next.snapshot().total).toBe(0);
   next.rememberGuest(detail('99,0'));expect(hasClearedRoom('99,0')).toBe(false);
   await next.setUser(null);expect(next.snapshot().total).toBe(60);
 });
 it('accepts pinned guest footprints and old ordinary clears, but not explicitly ineligible clears',async()=>{
   const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
   const records=[{contentType:'room',contentId:'0,0'}, {contentType:'room',contentId:'1,0',clearedRoomIds:[]},
     {contentType:'expanded_room',contentId:'expanded',clearedRoomIds:['2,0','3,0']}] as GuestRunProgressRecord[];
   const service=new ClearedRoomService(vi.fn(),null,()=>records);await service.setUser(null);
   expect(service.snapshot().total).toBe(3);expect(hasClearedRoom('1,0')).toBe(false);expect(fetch).not.toHaveBeenCalled();
 });
 it('backfills the exact historical footprint for older Expanded records and rejects a mismatched version',async()=>{
   const records=[{contentType:'expanded_room',contentId:'same',version:1},{contentType:'course',contentId:'changed',version:1}] as GuestRunProgressRecord[];
   const fetch=vi.fn(async(url:RequestInfo|URL)=>{const same=String(url).includes('/same/');return Response.json({expandedRoomId:same?'same':'course:changed',version:same?1:2,roomIds:[same?'4,0':'5,0']});});vi.stubGlobal('fetch',fetch);
   const service=new ClearedRoomService(vi.fn(),null,()=>records);await service.setUser(null);await service.setUser(null);
   expect(hasClearedRoom('4,0')).toBe(true);expect(hasClearedRoom('5,0')).toBe(false);expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('keeps confirmed checks on refresh failure and rejects a stalled page or changed identity without partial data',async()=>{
   const load=vi.fn().mockResolvedValueOnce(page('p1',['0,0']));const service=new ClearedRoomService(load,null,()=>[]);
   await service.setUser('p1');load.mockRejectedValueOnce(new Error('Offline'));await service.setUser('p1',true);
   expect(hasClearedRoom('0,0')).toBe(true);expect(service.snapshot().status).toContain('retry');
   load.mockResolvedValueOnce(page('wrong',['9,0']));await service.setUser('p2');expect(service.snapshot().total).toBe(0);
   load.mockResolvedValue(page('p2',['1,0'],'1,0'));await service.setUser('p2',true);
   expect(service.snapshot().total).toBe(0);expect(load.mock.calls.length).toBe(5);
 });
 it('ignores corrupt stored IDs and keeps this tab usable if storage is blocked',async()=>{
   const saved=storage();saved.setItem(CLEARED_ROOM_STORAGE_KEY,JSON.stringify(['0,0','bad','01,0','-0,0',{},'2,0']));
   const service=new ClearedRoomService(vi.fn(),saved,()=>[]);await service.setUser(null);expect(service.snapshot().total).toBe(2);
   const blocked={getItem:()=>{throw Error('Blocked');},setItem:()=>{throw Error('Blocked');}} as unknown as Storage;
   const memory=new ClearedRoomService(vi.fn(),blocked,()=>[]);await memory.setUser(null);memory.rememberGuest(detail('6,0'));
   expect(hasClearedRoom('6,0')).toBe(true);
 });
});
